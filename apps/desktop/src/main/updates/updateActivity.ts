import type { DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import { app, BrowserWindow } from "electron";
import {
  desktopFlavor,
  AUTO_UPDATE_POLL_INTERVAL_MS,
  AUTO_UPDATE_CHECK_TIMEOUT_MS,
  AUTO_UPDATE_STALLED_DOWNLOAD_CANCELLATION_SUPPRESSION_MS,
  AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS,
  AUTO_UPDATE_FOREGROUND_RECHECK_MIN_BACKGROUND_MS,
  AUTO_UPDATE_FOREGROUND_RECHECK_MIN_INTERVAL_MS,
} from "../desktopEnvironment";
import { DESKTOP_IPC_CHANNELS } from "../ipc/ipcChannels";
import type {
  UpdateStatus,
  UpdateActivityState,
  UpdateDownloadState,
  UpdateCancellationState,
} from "./updateDomainState";
import { reduceDesktopUpdateStateOnCheckFailure } from "./updateMachine";
import {
  getDownloadStallTimeoutMessage,
  hasDownloadProgressAdvanced,
  isUpdateVersionAllowedForFlavor,
  isUpdateVersionNewer,
  shouldCheckForUpdatesOnForeground,
  type DownloadProgressSample,
} from "./updateState";

export function createUpdateActivity(input: {
  status: UpdateStatus;
  activity: UpdateActivityState;
  download: UpdateDownloadState;
  cancellation: UpdateCancellationState;
  checkForUpdates: (reason: string) => Promise<void>;
  resolveAutoUpdateDisabledReason: () => string | null;
  clearUnreadNotificationBadge: () => void;
}) {
  const {
    status,
    activity,
    download,
    cancellation,
    checkForUpdates,
    resolveAutoUpdateDisabledReason,
    clearUnreadNotificationBadge,
  } = input;
  function clearUpdatePollTimer(): void {
    if (activity.startupTimer) {
      clearTimeout(activity.startupTimer);
      activity.startupTimer = null;
    }
    if (activity.pollTimer) {
      clearInterval(activity.pollTimer);
      activity.pollTimer = null;
    }
  }

  function scheduleUpdatePoll(): void {
    if (activity.pollTimer || status.automaticActivitySuppressed) {
      return;
    }
    activity.pollTimer = setInterval(() => {
      void checkForUpdates("poll");
    }, AUTO_UPDATE_POLL_INTERVAL_MS);
    activity.pollTimer.unref();
  }

  function isExplicitUpdateCheckReason(reason: string): boolean {
    return reason === "menu" || reason === "renderer";
  }

  function emitUpdateState(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(DESKTOP_IPC_CHANNELS.updateState, status.state);
    }
  }

  function setUpdateState(patch: Partial<DesktopUpdateState>): void {
    status.state = { ...status.state, ...patch };
    emitUpdateState();
  }

  function shouldEnableAutoUpdates(): boolean {
    return resolveAutoUpdateDisabledReason() === null;
  }

  function isAcceptableUpdateVersion(version: string | null | undefined): boolean {
    return (
      typeof version === "string" &&
      isUpdateVersionAllowedForFlavor(version, desktopFlavor) &&
      isUpdateVersionNewer(app.getVersion(), version)
    );
  }

  function describeRejectedUpdateVersion(version: string): string {
    if (!isUpdateVersionAllowedForFlavor(version, desktopFlavor)) {
      return `version ${version} is not on the "${desktopFlavor}" flavor's update lane`;
    }
    return `version ${version} is not newer than current ${app.getVersion()}`;
  }

  function clearUpdateBackgroundBlurTimer(): void {
    if (activity.backgroundBlurTimer) {
      clearTimeout(activity.backgroundBlurTimer);
      activity.backgroundBlurTimer = null;
    }
  }

  function clearUpdateCheckTimeoutTimer(): void {
    if (activity.checkTimeoutTimer) {
      clearTimeout(activity.checkTimeoutTimer);
      activity.checkTimeoutTimer = null;
    }
  }

  function armUpdateCheckTimeout(reason: string): void {
    clearUpdateCheckTimeoutTimer();
    activity.checkTimeoutTimer = setTimeout(() => {
      activity.checkTimeoutTimer = null;
      if (status.state.status !== "checking") {
        return;
      }
      status.checkInFlight = false;
      // electron-updater may never settle its own promise, so this is also where anyone awaiting the
      // check has to be released.
      activity.settleActiveCheck?.();
      setUpdateState(
        reduceDesktopUpdateStateOnCheckFailure(
          status.state,
          "Timed out while checking for updates. Try again.",
          new Date().toISOString(),
        ),
      );
      console.error(`[desktop-updater] Update check timed out (${reason}).`);
    }, AUTO_UPDATE_CHECK_TIMEOUT_MS);
    activity.checkTimeoutTimer.unref();
  }

  function clearUpdateDownloadStallTimer(): void {
    if (download.stallTimer) {
      clearTimeout(download.stallTimer);
      download.stallTimer = null;
    }
  }

  function clearStalledDownloadCancellationSuppression(): void {
    cancellation.suppressionsRemaining = 0;
    cancellation.suppressionExpiresAtMs = 0;
  }

  function armStalledDownloadCancellationSuppression(): void {
    cancellation.suppressionsRemaining += 1;
    cancellation.suppressionExpiresAtMs =
      Date.now() + AUTO_UPDATE_STALLED_DOWNLOAD_CANCELLATION_SUPPRESSION_MS;
  }

  function isStalledDownloadCancellationSuppressionArmed(): boolean {
    if (cancellation.suppressionsRemaining <= 0) {
      return false;
    }
    if (Date.now() <= cancellation.suppressionExpiresAtMs) {
      return true;
    }
    clearStalledDownloadCancellationSuppression();
    return false;
  }

  function consumeStalledDownloadCancellationSuppression(): void {
    cancellation.suppressionsRemaining = Math.max(0, cancellation.suppressionsRemaining - 1);
    if (cancellation.suppressionsRemaining === 0) {
      cancellation.suppressionExpiresAtMs = 0;
    }
  }

  function armUpdateDownloadStallTimer(reason: string): void {
    clearUpdateDownloadStallTimer();
    download.stallTimer = setTimeout(() => {
      download.stallTimer = null;
      if (!download.inFlight || status.state.status !== "downloading") {
        return;
      }

      const error = new Error(
        getDownloadStallTimeoutMessage(AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS),
      );
      console.error(`[desktop-updater] ${error.message} (${reason}).`);
      armStalledDownloadCancellationSuppression();
      download.rejectStall?.(error);
      download.cancellationToken?.cancel();
    }, AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS);
    download.stallTimer.unref();
  }

  function updateDownloadStallTimerOnProgress(progress: DownloadProgressSample): void {
    if (!download.inFlight) {
      return;
    }
    if (!hasDownloadProgressAdvanced(download.lastProgressSample, progress)) {
      return;
    }
    download.lastProgressSample = {
      percent: progress.percent ?? null,
      transferred: progress.transferred ?? null,
    };
    armUpdateDownloadStallTimer(`download progress ${Math.floor(progress.percent ?? 0)}%`);
  }

  function isDesktopAppForegrounded(): boolean {
    return BrowserWindow.getAllWindows().some(
      (window) => !window.isDestroyed() && window.isFocused(),
    );
  }

  function markDesktopAppBackgrounded(): void {
    clearUpdateBackgroundBlurTimer();
    activity.backgroundBlurTimer = setTimeout(() => {
      activity.backgroundBlurTimer = null;
      if (isDesktopAppForegrounded()) {
        return;
      }
      activity.backgroundedAtMs = Date.now();
    }, 0);
  }

  function handleDesktopAppForegrounded(): void {
    clearUpdateBackgroundBlurTimer();
    clearUnreadNotificationBadge();
    const foregroundedAtMs = Date.now();
    const backgroundedAtMs = activity.backgroundedAtMs;
    activity.backgroundedAtMs = null;
    const shouldCheck = shouldCheckForUpdatesOnForeground({
      checkedAt: status.state.checkedAt,
      backgroundedAtMs,
      foregroundedAtMs,
      minBackgroundDurationMs: AUTO_UPDATE_FOREGROUND_RECHECK_MIN_BACKGROUND_MS,
      minIntervalMs: AUTO_UPDATE_FOREGROUND_RECHECK_MIN_INTERVAL_MS,
    });
    if (!shouldCheck) {
      return;
    }
    void checkForUpdates("foreground");
  }

  function beginActiveUpdateCheck(): () => void {
    let settle!: () => void;
    const check = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const finish = (): void => {
      settle();
      if (activity.activeCheck === check) {
        activity.activeCheck = null;
        activity.settleActiveCheck = null;
      }
    };
    activity.activeCheck = check;
    activity.settleActiveCheck = finish;
    return finish;
  }
  return {
    clearUpdatePollTimer,
    scheduleUpdatePoll,
    isExplicitUpdateCheckReason,
    emitUpdateState,
    setUpdateState,
    shouldEnableAutoUpdates,
    isAcceptableUpdateVersion,
    describeRejectedUpdateVersion,
    clearUpdateBackgroundBlurTimer,
    clearUpdateCheckTimeoutTimer,
    armUpdateCheckTimeout,
    clearUpdateDownloadStallTimer,
    isStalledDownloadCancellationSuppressionArmed,
    consumeStalledDownloadCancellationSuppression,
    armUpdateDownloadStallTimer,
    updateDownloadStallTimerOnProgress,
    markDesktopAppBackgrounded,
    handleDesktopAppForegrounded,
    beginActiveUpdateCheck,
  };
}
