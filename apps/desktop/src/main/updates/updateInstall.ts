import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { type DesktopRuntime } from "../desktopRuntimeTypes";
import { verifyUpdateArtifactIdentity } from "./updateArtifactIdentity";
import {
  createUpdateInstallMarker,
  markInstallHandoffSync,
  readInstallMarker,
  writeInstallMarker,
  type UpdateInstallHandoffExpectation,
} from "./updateInstallMarker";
import { type UpdateInstallPreparationAttempt } from "./updateInstallPreparation";
import {
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnInstallStart,
  reduceDesktopUpdateStateOnNoUpdate,
} from "./updateMachine";

export function createUpdateInstall(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "updaterConfigured"
    | "updateState"
    | "resolveAutoUpdateDisabledReason"
    | "activeUpdateCheck"
    | "checkForUpdates"
    | "UPDATE_CHECK_REASON_MIGRATION_RECOVERY"
    | "activeUpdatePreparation"
    | "downloadAvailableUpdate"
    | "isUpdaterQuitAndInstallInFlight"
    | "AUTO_UPDATE_INSTALL_WATCHDOG_MS"
    | "isAcceptableUpdateVersion"
    | "describeRejectedUpdateVersion"
    | "clearPendingUpdateCache"
    | "setUpdateState"
    | "downloadedUpdateArtifact"
    | "updateInstallPreparation"
    | "getUpdateInstallMarkerPath"
    | "isQuitting"
    | "clearUpdatePollTimer"
    | "stopBackendAndWaitForExit"
    | "logMacUpdateDiagnostics"
    | "activeUpdateInstallHandoff"
    | "armInstallWatchdog"
    | "formatErrorMessage"
    | "clearUpdaterInstallInFlightAfterError"
    | "recordInstallMarkerFailure"
    | "recoverDesktopAfterUpdaterInstallFailure"
    | "isUpdaterInstallPreparing"
    | "replayDeferredDesktopQuitAfterUpdaterSettles"
  >,
) {
  function canInstallUpdateFromRecovery(): boolean {
    return desktopRuntime.updaterConfigured && desktopRuntime.updateState.status !== "up-to-date";
  }

  async function installLatestUpdateForMigrationRecovery(): Promise<string | null> {
    if (!desktopRuntime.updaterConfigured) {
      return (
        desktopRuntime.resolveAutoUpdateDisabledReason() ?? "Automatic updates are not available."
      );
    }

    if (desktopRuntime.updateState.status !== "downloaded") {
      const inFlightCheck = desktopRuntime.activeUpdateCheck;
      if (inFlightCheck === null) {
        await desktopRuntime.checkForUpdates(desktopRuntime.UPDATE_CHECK_REASON_MIGRATION_RECOVERY);
      } else {
        await inFlightCheck;
      }

      const preparation = desktopRuntime.activeUpdatePreparation;
      if (preparation !== null) {
        await preparation;
      } else if (desktopRuntime.updateState.status === "available") {
        await desktopRuntime.downloadAvailableUpdate();
      }
    }

    if (desktopRuntime.updateState.status === "up-to-date") {
      return `Glade ${app.getVersion()} is already the newest release, so updating cannot repair this database.`;
    }
    if (desktopRuntime.updateState.status !== "downloaded") {
      return desktopRuntime.updateState.message ?? "The update could not be downloaded.";
    }

    await installDownloadedUpdate();
    // quitAndInstall never resolves — the process exits under it. A handoff that silently fails is
    // cleared by the install watchdog instead, and waiting for that verdict is what keeps a failed
    // install from leaving a live app with no window and no way back to this prompt.
    await waitForMigrationRecoveryInstallHandoff();
    if (desktopRuntime.isUpdaterQuitAndInstallInFlight) {
      return null;
    }
    return desktopRuntime.updateState.message ?? "The downloaded update could not be installed.";
  }

  async function waitForMigrationRecoveryInstallHandoff(): Promise<void> {
    if (!desktopRuntime.isUpdaterQuitAndInstallInFlight) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, desktopRuntime.AUTO_UPDATE_INSTALL_WATCHDOG_MS + 2_000).unref();
    });
  }

  async function runDownloadedUpdateInstall(
    preparationAttempt: UpdateInstallPreparationAttempt,
  ): Promise<{
    accepted: boolean;
    completed: boolean;
  }> {
    const versionToInstall =
      desktopRuntime.updateState.downloadedVersion ?? desktopRuntime.updateState.availableVersion;
    if (!versionToInstall || !desktopRuntime.isAcceptableUpdateVersion(versionToInstall)) {
      const rejected = versionToInstall
        ? desktopRuntime.describeRejectedUpdateVersion(versionToInstall)
        : "no update version recorded";
      await desktopRuntime.clearPendingUpdateCache(`downloaded update rejected: ${rejected}`);
      desktopRuntime.setUpdateState(
        reduceDesktopUpdateStateOnNoUpdate(desktopRuntime.updateState, new Date().toISOString()),
      );
      console.info(`[desktop-updater] Ignoring stale downloaded update: ${rejected}.`);
      return { accepted: false, completed: false };
    }

    const artifact =
      desktopRuntime.downloadedUpdateArtifact?.version === versionToInstall
        ? desktopRuntime.downloadedUpdateArtifact.identity
        : null;
    if (!artifact || !(await verifyUpdateArtifactIdentity(artifact))) {
      desktopRuntime.downloadedUpdateArtifact = null;
      await desktopRuntime.clearPendingUpdateCache(
        "downloaded artifact identity is missing or changed",
      );
      const message = "The downloaded update could not be reverified. Download it again.";
      desktopRuntime.setUpdateState(
        reduceDesktopUpdateStateOnDownloadFailure(desktopRuntime.updateState, message),
      );
      console.error(`[desktop-updater] Refusing install handoff: ${message}`);
      return { accepted: false, completed: false };
    }
    desktopRuntime.updateInstallPreparation.requireActive(preparationAttempt);

    const markerPath = desktopRuntime.getUpdateInstallMarkerPath();
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
      desktopRuntime.isQuitting = true;
      desktopRuntime.clearUpdatePollTimer();
      await desktopRuntime.stopBackendAndWaitForExit();
      desktopRuntime.updateInstallPreparation.requireActive(preparationAttempt);
      await desktopRuntime.logMacUpdateDiagnostics("before install handoff");
      desktopRuntime.updateInstallPreparation.requireActive(preparationAttempt);
      if (!(await verifyUpdateArtifactIdentity(artifact))) {
        artifactInvalidated = true;
        desktopRuntime.downloadedUpdateArtifact = null;
        await desktopRuntime.clearPendingUpdateCache(
          "downloaded artifact changed during install preparation",
        );
        throw new Error(
          "The downloaded update changed during install preparation. Download it again.",
        );
      }
      desktopRuntime.updateInstallPreparation.requireActive(preparationAttempt);
      writeInstallMarker(markerPath, marker);
      markerWritten = true;
      if (!markInstallHandoffSync(markerPath, handoffExpectation)) {
        throw new Error("Durable update install marker changed before install handoff.");
      }
      desktopRuntime.activeUpdateInstallHandoff = handoffExpectation;
      desktopRuntime.isUpdaterQuitAndInstallInFlight = true;
      autoUpdater.quitAndInstall();
      desktopRuntime.updateInstallPreparation.requireActive(preparationAttempt);
      desktopRuntime.armInstallWatchdog();
      return { accepted: true, completed: false };
    } catch (error: unknown) {
      const message = desktopRuntime.formatErrorMessage(error);
      desktopRuntime.clearUpdaterInstallInFlightAfterError();
      const consecutiveFailures = markerWritten
        ? desktopRuntime.recordInstallMarkerFailure(new Date().toISOString(), handoffExpectation)
        : desktopRuntime.updateState.installFailureCount;
      desktopRuntime.setUpdateState({
        ...(artifactInvalidated
          ? reduceDesktopUpdateStateOnDownloadFailure(desktopRuntime.updateState, message)
          : reduceDesktopUpdateStateOnInstallFailure(desktopRuntime.updateState, message)),
        installFailureCount: consecutiveFailures,
      });
      console.error(`[desktop-updater] Failed to install update: ${message}`);
      desktopRuntime.recoverDesktopAfterUpdaterInstallFailure();
      return { accepted: true, completed: false };
    }
  }

  async function installDownloadedUpdate(): Promise<{
    accepted: boolean;
    completed: boolean;
  }> {
    if (
      desktopRuntime.isQuitting ||
      !desktopRuntime.updaterConfigured ||
      desktopRuntime.updateState.status !== "downloaded"
    ) {
      return { accepted: false, completed: false };
    }
    const preparationAttempt = desktopRuntime.updateInstallPreparation.begin();
    if (preparationAttempt === null) {
      return { accepted: false, completed: false };
    }
    desktopRuntime.isUpdaterInstallPreparing = true;
    try {
      // A retry must not retain the last failure while the new handoff is pending.
      desktopRuntime.setUpdateState(
        reduceDesktopUpdateStateOnInstallStart(desktopRuntime.updateState),
      );
      return await runDownloadedUpdateInstall(preparationAttempt);
    } finally {
      if (
        !desktopRuntime.isUpdaterQuitAndInstallInFlight &&
        desktopRuntime.isUpdaterInstallPreparing
      ) {
        desktopRuntime.clearUpdaterInstallInFlightAfterError();

        desktopRuntime.replayDeferredDesktopQuitAfterUpdaterSettles();
      }
      desktopRuntime.updateInstallPreparation.release(preparationAttempt);
    }
  }
  return {
    canInstallUpdateFromRecovery,
    installLatestUpdateForMigrationRecovery,
    installDownloadedUpdate,
  };
}
