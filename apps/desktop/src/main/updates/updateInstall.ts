import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import { formatErrorMessage } from "../lifecycle/desktopLogging";
import type { UpdateStatus, UpdateDownloadState, UpdateInstallState } from "./updateDomainState";
import { verifyUpdateArtifactIdentity } from "./updateArtifactIdentity";
import {
  createUpdateInstallMarker,
  markInstallHandoffSync,
  readInstallMarker,
  writeInstallMarker,
  type UpdateInstallHandoffExpectation,
} from "./updateInstallMarker";
import { type UpdateInstallPreparationAttempt } from "./updateDomainState";
import {
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnInstallStart,
  reduceDesktopUpdateStateOnNoUpdate,
} from "./updateMachine";

export function createUpdateInstall(input: {
  status: UpdateStatus;
  download: UpdateDownloadState;
  install: UpdateInstallState;
  activity: {
    activeCheck: () => Promise<void> | null;
    checkForUpdates: (reason: string) => Promise<void>;
    downloadAvailableUpdate: () => Promise<{ accepted: boolean; completed: boolean }>;
    setUpdateState: (patch: Partial<DesktopUpdateState>) => void;
    clearUpdatePollTimer: () => void;
  };
  cache: { clearPendingUpdateCache: (reason: string) => Promise<void> };
  recovery: {
    getUpdateInstallMarkerPath: () => string;
    logMacUpdateDiagnostics: (context: string) => Promise<void>;
    armInstallWatchdog: () => void;
    clearUpdaterInstallInFlightAfterError: () => boolean;
    recordInstallMarkerFailure: (
      nowIso: string,
      expected: UpdateInstallHandoffExpectation | null,
    ) => number;
    recoverDesktopAfterUpdaterInstallFailure: () => void;
    replayDeferredDesktopQuitAfterUpdaterSettles: () => boolean;
  };
  lifecycle: {
    isQuitting: () => boolean;
    setQuitting: (value: boolean) => void;
    stopBackendAndWaitForExit: () => Promise<void>;
    resolveAutoUpdateDisabledReason: () => string | null;
  };
  version: {
    isAcceptableUpdateVersion: (version: string | null | undefined) => boolean;
    describeRejectedUpdateVersion: (version: string) => string;
  };
}) {
  const { status, download, install, activity, cache, recovery, lifecycle, version } = input;
  async function runDownloadedUpdateInstall(
    preparationAttempt: UpdateInstallPreparationAttempt,
  ): Promise<{
    accepted: boolean;
    completed: boolean;
  }> {
    const versionToInstall = status.state.downloadedVersion ?? status.state.availableVersion;
    if (!versionToInstall || !version.isAcceptableUpdateVersion(versionToInstall)) {
      const rejected = versionToInstall
        ? version.describeRejectedUpdateVersion(versionToInstall)
        : "no update version recorded";
      await cache.clearPendingUpdateCache(`downloaded update rejected: ${rejected}`);
      activity.setUpdateState(
        reduceDesktopUpdateStateOnNoUpdate(status.state, new Date().toISOString()),
      );
      console.info(`[desktop-updater] Ignoring stale downloaded update: ${rejected}.`);
      return { accepted: false, completed: false };
    }

    const artifact =
      download.artifact?.version === versionToInstall ? download.artifact.identity : null;
    if (!artifact || !(await verifyUpdateArtifactIdentity(artifact))) {
      download.artifact = null;
      await cache.clearPendingUpdateCache("downloaded artifact identity is missing or changed");
      const message = "The downloaded update could not be reverified. Download it again.";
      activity.setUpdateState(reduceDesktopUpdateStateOnDownloadFailure(status.state, message));
      console.error(`[desktop-updater] Refusing install handoff: ${message}`);
      return { accepted: false, completed: false };
    }
    install.preparation.requireActive(preparationAttempt);

    const markerPath = recovery.getUpdateInstallMarkerPath();
    const existingMarkerResult = readInstallMarker(markerPath);
    const existingMarker =
      existingMarkerResult.status === "valid" &&
      existingMarkerResult.marker.toVersion === versionToInstall
        ? existingMarkerResult.marker
        : null;
    const marker = createUpdateInstallMarker({
      fromVersion: app.getVersion(),
      toVersion: versionToInstall,
      requestedAt: new Date().toISOString(),
      consecutiveFailures: existingMarker?.consecutiveFailures ?? 0,
      lastFailureAt: existingMarker?.lastFailureAt ?? null,
      artifact,
    });
    const handoffExpectation: UpdateInstallHandoffExpectation = {
      attemptId: marker.attemptId,
      artifact,
    };
    let markerWritten = false;
    let artifactInvalidated = false;
    try {
      lifecycle.setQuitting(true);
      activity.clearUpdatePollTimer();
      await lifecycle.stopBackendAndWaitForExit();
      install.preparation.requireActive(preparationAttempt);
      await recovery.logMacUpdateDiagnostics("before install handoff");
      install.preparation.requireActive(preparationAttempt);
      if (!(await verifyUpdateArtifactIdentity(artifact))) {
        artifactInvalidated = true;
        download.artifact = null;
        await cache.clearPendingUpdateCache(
          "downloaded artifact changed during install preparation",
        );
        throw new Error(
          "The downloaded update changed during install preparation. Download it again.",
        );
      }
      install.preparation.requireActive(preparationAttempt);
      writeInstallMarker(markerPath, marker);
      markerWritten = true;
      if (!markInstallHandoffSync(markerPath, handoffExpectation)) {
        throw new Error("Durable update install marker changed before install handoff.");
      }
      install.activeHandoff = handoffExpectation;
      install.handoffInFlight = true;
      autoUpdater.quitAndInstall();
      install.preparation.requireActive(preparationAttempt);
      recovery.armInstallWatchdog();
      return { accepted: true, completed: false };
    } catch (error: unknown) {
      const message = formatErrorMessage(error);
      recovery.clearUpdaterInstallInFlightAfterError();
      const consecutiveFailures = markerWritten
        ? recovery.recordInstallMarkerFailure(new Date().toISOString(), handoffExpectation)
        : status.state.installFailureCount;
      activity.setUpdateState({
        ...(artifactInvalidated
          ? reduceDesktopUpdateStateOnDownloadFailure(status.state, message)
          : reduceDesktopUpdateStateOnInstallFailure(status.state, message)),
        installFailureCount: consecutiveFailures,
      });
      console.error(`[desktop-updater] Failed to install update: ${message}`);
      recovery.recoverDesktopAfterUpdaterInstallFailure();
      return { accepted: true, completed: false };
    }
  }

  async function installDownloadedUpdate(): Promise<{
    accepted: boolean;
    completed: boolean;
  }> {
    if (lifecycle.isQuitting() || !status.configured || status.state.status !== "downloaded") {
      return { accepted: false, completed: false };
    }
    const preparationAttempt = install.preparation.begin();
    if (preparationAttempt === null) {
      return { accepted: false, completed: false };
    }
    install.preparing = true;
    try {
      // A retry must not retain the last failure while the new handoff is pending.
      activity.setUpdateState(reduceDesktopUpdateStateOnInstallStart(status.state));
      return await runDownloadedUpdateInstall(preparationAttempt);
    } finally {
      if (!install.handoffInFlight && install.preparing) {
        recovery.clearUpdaterInstallInFlightAfterError();

        recovery.replayDeferredDesktopQuitAfterUpdaterSettles();
      }
      install.preparation.release(preparationAttempt);
    }
  }
  return {
    installDownloadedUpdate,
  };
}
