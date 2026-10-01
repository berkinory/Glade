import { app } from "electron";
import * as Path from "node:path";
import type { DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import {
  APP_USER_MODEL_ID,
  AUTO_UPDATE_DIAGNOSTICS_TIMEOUT_MS,
  AUTO_UPDATE_INSTALL_WATCHDOG_MS,
  UPDATE_INSTALL_MARKER_FILE_NAME,
} from "../desktopEnvironment";
import { formatErrorMessage } from "../lifecycle/desktopLogging";
import {
  settleDeferredDesktopQuitAfterUpdaterFailure,
  type DeferredDesktopQuitIntentCoordinator,
} from "../lifecycle/desktopQuitIntent";
import type { UpdateStatus, UpdateDownloadState, UpdateInstallState } from "./updateDomainState";
import { collectMacUpdateDiagnostics } from "./macUpdateDiagnostics";
import {
  recordInstallMarkerFailureSync,
  type UpdateInstallHandoffExpectation,
} from "./updateInstallMarker";
import { reduceDesktopUpdateStateOnInstallFailure } from "./updateMachine";

type DesktopUpdateErrorContext = DesktopUpdateState["errorContext"];

export function createInstallRecovery(input: {
  status: UpdateStatus;
  download: UpdateDownloadState;
  install: UpdateInstallState;
  activity: {
    setUpdateState: (patch: Partial<DesktopUpdateState>) => void;
    scheduleUpdatePoll: () => void;
  };
  lifecycle: {
    isQuitting: () => boolean;
    setQuitting: (value: boolean) => void;
    hasShutdownStarted: () => boolean;
    startBackend: () => void;
    requestGracefulAppQuit: (reason: string) => void;
    writeDesktopLogHeader: (message: string) => void;
  };
  deferredQuit: DeferredDesktopQuitIntentCoordinator;
}) {
  const { status, download, install, activity, lifecycle, deferredQuit } = input;
  function resolveUpdaterErrorContext(): DesktopUpdateErrorContext {
    if (install.preparing || install.handoffInFlight) return "install";
    if (download.inFlight) return "download";
    if (status.checkInFlight) return "check";
    return status.state.errorContext;
  }

  function clearUpdaterInstallInFlightAfterError(input?: {
    readonly preservePendingPreparation?: boolean;
  }): boolean {
    const preparationCancelled = install.preparation.cancel();
    if (preparationCancelled && input?.preservePendingPreparation) {
      return true;
    }
    if (!install.preparing && !install.handoffInFlight) {
      return preparationCancelled;
    }
    install.preparing = false;
    install.handoffInFlight = false;
    install.activeHandoff = null;
    lifecycle.setQuitting(false);
    return preparationCancelled;
  }

  function deferDesktopQuitUntilUpdaterSettles(reason: string): void {
    const deferred = deferredQuit.defer(reason);
    lifecycle.writeDesktopLogHeader(
      deferred
        ? `${reason} deferred until updater install preparation settles`
        : `${reason} waiting for previously deferred quit after updater install preparation`,
    );
  }

  function replayDeferredDesktopQuitAfterUpdaterSettles(): boolean {
    const outcome = settleDeferredDesktopQuitAfterUpdaterFailure(deferredQuit, {
      replayQuit: (intent) => {
        lifecycle.writeDesktopLogHeader(
          `${intent.reason} replaying deferred quit after updater settled`,
        );
        lifecycle.requestGracefulAppQuit(intent.reason);
      },

      resumeApp: () => undefined,
    });
    return outcome !== "resumed-app";
  }

  function recoverDesktopAfterUpdaterInstallFailure(): void {
    if (replayDeferredDesktopQuitAfterUpdaterSettles()) return;

    // A second updater failure signal can race the replay above (for example, before-quit handoff
    // validation followed by the cancelled preparation).
    if (lifecycle.hasShutdownStarted() || lifecycle.isQuitting()) {
      return;
    }

    lifecycle.startBackend();
    activity.scheduleUpdatePoll();
  }

  function clearUpdateInstallWatchdogTimer(): void {
    if (install.watchdogTimer) {
      clearTimeout(install.watchdogTimer);
      install.watchdogTimer = null;
    }
  }

  function getUpdateInstallMarkerPath(): string {
    return Path.join(app.getPath("userData"), UPDATE_INSTALL_MARKER_FILE_NAME);
  }

  function recordInstallMarkerFailure(
    nowIso: string,
    expected: UpdateInstallHandoffExpectation | null,
  ): number {
    if (!expected) {
      console.error(
        "[desktop-updater] Could not record durable install failure without an exact active attempt.",
      );
      return Math.max(1, status.state.installFailureCount + 1);
    }
    const result = recordInstallMarkerFailureSync(getUpdateInstallMarkerPath(), expected, nowIso);
    if (result.status === "missing" || result.status === "invalid") {
      console.error(
        `[desktop-updater] Could not record durable install failure: marker is ${result.status}${result.status === "invalid" ? ` (${result.error})` : ""}.`,
      );
      return Math.max(1, status.state.installFailureCount + 1);
    }
    if (result.status === "mismatch") {
      console.error(
        "[desktop-updater] Refusing to record install failure against a different durable attempt.",
      );
      return Math.max(1, status.state.installFailureCount + 1);
    }
    if (result.status === "write-failed") {
      console.error(
        `[desktop-updater] Failed to persist install failure marker: ${formatErrorMessage(result.error)}`,
      );
    }
    return result.marker.consecutiveFailures;
  }

  async function logMacUpdateDiagnostics(context: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const diagnostics = await Promise.race([
        collectMacUpdateDiagnostics(APP_USER_MODEL_ID),
        new Promise<string>((resolve) => {
          timeout = setTimeout(
            () => resolve("Diagnostic collection timed out."),
            AUTO_UPDATE_DIAGNOSTICS_TIMEOUT_MS,
          );
        }),
      ]);
      if (diagnostics) {
        console.info(`[desktop-updater] diagnostics (${context})\n${diagnostics}`);
      }
    } catch (error) {
      console.info(
        `[desktop-updater] diagnostics (${context}) unavailable: ${formatErrorMessage(error)}`,
      );
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  function armInstallWatchdog(): void {
    clearUpdateInstallWatchdogTimer();
    install.watchdogTimer = setTimeout(() => {
      install.watchdogTimer = null;
      if (!install.handoffInFlight) {
        return;
      }
      const failedHandoff = install.activeHandoff;
      clearUpdaterInstallInFlightAfterError();
      const consecutiveFailures = recordInstallMarkerFailure(
        new Date().toISOString(),
        failedHandoff,
      );
      activity.setUpdateState({
        ...reduceDesktopUpdateStateOnInstallFailure(
          status.state,
          "The update couldn’t be installed automatically.",
        ),
        installFailureCount: consecutiveFailures,
      });
      console.error(
        "[desktop-updater] quitAndInstall did not exit the app within the watchdog window; surfacing manual-download fallback.",
      );
      recoverDesktopAfterUpdaterInstallFailure();
    }, AUTO_UPDATE_INSTALL_WATCHDOG_MS);
  }
  return {
    resolveUpdaterErrorContext,
    clearUpdaterInstallInFlightAfterError,
    deferDesktopQuitUntilUpdaterSettles,
    replayDeferredDesktopQuitAfterUpdaterSettles,
    recoverDesktopAfterUpdaterInstallFailure,
    getUpdateInstallMarkerPath,
    recordInstallMarkerFailure,
    logMacUpdateDiagnostics,
    armInstallWatchdog,
  };
}
