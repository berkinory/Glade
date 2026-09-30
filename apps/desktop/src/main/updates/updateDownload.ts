import { autoUpdater, CancellationToken, type UpdateDownloadedEvent } from "electron-updater";
import { type DesktopRuntime } from "../desktopRuntimeTypes";
import { fingerprintUpdateArtifact } from "./updateArtifactIdentity";
import {
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnNoUpdate,
} from "./updateMachine";

export function createUpdateDownload(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "isQuitting"
    | "isUpdaterInstallPreparing"
    | "updaterConfigured"
    | "updateCheckInFlight"
    | "automaticUpdateActivitySuppressed"
    | "isExplicitUpdateCheckReason"
    | "scheduleUpdatePoll"
    | "updateState"
    | "beginActiveUpdateCheck"
    | "setUpdateState"
    | "armUpdateCheckTimeout"
    | "clearUpdateCheckTimeoutTimer"
    | "updateDownloadInFlight"
    | "isAcceptableUpdateVersion"
    | "describeRejectedUpdateVersion"
    | "clearPendingUpdateCache"
    | "downloadedUpdateArtifact"
    | "downloadedUpdateIdentityTask"
    | "lastUpdateDownloadProgressSample"
    | "updateDownloadCancellationToken"
    | "rejectUpdateDownloadStall"
    | "armUpdateDownloadStallTimer"
    | "pendingDownloadedUpdateIdentity"
    | "clearUpdateDownloadStallTimer"
    | "AUTO_UPDATE_DOWNLOAD_SETTLE_TIMEOUT_MS"
    | "pendingUpdateCacheClearQueue"
    | "formatErrorMessage"
    | "activeUpdatePreparation"
    | "clearPendingUpdateCacheWhenSafe"
  >,
) {
  async function checkForUpdates(reason: string): Promise<void> {
    if (
      desktopRuntime.isQuitting ||
      desktopRuntime.isUpdaterInstallPreparing ||
      !desktopRuntime.updaterConfigured ||
      desktopRuntime.updateCheckInFlight
    )
      return;
    if (desktopRuntime.automaticUpdateActivitySuppressed) {
      if (!desktopRuntime.isExplicitUpdateCheckReason(reason)) {
        console.info(
          `[desktop-updater] Skipping automatic update check (${reason}) after an unverified install failure.`,
        );
        return;
      }
      desktopRuntime.automaticUpdateActivitySuppressed = false;
      console.info(
        `[desktop-updater] User requested update recovery (${reason}); automatic checks are enabled for this session.`,
      );
      desktopRuntime.scheduleUpdatePoll();
    }
    if (
      desktopRuntime.updateState.status === "checking" ||
      desktopRuntime.updateState.status === "downloading" ||
      desktopRuntime.updateState.status === "downloaded"
    ) {
      console.info(
        `[desktop-updater] Skipping update check (${reason}) while status=${desktopRuntime.updateState.status}.`,
      );
      return;
    }
    desktopRuntime.updateCheckInFlight = true;
    const finishCheck = desktopRuntime.beginActiveUpdateCheck();
    desktopRuntime.setUpdateState(
      reduceDesktopUpdateStateOnCheckStart(desktopRuntime.updateState, new Date().toISOString()),
    );
    desktopRuntime.armUpdateCheckTimeout(reason);
    console.info(`[desktop-updater] Checking for updates (${reason})...`);

    try {
      await autoUpdater.checkForUpdates();
    } catch (error: unknown) {
      desktopRuntime.clearUpdateCheckTimeoutTimer();
      const message = error instanceof Error ? error.message : String(error);
      desktopRuntime.setUpdateState(
        reduceDesktopUpdateStateOnCheckFailure(
          desktopRuntime.updateState,
          message,
          new Date().toISOString(),
        ),
      );
      console.error(`[desktop-updater] Failed to check for updates: ${message}`);
    } finally {
      desktopRuntime.updateCheckInFlight = false;
      finishCheck();
    }
  }

  async function downloadAvailableUpdate(): Promise<{
    accepted: boolean;
    completed: boolean;
  }> {
    if (
      desktopRuntime.updaterConfigured &&
      desktopRuntime.updateState.status === "error" &&
      desktopRuntime.updateState.errorContext === "install" &&
      desktopRuntime.updateState.downloadedVersion === null &&
      desktopRuntime.updateState.availableVersion !== null
    ) {
      await checkForUpdates("renderer");
      return { accepted: true, completed: false };
    }
    if (
      !desktopRuntime.updaterConfigured ||
      desktopRuntime.updateDownloadInFlight ||
      desktopRuntime.updateState.status !== "available"
    ) {
      return { accepted: false, completed: false };
    }
    if (!desktopRuntime.isAcceptableUpdateVersion(desktopRuntime.updateState.availableVersion)) {
      const rejected =
        typeof desktopRuntime.updateState.availableVersion === "string"
          ? desktopRuntime.describeRejectedUpdateVersion(
              desktopRuntime.updateState.availableVersion,
            )
          : "no acceptable update version recorded";
      await desktopRuntime.clearPendingUpdateCache(`staged update rejected: ${rejected}`);
      desktopRuntime.setUpdateState(
        reduceDesktopUpdateStateOnNoUpdate(desktopRuntime.updateState, new Date().toISOString()),
      );
      console.info(`[desktop-updater] Ignoring stale available update: ${rejected}.`);
      return { accepted: false, completed: false };
    }
    desktopRuntime.updateDownloadInFlight = true;
    desktopRuntime.downloadedUpdateArtifact = null;
    desktopRuntime.downloadedUpdateIdentityTask = null;
    desktopRuntime.setUpdateState(
      reduceDesktopUpdateStateOnDownloadStart(desktopRuntime.updateState),
    );

    desktopRuntime.lastUpdateDownloadProgressSample = null;
    const cancellationToken = new CancellationToken();
    desktopRuntime.updateDownloadCancellationToken = cancellationToken;
    const downloadStalled = new Promise<never>((_, reject) => {
      desktopRuntime.rejectUpdateDownloadStall = reject;
    });
    desktopRuntime.armUpdateDownloadStallTimer("download start");
    console.info("[desktop-updater] Downloading update...");

    // Track electron-updater's own download promise separately from the stall race. When the stall
    // timer wins the race it cancels this promise, but the updater keeps its internal download promise
    // set until that cancellation unwinds. We observe its settlement here (so a late rejection can't
    // surface as an unhandled rejection) and wait on it before releasing the in-flight flag below.
    let updaterDownloadSettled = false;
    const updaterDownloadPromise = autoUpdater.downloadUpdate(cancellationToken);
    const updaterDownloadSettledPromise = updaterDownloadPromise.then(
      () => {
        updaterDownloadSettled = true;
      },
      () => {
        updaterDownloadSettled = true;
      },
    );

    try {
      await Promise.race([updaterDownloadPromise, downloadStalled]);
      const identityTask = desktopRuntime.pendingDownloadedUpdateIdentity();
      if (identityTask) {
        await identityTask;
      }
      return {
        accepted: true,
        completed: desktopRuntime.downloadedUpdateArtifact !== null,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      desktopRuntime.setUpdateState(
        reduceDesktopUpdateStateOnDownloadFailure(desktopRuntime.updateState, message),
      );
      console.error(`[desktop-updater] Failed to download update: ${message}`);
      return { accepted: true, completed: false };
    } finally {
      desktopRuntime.clearUpdateDownloadStallTimer();
      // Hold the in-flight flag until the updater download actually settles, so an immediate retry can't
      // grab the still-cancelling promise (which would reject as "cancelled"). Bounded so a stuck updater
      // promise can't wedge updates.
      if (!updaterDownloadSettled) {
        await Promise.race([
          updaterDownloadSettledPromise,
          new Promise<void>((resolve) => {
            setTimeout(resolve, desktopRuntime.AUTO_UPDATE_DOWNLOAD_SETTLE_TIMEOUT_MS).unref();
          }),
        ]);
      }
      if (desktopRuntime.updateDownloadCancellationToken === cancellationToken) {
        desktopRuntime.updateDownloadCancellationToken = null;
      }
      desktopRuntime.rejectUpdateDownloadStall = null;
      desktopRuntime.lastUpdateDownloadProgressSample = null;
      desktopRuntime.updateDownloadInFlight = false;
      const pendingCacheClearReason =
        desktopRuntime.pendingUpdateCacheClearQueue.consumeAfterDownload();
      if (pendingCacheClearReason) {
        await desktopRuntime.clearPendingUpdateCache(pendingCacheClearReason);
      }
    }
  }

  function prepareAvailableUpdateInBackground(reason: string): void {
    if (
      desktopRuntime.updateDownloadInFlight ||
      desktopRuntime.updateState.status !== "available"
    ) {
      return;
    }
    const preparation = downloadAvailableUpdate()
      .then((result) => {
        if (result.accepted && result.completed) {
          console.info(`[desktop-updater] Background update download completed (${reason}).`);
        }
      })
      .catch((error) => {
        console.error(
          `[desktop-updater] Background update download crashed (${reason}): ${desktopRuntime.formatErrorMessage(error)}`,
        );
      })
      .finally(() => {
        if (desktopRuntime.activeUpdatePreparation === preparation) {
          desktopRuntime.activeUpdatePreparation = null;
        }
      });
    // Published so a caller that needs the download finished — migration recovery — can await this one
    // instead of racing a second download against it.
    desktopRuntime.activeUpdatePreparation = preparation;
  }

  async function recordDownloadedUpdateIdentity(info: UpdateDownloadedEvent): Promise<void> {
    desktopRuntime.clearUpdateDownloadStallTimer();
    if (!desktopRuntime.isAcceptableUpdateVersion(info.version)) {
      desktopRuntime.downloadedUpdateArtifact = null;
      desktopRuntime.clearPendingUpdateCacheWhenSafe(
        `downloaded update rejected: ${desktopRuntime.describeRejectedUpdateVersion(info.version)}`,
      );
      desktopRuntime.setUpdateState(
        reduceDesktopUpdateStateOnNoUpdate(desktopRuntime.updateState, new Date().toISOString()),
      );
      console.info(
        `[desktop-updater] Ignoring downloaded update: ${desktopRuntime.describeRejectedUpdateVersion(info.version)}.`,
      );
      return;
    }

    try {
      const identity = await fingerprintUpdateArtifact(info.downloadedFile);
      if (!desktopRuntime.isAcceptableUpdateVersion(info.version)) {
        desktopRuntime.downloadedUpdateArtifact = null;
        desktopRuntime.clearPendingUpdateCacheWhenSafe(
          `downloaded update rejected after fingerprinting: ${desktopRuntime.describeRejectedUpdateVersion(info.version)}`,
        );
        desktopRuntime.setUpdateState(
          reduceDesktopUpdateStateOnNoUpdate(desktopRuntime.updateState, new Date().toISOString()),
        );
        return;
      }
      desktopRuntime.downloadedUpdateArtifact = { version: info.version, identity };
      desktopRuntime.setUpdateState(
        reduceDesktopUpdateStateOnDownloadComplete(desktopRuntime.updateState, info.version),
      );
      console.info(
        `[desktop-updater] Update downloaded and fingerprinted: ${info.version} (${identity.size} bytes, sha512=${identity.sha512.slice(0, 16)}…).`,
      );
    } catch (error) {
      desktopRuntime.downloadedUpdateArtifact = null;
      desktopRuntime.clearPendingUpdateCacheWhenSafe("downloaded artifact fingerprint failed");
      const message = `The downloaded update could not be verified: ${desktopRuntime.formatErrorMessage(error)}`;
      desktopRuntime.setUpdateState(
        reduceDesktopUpdateStateOnDownloadFailure(desktopRuntime.updateState, message),
      );
      console.error(`[desktop-updater] ${message}`);
    }
  }
  return {
    checkForUpdates,
    downloadAvailableUpdate,
    prepareAvailableUpdateInBackground,
    recordDownloadedUpdateIdentity,
  };
}
