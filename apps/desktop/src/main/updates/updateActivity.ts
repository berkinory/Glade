import type { DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import { app, BrowserWindow } from "electron";
import { type DesktopRuntime } from "../desktopRuntimeTypes";
import { reduceDesktopUpdateStateOnCheckFailure } from "./updateMachine";
import {
  getDownloadStallTimeoutMessage,
  hasDownloadProgressAdvanced,
  isUpdateVersionAllowedForFlavor,
  isUpdateVersionNewer,
  shouldCheckForUpdatesOnForeground,
  type DownloadProgressSample,
} from "./updateState";

export function createUpdateActivity(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "updateStartupTimer"
    | "updatePollTimer"
    | "automaticUpdateActivitySuppressed"
    | "checkForUpdates"
    | "AUTO_UPDATE_POLL_INTERVAL_MS"
    | "UPDATE_CHECK_REASON_MIGRATION_RECOVERY"
    | "IPC"
    | "updateState"
    | "resolveAutoUpdateDisabledReason"
    | "desktopFlavor"
    | "updateBackgroundBlurTimer"
    | "updateCheckTimeoutTimer"
    | "updateCheckInFlight"
    | "settleActiveUpdateCheck"
    | "AUTO_UPDATE_CHECK_TIMEOUT_MS"
    | "updateDownloadStallTimer"
    | "stalledDownloadCancellationSuppressionsRemaining"
    | "stalledDownloadCancellationSuppressionExpiresAtMs"
    | "AUTO_UPDATE_STALLED_DOWNLOAD_CANCELLATION_SUPPRESSION_MS"
    | "updateDownloadInFlight"
    | "AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS"
    | "rejectUpdateDownloadStall"
    | "updateDownloadCancellationToken"
    | "lastUpdateDownloadProgressSample"
    | "updateBackgroundedAtMs"
    | "clearUnreadNotificationBadge"
    | "AUTO_UPDATE_FOREGROUND_RECHECK_MIN_BACKGROUND_MS"
    | "AUTO_UPDATE_FOREGROUND_RECHECK_MIN_INTERVAL_MS"
    | "activeUpdateCheck"
  >,
) {
  function clearUpdatePollTimer(): void {
    if (desktopRuntime.updateStartupTimer) {
      clearTimeout(desktopRuntime.updateStartupTimer);
      desktopRuntime.updateStartupTimer = null;
    }
    if (desktopRuntime.updatePollTimer) {
      clearInterval(desktopRuntime.updatePollTimer);
      desktopRuntime.updatePollTimer = null;
    }
  }

  function scheduleUpdatePoll(): void {
    if (desktopRuntime.updatePollTimer || desktopRuntime.automaticUpdateActivitySuppressed) {
      return;
    }
    desktopRuntime.updatePollTimer = setInterval(() => {
      void desktopRuntime.checkForUpdates("poll");
    }, desktopRuntime.AUTO_UPDATE_POLL_INTERVAL_MS);
    desktopRuntime.updatePollTimer.unref();
  }

  function isExplicitUpdateCheckReason(reason: string): boolean {
    return (
      reason === "menu" ||
      reason === "renderer" ||
      reason === desktopRuntime.UPDATE_CHECK_REASON_MIGRATION_RECOVERY
    );
  }

  function emitUpdateState(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(desktopRuntime.IPC.updateState, desktopRuntime.updateState);
    }
  }

  function setUpdateState(patch: Partial<DesktopUpdateState>): void {
    desktopRuntime.updateState = { ...desktopRuntime.updateState, ...patch };
    emitUpdateState();
  }

  function shouldEnableAutoUpdates(): boolean {
    return desktopRuntime.resolveAutoUpdateDisabledReason() === null;
  }

  function isAcceptableUpdateVersion(version: string | null | undefined): boolean {
    return (
      typeof version === "string" &&
      isUpdateVersionAllowedForFlavor(version, desktopRuntime.desktopFlavor) &&
      isUpdateVersionNewer(app.getVersion(), version)
    );
  }

  function describeRejectedUpdateVersion(version: string): string {
    if (!isUpdateVersionAllowedForFlavor(version, desktopRuntime.desktopFlavor)) {
      return `version ${version} is not on the "${desktopRuntime.desktopFlavor}" flavor's update lane`;
    }
    return `version ${version} is not newer than current ${app.getVersion()}`;
  }

  function clearUpdateBackgroundBlurTimer(): void {
    if (desktopRuntime.updateBackgroundBlurTimer) {
      clearTimeout(desktopRuntime.updateBackgroundBlurTimer);
      desktopRuntime.updateBackgroundBlurTimer = null;
    }
  }

  function clearUpdateCheckTimeoutTimer(): void {
    if (desktopRuntime.updateCheckTimeoutTimer) {
      clearTimeout(desktopRuntime.updateCheckTimeoutTimer);
      desktopRuntime.updateCheckTimeoutTimer = null;
    }
  }

  function armUpdateCheckTimeout(reason: string): void {
    clearUpdateCheckTimeoutTimer();
    desktopRuntime.updateCheckTimeoutTimer = setTimeout(() => {
      desktopRuntime.updateCheckTimeoutTimer = null;
      if (desktopRuntime.updateState.status !== "checking") {
        return;
      }
      desktopRuntime.updateCheckInFlight = false;
      // electron-updater may never settle its own promise, so this is also where anyone awaiting the
      // check has to be released.
      desktopRuntime.settleActiveUpdateCheck?.();
      setUpdateState(
        reduceDesktopUpdateStateOnCheckFailure(
          desktopRuntime.updateState,
          "Timed out while checking for updates. Try again.",
          new Date().toISOString(),
        ),
      );
      console.error(`[desktop-updater] Update check timed out (${reason}).`);
    }, desktopRuntime.AUTO_UPDATE_CHECK_TIMEOUT_MS);
    desktopRuntime.updateCheckTimeoutTimer.unref();
  }

  function clearUpdateDownloadStallTimer(): void {
    if (desktopRuntime.updateDownloadStallTimer) {
      clearTimeout(desktopRuntime.updateDownloadStallTimer);
      desktopRuntime.updateDownloadStallTimer = null;
    }
  }

  function clearStalledDownloadCancellationSuppression(): void {
    desktopRuntime.stalledDownloadCancellationSuppressionsRemaining = 0;
    desktopRuntime.stalledDownloadCancellationSuppressionExpiresAtMs = 0;
  }

  function armStalledDownloadCancellationSuppression(): void {
    desktopRuntime.stalledDownloadCancellationSuppressionsRemaining += 1;
    desktopRuntime.stalledDownloadCancellationSuppressionExpiresAtMs =
      Date.now() + desktopRuntime.AUTO_UPDATE_STALLED_DOWNLOAD_CANCELLATION_SUPPRESSION_MS;
  }

  function isStalledDownloadCancellationSuppressionArmed(): boolean {
    if (desktopRuntime.stalledDownloadCancellationSuppressionsRemaining <= 0) {
      return false;
    }
    if (Date.now() <= desktopRuntime.stalledDownloadCancellationSuppressionExpiresAtMs) {
      return true;
    }
    clearStalledDownloadCancellationSuppression();
    return false;
  }

  function consumeStalledDownloadCancellationSuppression(): void {
    desktopRuntime.stalledDownloadCancellationSuppressionsRemaining = Math.max(
      0,
      desktopRuntime.stalledDownloadCancellationSuppressionsRemaining - 1,
    );
    if (desktopRuntime.stalledDownloadCancellationSuppressionsRemaining === 0) {
      desktopRuntime.stalledDownloadCancellationSuppressionExpiresAtMs = 0;
    }
  }

  function armUpdateDownloadStallTimer(reason: string): void {
    clearUpdateDownloadStallTimer();
    desktopRuntime.updateDownloadStallTimer = setTimeout(() => {
      desktopRuntime.updateDownloadStallTimer = null;
      if (
        !desktopRuntime.updateDownloadInFlight ||
        desktopRuntime.updateState.status !== "downloading"
      ) {
        return;
      }

      const error = new Error(
        getDownloadStallTimeoutMessage(desktopRuntime.AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS),
      );
      console.error(`[desktop-updater] ${error.message} (${reason}).`);
      armStalledDownloadCancellationSuppression();
      desktopRuntime.rejectUpdateDownloadStall?.(error);
      desktopRuntime.updateDownloadCancellationToken?.cancel();
    }, desktopRuntime.AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS);
    desktopRuntime.updateDownloadStallTimer.unref();
  }

  function updateDownloadStallTimerOnProgress(progress: DownloadProgressSample): void {
    if (!desktopRuntime.updateDownloadInFlight) {
      return;
    }
    if (!hasDownloadProgressAdvanced(desktopRuntime.lastUpdateDownloadProgressSample, progress)) {
      return;
    }
    desktopRuntime.lastUpdateDownloadProgressSample = {
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
    desktopRuntime.updateBackgroundBlurTimer = setTimeout(() => {
      desktopRuntime.updateBackgroundBlurTimer = null;
      if (isDesktopAppForegrounded()) {
        return;
      }
      desktopRuntime.updateBackgroundedAtMs = Date.now();
    }, 0);
  }

  function handleDesktopAppForegrounded(): void {
    clearUpdateBackgroundBlurTimer();
    desktopRuntime.clearUnreadNotificationBadge();
    const foregroundedAtMs = Date.now();
    const backgroundedAtMs = desktopRuntime.updateBackgroundedAtMs;
    desktopRuntime.updateBackgroundedAtMs = null;
    const shouldCheck = shouldCheckForUpdatesOnForeground({
      checkedAt: desktopRuntime.updateState.checkedAt,
      backgroundedAtMs,
      foregroundedAtMs,
      minBackgroundDurationMs: desktopRuntime.AUTO_UPDATE_FOREGROUND_RECHECK_MIN_BACKGROUND_MS,
      minIntervalMs: desktopRuntime.AUTO_UPDATE_FOREGROUND_RECHECK_MIN_INTERVAL_MS,
    });
    if (!shouldCheck) {
      return;
    }
    void desktopRuntime.checkForUpdates("foreground");
  }

  function beginActiveUpdateCheck(): () => void {
    let settle!: () => void;
    const check = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const finish = (): void => {
      settle();
      if (desktopRuntime.activeUpdateCheck === check) {
        desktopRuntime.activeUpdateCheck = null;
        desktopRuntime.settleActiveUpdateCheck = null;
      }
    };
    desktopRuntime.activeUpdateCheck = check;
    desktopRuntime.settleActiveUpdateCheck = finish;
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
