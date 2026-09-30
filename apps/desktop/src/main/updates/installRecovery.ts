import { app } from "electron";
import * as Path from "node:path";
import { DesktopUpdateErrorContext, type DesktopRuntime } from "../desktopRuntimeTypes";
import { settleDeferredDesktopQuitAfterUpdaterFailure } from "../lifecycle/desktopQuitIntent";
import { collectMacUpdateDiagnostics } from "./macUpdateDiagnostics";
import {
  recordInstallMarkerFailureSync,
  type UpdateInstallHandoffExpectation,
} from "./updateInstallMarker";
import { reduceDesktopUpdateStateOnInstallFailure } from "./updateMachine";

export function createInstallRecovery(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "downloadedUpdateIdentityTask"
    | "isUpdaterInstallPreparing"
    | "isUpdaterQuitAndInstallInFlight"
    | "updateDownloadInFlight"
    | "updateCheckInFlight"
    | "updateState"
    | "updateInstallPreparation"
    | "activeUpdateInstallHandoff"
    | "isQuitting"
    | "deferredDesktopQuitIntent"
    | "writeDesktopLogHeader"
    | "requestGracefulAppQuit"
    | "desktopShutdownPromise"
    | "startBackend"
    | "scheduleUpdatePoll"
    | "updateInstallWatchdogTimer"
    | "UPDATE_INSTALL_MARKER_FILE_NAME"
    | "formatErrorMessage"
    | "APP_USER_MODEL_ID"
    | "AUTO_UPDATE_DIAGNOSTICS_TIMEOUT_MS"
    | "setUpdateState"
    | "AUTO_UPDATE_INSTALL_WATCHDOG_MS"
  >,
) {
  function pendingDownloadedUpdateIdentity(): Promise<void> | null {
    return desktopRuntime.downloadedUpdateIdentityTask;
  }

  function resolveUpdaterErrorContext(): DesktopUpdateErrorContext {
    if (desktopRuntime.isUpdaterInstallPreparing || desktopRuntime.isUpdaterQuitAndInstallInFlight)
      return "install";
    if (desktopRuntime.updateDownloadInFlight) return "download";
    if (desktopRuntime.updateCheckInFlight) return "check";
    return desktopRuntime.updateState.errorContext;
  }

  function clearUpdaterInstallInFlightAfterError(input?: {
    readonly preservePendingPreparation?: boolean;
  }): boolean {
    const preparationCancelled = desktopRuntime.updateInstallPreparation.cancel();
    if (preparationCancelled && input?.preservePendingPreparation) {
      return true;
    }
    if (
      !desktopRuntime.isUpdaterInstallPreparing &&
      !desktopRuntime.isUpdaterQuitAndInstallInFlight
    ) {
      return preparationCancelled;
    }
    desktopRuntime.isUpdaterInstallPreparing = false;
    desktopRuntime.isUpdaterQuitAndInstallInFlight = false;
    desktopRuntime.activeUpdateInstallHandoff = null;
    desktopRuntime.isQuitting = false;
    return preparationCancelled;
  }

  function deferDesktopQuitUntilUpdaterSettles(reason: string): void {
    const deferred = desktopRuntime.deferredDesktopQuitIntent.defer(reason);
    desktopRuntime.writeDesktopLogHeader(
      deferred
        ? `${reason} deferred until updater install preparation settles`
        : `${reason} waiting for previously deferred quit after updater install preparation`,
    );
  }

  function replayDeferredDesktopQuitAfterUpdaterSettles(): boolean {
    const outcome = settleDeferredDesktopQuitAfterUpdaterFailure(
      desktopRuntime.deferredDesktopQuitIntent,
      {
        replayQuit: (intent) => {
          desktopRuntime.writeDesktopLogHeader(
            `${intent.reason} replaying deferred quit after updater settled`,
          );
          desktopRuntime.requestGracefulAppQuit(intent.reason);
        },

        resumeApp: () => undefined,
      },
    );
    return outcome !== "resumed-app";
  }

  function recoverDesktopAfterUpdaterInstallFailure(): void {
    if (replayDeferredDesktopQuitAfterUpdaterSettles()) return;

    // A second updater failure signal can race the replay above (for example, before-quit handoff
    // validation followed by the cancelled preparation).
    if (desktopRuntime.desktopShutdownPromise !== null || desktopRuntime.isQuitting) {
      return;
    }

    desktopRuntime.startBackend();
    desktopRuntime.scheduleUpdatePoll();
  }

  function clearUpdateInstallWatchdogTimer(): void {
    if (desktopRuntime.updateInstallWatchdogTimer) {
      clearTimeout(desktopRuntime.updateInstallWatchdogTimer);
      desktopRuntime.updateInstallWatchdogTimer = null;
    }
  }

  function getUpdateInstallMarkerPath(): string {
    return Path.join(app.getPath("userData"), desktopRuntime.UPDATE_INSTALL_MARKER_FILE_NAME);
  }

  function recordInstallMarkerFailure(
    nowIso: string,
    expected: UpdateInstallHandoffExpectation | null,
  ): number {
    if (!expected) {
      console.error(
        "[desktop-updater] Could not record durable install failure without an exact active attempt.",
      );
      return Math.max(1, desktopRuntime.updateState.installFailureCount + 1);
    }
    const result = recordInstallMarkerFailureSync(getUpdateInstallMarkerPath(), expected, nowIso);
    if (result.status === "missing" || result.status === "invalid") {
      console.error(
        `[desktop-updater] Could not record durable install failure: marker is ${result.status}${result.status === "invalid" ? ` (${result.error})` : ""}.`,
      );
      return Math.max(1, desktopRuntime.updateState.installFailureCount + 1);
    }
    if (result.status === "mismatch") {
      console.error(
        "[desktop-updater] Refusing to record install failure against a different durable attempt.",
      );
      return Math.max(1, desktopRuntime.updateState.installFailureCount + 1);
    }
    if (result.status === "write-failed") {
      console.error(
        `[desktop-updater] Failed to persist install failure marker: ${desktopRuntime.formatErrorMessage(result.error)}`,
      );
    }
    return result.marker.consecutiveFailures;
  }

  async function logMacUpdateDiagnostics(context: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const diagnostics = await Promise.race([
        collectMacUpdateDiagnostics(desktopRuntime.APP_USER_MODEL_ID),
        new Promise<string>((resolve) => {
          timeout = setTimeout(
            () => resolve("Diagnostic collection timed out."),
            desktopRuntime.AUTO_UPDATE_DIAGNOSTICS_TIMEOUT_MS,
          );
        }),
      ]);
      if (diagnostics) {
        console.info(`[desktop-updater] diagnostics (${context})\n${diagnostics}`);
      }
    } catch (error) {
      console.info(
        `[desktop-updater] diagnostics (${context}) unavailable: ${desktopRuntime.formatErrorMessage(error)}`,
      );
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  function armInstallWatchdog(): void {
    clearUpdateInstallWatchdogTimer();
    desktopRuntime.updateInstallWatchdogTimer = setTimeout(() => {
      desktopRuntime.updateInstallWatchdogTimer = null;
      if (!desktopRuntime.isUpdaterQuitAndInstallInFlight) {
        return;
      }
      const failedHandoff = desktopRuntime.activeUpdateInstallHandoff;
      clearUpdaterInstallInFlightAfterError();
      const consecutiveFailures = recordInstallMarkerFailure(
        new Date().toISOString(),
        failedHandoff,
      );
      desktopRuntime.setUpdateState({
        ...reduceDesktopUpdateStateOnInstallFailure(
          desktopRuntime.updateState,
          "The update couldn’t be installed automatically.",
        ),
        installFailureCount: consecutiveFailures,
      });
      console.error(
        "[desktop-updater] quitAndInstall did not exit the app within the watchdog window; surfacing manual-download fallback.",
      );
      recoverDesktopAfterUpdaterInstallFailure();
    }, desktopRuntime.AUTO_UPDATE_INSTALL_WATCHDOG_MS);
  }
  return {
    pendingDownloadedUpdateIdentity,
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
