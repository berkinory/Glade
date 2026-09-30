import { autoUpdater, CancellationToken, type UpdateDownloadedEvent } from "electron-updater";
import type { DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import { AUTO_UPDATE_DOWNLOAD_SETTLE_TIMEOUT_MS } from "../desktopEnvironment";
import { formatErrorMessage } from "../lifecycle/desktopLogging";
import type { UpdateStatus, UpdateDownloadState, UpdateInstallState } from "./updateDomainState";
import type { PendingUpdateCacheClearQueue } from "./updatePendingCache";
import { fingerprintUpdateArtifact } from "./updateArtifactIdentity";
import {
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnNoUpdate,
} from "./updateMachine";

export function createUpdateDownload(input: {
  status: UpdateStatus;
  download: UpdateDownloadState;
  install: UpdateInstallState;
  lifecycle: { isQuitting: () => boolean };
  activity: {
    isExplicitUpdateCheckReason: (reason: string) => boolean;
    scheduleUpdatePoll: () => void;
    beginActiveUpdateCheck: () => () => void;
    setUpdateState: (patch: Partial<DesktopUpdateState>) => void;
    clearUpdateCheckTimeoutTimer: () => void;
  };
  timing: {
    armUpdateCheckTimeout: (reason: string) => void;
    armUpdateDownloadStallTimer: (reason: string) => void;
    clearUpdateDownloadStallTimer: () => void;
  };
  version: {
    isAcceptableUpdateVersion: (version: string | null | undefined) => boolean;
    describeRejectedUpdateVersion: (version: string) => string;
  };
  cache: {
    clearPendingUpdateCache: (reason: string) => Promise<void>;
    clearPendingUpdateCacheWhenSafe: (reason: string) => void;
    pendingClear: PendingUpdateCacheClearQueue;
  };
}) {
  const { status, download, install, lifecycle, activity, timing, version, cache } = input;
  async function checkForUpdates(reason: string): Promise<void> {
    if (lifecycle.isQuitting() || install.preparing || !status.configured || status.checkInFlight)
      return;
    if (status.automaticActivitySuppressed) {
      if (!activity.isExplicitUpdateCheckReason(reason)) {
        console.info(
          `[desktop-updater] Skipping automatic update check (${reason}) after an unverified install failure.`,
        );
        return;
      }
      status.automaticActivitySuppressed = false;
      console.info(
        `[desktop-updater] User requested update recovery (${reason}); automatic checks are enabled for this session.`,
      );
      activity.scheduleUpdatePoll();
    }
    if (
      status.state.status === "checking" ||
      status.state.status === "downloading" ||
      status.state.status === "downloaded"
    ) {
      console.info(
        `[desktop-updater] Skipping update check (${reason}) while status=${status.state.status}.`,
      );
      return;
    }
    status.checkInFlight = true;
    const finishCheck = activity.beginActiveUpdateCheck();
    activity.setUpdateState(
      reduceDesktopUpdateStateOnCheckStart(status.state, new Date().toISOString()),
    );
    timing.armUpdateCheckTimeout(reason);
    console.info(`[desktop-updater] Checking for updates (${reason})...`);

    try {
      await autoUpdater.checkForUpdates();
    } catch (error: unknown) {
      activity.clearUpdateCheckTimeoutTimer();
      const message = error instanceof Error ? error.message : String(error);
      activity.setUpdateState(
        reduceDesktopUpdateStateOnCheckFailure(status.state, message, new Date().toISOString()),
      );
      console.error(`[desktop-updater] Failed to check for updates: ${message}`);
    } finally {
      status.checkInFlight = false;
      finishCheck();
    }
  }

  // Updater events publish the task across an await; a fresh read must not retain
  // TypeScript's synchronous narrowing from the earlier reset to null.
  function pendingDownloadedUpdateIdentity(): Promise<void> | null {
    return download.identityTask;
  }

  async function downloadAvailableUpdate(): Promise<{
    accepted: boolean;
    completed: boolean;
  }> {
    if (
      status.configured &&
      status.state.status === "error" &&
      status.state.errorContext === "install" &&
      status.state.downloadedVersion === null &&
      status.state.availableVersion !== null
    ) {
      await checkForUpdates("renderer");
      return { accepted: true, completed: false };
    }
    if (!status.configured || download.inFlight || status.state.status !== "available") {
      return { accepted: false, completed: false };
    }
    if (!version.isAcceptableUpdateVersion(status.state.availableVersion)) {
      const rejected =
        typeof status.state.availableVersion === "string"
          ? version.describeRejectedUpdateVersion(status.state.availableVersion)
          : "no acceptable update version recorded";
      await cache.clearPendingUpdateCache(`staged update rejected: ${rejected}`);
      activity.setUpdateState(
        reduceDesktopUpdateStateOnNoUpdate(status.state, new Date().toISOString()),
      );
      console.info(`[desktop-updater] Ignoring stale available update: ${rejected}.`);
      return { accepted: false, completed: false };
    }
    download.inFlight = true;
    download.artifact = null;
    download.identityTask = null;
    activity.setUpdateState(reduceDesktopUpdateStateOnDownloadStart(status.state));

    download.lastProgressSample = null;
    const cancellationToken = new CancellationToken();
    download.cancellationToken = cancellationToken;
    const downloadStalled = new Promise<never>((_, reject) => {
      download.rejectStall = reject;
    });
    timing.armUpdateDownloadStallTimer("download start");
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
      const identityTask = pendingDownloadedUpdateIdentity();
      if (identityTask) {
        await identityTask;
      }
      return {
        accepted: true,
        completed: download.artifact !== null,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activity.setUpdateState(reduceDesktopUpdateStateOnDownloadFailure(status.state, message));
      console.error(`[desktop-updater] Failed to download update: ${message}`);
      return { accepted: true, completed: false };
    } finally {
      timing.clearUpdateDownloadStallTimer();
      // Hold the in-flight flag until the updater download actually settles, so an immediate retry can't
      // grab the still-cancelling promise (which would reject as "cancelled"). Bounded so a stuck updater
      // promise can't wedge updates.
      if (!updaterDownloadSettled) {
        await Promise.race([
          updaterDownloadSettledPromise,
          new Promise<void>((resolve) => {
            setTimeout(resolve, AUTO_UPDATE_DOWNLOAD_SETTLE_TIMEOUT_MS).unref();
          }),
        ]);
      }
      if (download.cancellationToken === cancellationToken) {
        download.cancellationToken = null;
      }
      download.rejectStall = null;
      download.lastProgressSample = null;
      download.inFlight = false;
      const pendingCacheClearReason = cache.pendingClear.consumeAfterDownload();
      if (pendingCacheClearReason) {
        await cache.clearPendingUpdateCache(pendingCacheClearReason);
      }
    }
  }

  function prepareAvailableUpdateInBackground(reason: string): void {
    if (download.inFlight || status.state.status !== "available") {
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
          `[desktop-updater] Background update download crashed (${reason}): ${formatErrorMessage(error)}`,
        );
      })
      .finally(() => {
        if (download.activePreparation === preparation) {
          download.activePreparation = null;
        }
      });
    // Published so a caller that needs the download finished — migration recovery — can await this one
    // instead of racing a second download against it.
    download.activePreparation = preparation;
  }

  async function recordDownloadedUpdateIdentity(info: UpdateDownloadedEvent): Promise<void> {
    timing.clearUpdateDownloadStallTimer();
    if (!version.isAcceptableUpdateVersion(info.version)) {
      download.artifact = null;
      cache.clearPendingUpdateCacheWhenSafe(
        `downloaded update rejected: ${version.describeRejectedUpdateVersion(info.version)}`,
      );
      activity.setUpdateState(
        reduceDesktopUpdateStateOnNoUpdate(status.state, new Date().toISOString()),
      );
      console.info(
        `[desktop-updater] Ignoring downloaded update: ${version.describeRejectedUpdateVersion(info.version)}.`,
      );
      return;
    }

    try {
      const identity = await fingerprintUpdateArtifact(info.downloadedFile);
      if (!version.isAcceptableUpdateVersion(info.version)) {
        download.artifact = null;
        cache.clearPendingUpdateCacheWhenSafe(
          `downloaded update rejected after fingerprinting: ${version.describeRejectedUpdateVersion(info.version)}`,
        );
        activity.setUpdateState(
          reduceDesktopUpdateStateOnNoUpdate(status.state, new Date().toISOString()),
        );
        return;
      }
      download.artifact = { version: info.version, identity };
      activity.setUpdateState(
        reduceDesktopUpdateStateOnDownloadComplete(status.state, info.version),
      );
      console.info(
        `[desktop-updater] Update downloaded and fingerprinted: ${info.version} (${identity.size} bytes, sha512=${identity.sha512.slice(0, 16)}…).`,
      );
    } catch (error) {
      download.artifact = null;
      cache.clearPendingUpdateCacheWhenSafe("downloaded artifact fingerprint failed");
      const message = `The downloaded update could not be verified: ${formatErrorMessage(error)}`;
      activity.setUpdateState(reduceDesktopUpdateStateOnDownloadFailure(status.state, message));
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
