import { desktopUpdateChannel } from "@glade/shared/platform/desktopIdentity";
import { app } from "electron";
import { autoUpdater, BaseUpdater } from "electron-updater";
import { type DesktopRuntime } from "../desktopRuntimeTypes";
import { isArm64HostRunningIntelBuild } from "../lifecycle/runtimeArch";
import { hardenElectronUpdater } from "./electronUpdaterSecurity";
import { buildGitHubReleasesPageUrl, resolveGitHubUpdateSource } from "./githubUpdateFeed";
import {
  installResumableUpdateDownloader,
  type ResumableDownloaderTarget,
} from "./resumableUpdateDownload";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnDownloadProgress,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from "./updateMachine";
import { resolveElectronUpdaterCacheDirName } from "./updatePendingCache";
import {
  isExpectedStalledDownloadCancellationError,
  shouldBroadcastDownloadProgress,
} from "./updateState";

export function createAutoUpdater(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "readAppUpdateYml"
    | "configuredUpdaterCacheDirName"
    | "shouldEnableAutoUpdates"
    | "setUpdateState"
    | "desktopRuntimeInfo"
    | "desktopFlavor"
    | "processInstallMarkerOnStartup"
    | "updaterConfigured"
    | "resolveEmbeddedWindowsPublisherSubjects"
    | "DESKTOP_UPDATE_ALLOW_PRERELEASE"
    | "clearUpdateCheckTimeoutTimer"
    | "downloadedUpdateArtifact"
    | "isAcceptableUpdateVersion"
    | "clearPendingUpdateCache"
    | "describeRejectedUpdateVersion"
    | "updateState"
    | "prepareAvailableUpdateInBackground"
    | "formatErrorMessage"
    | "resolveUpdaterErrorContext"
    | "isStalledDownloadCancellationSuppressionArmed"
    | "consumeStalledDownloadCancellationSuppression"
    | "activeUpdateInstallHandoff"
    | "clearUpdaterInstallInFlightAfterError"
    | "recordInstallMarkerFailure"
    | "updateCheckInFlight"
    | "updateDownloadInFlight"
    | "recoverDesktopAfterUpdaterInstallFailure"
    | "updateDownloadStallTimerOnProgress"
    | "recordDownloadedUpdateIdentity"
    | "downloadedUpdateIdentityTask"
    | "clearUpdatePollTimer"
    | "automaticUpdateActivitySuppressed"
    | "updateStartupTimer"
    | "checkForUpdates"
    | "AUTO_UPDATE_STARTUP_DELAY_MS"
    | "scheduleUpdatePoll"
  >,
) {
  function configureAutoUpdater(): void {
    const appUpdateYml = desktopRuntime.readAppUpdateYml();
    desktopRuntime.configuredUpdaterCacheDirName = resolveElectronUpdaterCacheDirName(
      appUpdateYml,
      app.getName(),
    );
    const githubUpdateSource = resolveGitHubUpdateSource(appUpdateYml);
    const releaseUrl =
      githubUpdateSource === null ? null : buildGitHubReleasesPageUrl(githubUpdateSource);
    const enabled = desktopRuntime.shouldEnableAutoUpdates();
    desktopRuntime.setUpdateState({
      ...createInitialDesktopUpdateState(
        app.getVersion(),
        desktopRuntime.desktopRuntimeInfo,
        desktopRuntime.desktopFlavor === "development"
          ? "production"
          : desktopRuntime.desktopFlavor,
      ),
      enabled,
      status: enabled ? "idle" : "disabled",
      releaseUrl,
    });
    desktopRuntime.processInstallMarkerOnStartup();
    if (!enabled) {
      desktopRuntime.configuredUpdaterCacheDirName = null;
      return;
    }
    desktopRuntime.updaterConfigured = true;
    hardenElectronUpdater(
      { BaseUpdater },
      autoUpdater,
      process.platform,
      app.isPackaged ? desktopRuntime.resolveEmbeddedWindowsPublisherSubjects() : null,
    );

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.channel = desktopUpdateChannel(desktopRuntime.desktopFlavor);
    autoUpdater.allowPrerelease = desktopRuntime.DESKTOP_UPDATE_ALLOW_PRERELEASE;
    autoUpdater.allowDowngrade = false;

    autoUpdater.disableDifferentialDownload =
      process.platform === "darwin" ||
      isArm64HostRunningIntelBuild(desktopRuntime.desktopRuntimeInfo);
    // electron-updater has no working idle timeout on macOS (its socket timeout is wired to a `socket`
    // event Electron's net.request never emits) and never resumes from a byte offset, so a stalled CDN
    // transfer hangs for minutes until TCP recovers on its own. installResumableUpdateDownloader
    // replaces the download transfer with a stall-aware, resumable one and installs a real idle
    // timeout, so an intermittent stall becomes a brief reconnect-and-resume instead of a multi-minute
    // freeze.
    if (!installResumableUpdateDownloader(autoUpdater as unknown as ResumableDownloaderTarget)) {
      console.warn(
        "[desktop-updater] Could not install resumable update downloader; falling back to default transfer.",
      );
    }
    let lastLoggedDownloadMilestone = -1;

    if (isArm64HostRunningIntelBuild(desktopRuntime.desktopRuntimeInfo)) {
      console.info(
        "[desktop-updater] Apple Silicon host detected while running Intel build; updates will switch to arm64 packages.",
      );
    }

    autoUpdater.on("checking-for-update", () => {
      console.info("[desktop-updater] Looking for updates...");
    });
    autoUpdater.on("update-available", (info) => {
      desktopRuntime.clearUpdateCheckTimeoutTimer();
      desktopRuntime.downloadedUpdateArtifact = null;
      if (!desktopRuntime.isAcceptableUpdateVersion(info.version)) {
        void desktopRuntime.clearPendingUpdateCache(
          `available update rejected: ${desktopRuntime.describeRejectedUpdateVersion(info.version)}`,
        );
        desktopRuntime.setUpdateState(
          reduceDesktopUpdateStateOnNoUpdate(desktopRuntime.updateState, new Date().toISOString()),
        );
        lastLoggedDownloadMilestone = -1;
        console.info(
          `[desktop-updater] Ignoring available update: ${desktopRuntime.describeRejectedUpdateVersion(info.version)}.`,
        );
        return;
      }
      desktopRuntime.setUpdateState(
        reduceDesktopUpdateStateOnUpdateAvailable(
          desktopRuntime.updateState,
          info.version,
          new Date().toISOString(),
        ),
      );
      lastLoggedDownloadMilestone = -1;
      console.info(`[desktop-updater] Update available: ${info.version}`);
      desktopRuntime.prepareAvailableUpdateInBackground(`available ${info.version}`);
    });
    autoUpdater.on("update-not-available", () => {
      desktopRuntime.clearUpdateCheckTimeoutTimer();
      desktopRuntime.downloadedUpdateArtifact = null;
      void desktopRuntime.clearPendingUpdateCache("no newer update available");
      desktopRuntime.setUpdateState(
        reduceDesktopUpdateStateOnNoUpdate(desktopRuntime.updateState, new Date().toISOString()),
      );
      lastLoggedDownloadMilestone = -1;
      console.info("[desktop-updater] No updates available.");
    });
    autoUpdater.on("error", (error) => {
      desktopRuntime.clearUpdateCheckTimeoutTimer();
      const message = desktopRuntime.formatErrorMessage(error);
      const errorContext = desktopRuntime.resolveUpdaterErrorContext();
      if (
        isExpectedStalledDownloadCancellationError({
          suppressionArmed: desktopRuntime.isStalledDownloadCancellationSuppressionArmed(),
          errorContext,
          message,
        })
      ) {
        desktopRuntime.consumeStalledDownloadCancellationSuppression();
        console.warn("[desktop-updater] Ignored expected cancellation after stalled download.");
        return;
      }
      const failedHandoff = desktopRuntime.activeUpdateInstallHandoff;
      const installPreparationPending = desktopRuntime.clearUpdaterInstallInFlightAfterError({
        preservePendingPreparation: true,
      });
      if (errorContext === "download") {
        desktopRuntime.downloadedUpdateArtifact = null;
      }
      const installFailureCount =
        errorContext === "install"
          ? desktopRuntime.recordInstallMarkerFailure(new Date().toISOString(), failedHandoff)
          : desktopRuntime.updateState.installFailureCount;
      if (!desktopRuntime.updateCheckInFlight && !desktopRuntime.updateDownloadInFlight) {
        desktopRuntime.setUpdateState({
          status: "error",
          message,
          checkedAt: new Date().toISOString(),
          downloadPercent: null,
          errorContext,
          canRetry:
            desktopRuntime.updateState.availableVersion !== null ||
            desktopRuntime.updateState.downloadedVersion !== null,
          installFailureCount,
        });
      }
      console.error(`[desktop-updater] Updater error: ${message}`);
      if (errorContext === "install" && !installPreparationPending) {
        desktopRuntime.recoverDesktopAfterUpdaterInstallFailure();
      }
    });
    autoUpdater.on("download-progress", (progress) => {
      const percent = Math.floor(progress.percent);
      desktopRuntime.updateDownloadStallTimerOnProgress(progress);
      if (
        shouldBroadcastDownloadProgress(desktopRuntime.updateState, progress.percent) ||
        desktopRuntime.updateState.message !== null
      ) {
        desktopRuntime.setUpdateState(
          reduceDesktopUpdateStateOnDownloadProgress(desktopRuntime.updateState, progress.percent),
        );
      }
      const milestone = percent - (percent % 10);
      if (milestone > lastLoggedDownloadMilestone) {
        lastLoggedDownloadMilestone = milestone;
        console.info(`[desktop-updater] Download progress: ${percent}%`);
      }
    });
    autoUpdater.on("update-downloaded", (info) => {
      const task = desktopRuntime.recordDownloadedUpdateIdentity(info);
      desktopRuntime.downloadedUpdateIdentityTask = task;
      const clearTask = () => {
        if (desktopRuntime.downloadedUpdateIdentityTask === task)
          desktopRuntime.downloadedUpdateIdentityTask = null;
      };
      void task.then(clearTask, clearTask);
    });

    desktopRuntime.clearUpdatePollTimer();

    if (desktopRuntime.automaticUpdateActivitySuppressed) {
      console.info(
        "[desktop-updater] Startup and periodic update checks suppressed after failed install verification.",
      );
      return;
    }

    desktopRuntime.updateStartupTimer = setTimeout(() => {
      desktopRuntime.updateStartupTimer = null;
      void desktopRuntime.checkForUpdates("startup");
    }, desktopRuntime.AUTO_UPDATE_STARTUP_DELAY_MS);
    desktopRuntime.updateStartupTimer.unref();

    desktopRuntime.scheduleUpdatePoll();
  }
  return { configureAutoUpdater };
}
