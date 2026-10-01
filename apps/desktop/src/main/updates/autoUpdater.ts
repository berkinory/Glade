import type { DesktopRuntimeInfo, DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import { desktopUpdateChannel } from "@glade/shared/platform/desktopIdentity";
import { app } from "electron";
import { autoUpdater, BaseUpdater, type UpdateDownloadedEvent } from "electron-updater";
import {
  desktopFlavor,
  DESKTOP_UPDATE_ALLOW_PRERELEASE,
  AUTO_UPDATE_STARTUP_DELAY_MS,
} from "../desktopEnvironment";
import { formatErrorMessage } from "../lifecycle/desktopLogging";
import type {
  UpdateStatus,
  UpdateActivityState,
  UpdateDownloadState,
  UpdateInstallState,
} from "./updateDomainState";
import type { UpdateInstallHandoffExpectation } from "./updateInstallMarker";
import { isArm64HostRunningIntelBuild } from "../lifecycle/runtimeArch";
import { hardenElectronUpdater } from "./electronUpdaterSecurity";
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
  buildGitHubReleasesPageUrl,
  resolveGitHubUpdateSource,
  isExpectedStalledDownloadCancellationError,
  shouldBroadcastDownloadProgress,
  type DownloadProgressSample,
} from "./updateState";

export function createAutoUpdater(input: {
  status: UpdateStatus;
  activityState: UpdateActivityState;
  download: UpdateDownloadState;
  install: UpdateInstallState;
  resources: {
    readAppUpdateYml: () => Record<string, string> | null;
    resolveEmbeddedWindowsPublisherSubjects: () => string[];
    processInstallMarkerOnStartup: () => void;
    shouldEnableAutoUpdates: () => boolean;
    desktopRuntimeInfo: DesktopRuntimeInfo;
  };
  activity: {
    setUpdateState: (patch: Partial<DesktopUpdateState>) => void;
    clearUpdateCheckTimeoutTimer: () => void;
    isAcceptableUpdateVersion: (version: string | null | undefined) => boolean;
    describeRejectedUpdateVersion: (version: string) => string;
    clearPendingUpdateCache: (reason: string) => Promise<void>;
    clearUpdatePollTimer: () => void;
    scheduleUpdatePoll: () => void;
    checkForUpdates: (reason: string) => Promise<void>;
  };
  downloadActions: {
    prepareAvailableUpdateInBackground: (reason: string) => void;
    recordDownloadedUpdateIdentity: (info: UpdateDownloadedEvent) => Promise<void>;
    updateDownloadStallTimerOnProgress: (progress: DownloadProgressSample) => void;
  };
  recovery: {
    resolveUpdaterErrorContext: () => DesktopUpdateState["errorContext"];
    isStalledDownloadCancellationSuppressionArmed: () => boolean;
    consumeStalledDownloadCancellationSuppression: () => void;
    clearUpdaterInstallInFlightAfterError: (input?: {
      preservePendingPreparation?: boolean;
    }) => boolean;
    recordInstallMarkerFailure: (
      nowIso: string,
      expected: UpdateInstallHandoffExpectation | null,
    ) => number;
    recoverDesktopAfterUpdaterInstallFailure: () => void;
  };
}) {
  const {
    status,
    activityState,
    download,
    install,
    resources,
    activity,
    downloadActions,
    recovery,
  } = input;
  function configureAutoUpdater(): void {
    const appUpdateYml = resources.readAppUpdateYml();
    status.cacheDirectoryName = resolveElectronUpdaterCacheDirName(appUpdateYml, app.getName());
    const githubUpdateSource = resolveGitHubUpdateSource(appUpdateYml);
    const releaseUrl =
      githubUpdateSource === null ? null : buildGitHubReleasesPageUrl(githubUpdateSource);
    const enabled = resources.shouldEnableAutoUpdates();
    activity.setUpdateState({
      ...createInitialDesktopUpdateState(
        app.getVersion(),
        resources.desktopRuntimeInfo,
        desktopFlavor === "development" ? "production" : desktopFlavor,
      ),
      enabled,
      status: enabled ? "idle" : "disabled",
      releaseUrl,
    });
    resources.processInstallMarkerOnStartup();
    if (!enabled) {
      status.cacheDirectoryName = null;
      return;
    }
    status.configured = true;
    hardenElectronUpdater(
      { BaseUpdater },
      autoUpdater,
      process.platform,
      app.isPackaged ? resources.resolveEmbeddedWindowsPublisherSubjects() : null,
    );

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.channel = desktopUpdateChannel(desktopFlavor);
    autoUpdater.allowPrerelease = DESKTOP_UPDATE_ALLOW_PRERELEASE;
    autoUpdater.allowDowngrade = false;

    autoUpdater.disableDifferentialDownload =
      process.platform === "darwin" || isArm64HostRunningIntelBuild(resources.desktopRuntimeInfo);
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

    if (isArm64HostRunningIntelBuild(resources.desktopRuntimeInfo)) {
      console.info(
        "[desktop-updater] Apple Silicon host detected while running Intel build; updates will switch to arm64 packages.",
      );
    }

    autoUpdater.on("checking-for-update", () => {
      console.info("[desktop-updater] Looking for updates...");
    });
    autoUpdater.on("update-available", (info) => {
      activity.clearUpdateCheckTimeoutTimer();
      download.artifact = null;
      if (!activity.isAcceptableUpdateVersion(info.version)) {
        void activity.clearPendingUpdateCache(
          `available update rejected: ${activity.describeRejectedUpdateVersion(info.version)}`,
        );
        activity.setUpdateState(
          reduceDesktopUpdateStateOnNoUpdate(status.state, new Date().toISOString()),
        );
        lastLoggedDownloadMilestone = -1;
        console.info(
          `[desktop-updater] Ignoring available update: ${activity.describeRejectedUpdateVersion(info.version)}.`,
        );
        return;
      }
      activity.setUpdateState(
        reduceDesktopUpdateStateOnUpdateAvailable(
          status.state,
          info.version,
          new Date().toISOString(),
        ),
      );
      lastLoggedDownloadMilestone = -1;
      console.info(`[desktop-updater] Update available: ${info.version}`);
      downloadActions.prepareAvailableUpdateInBackground(`available ${info.version}`);
    });
    autoUpdater.on("update-not-available", () => {
      activity.clearUpdateCheckTimeoutTimer();
      download.artifact = null;
      void activity.clearPendingUpdateCache("no newer update available");
      activity.setUpdateState(
        reduceDesktopUpdateStateOnNoUpdate(status.state, new Date().toISOString()),
      );
      lastLoggedDownloadMilestone = -1;
      console.info("[desktop-updater] No updates available.");
    });
    autoUpdater.on("error", (error) => {
      activity.clearUpdateCheckTimeoutTimer();
      const message = formatErrorMessage(error);
      const errorContext = recovery.resolveUpdaterErrorContext();
      if (
        isExpectedStalledDownloadCancellationError({
          suppressionArmed: recovery.isStalledDownloadCancellationSuppressionArmed(),
          errorContext,
          message,
        })
      ) {
        recovery.consumeStalledDownloadCancellationSuppression();
        console.warn("[desktop-updater] Ignored expected cancellation after stalled download.");
        return;
      }
      const failedHandoff = install.activeHandoff;
      const installPreparationPending = recovery.clearUpdaterInstallInFlightAfterError({
        preservePendingPreparation: true,
      });
      if (errorContext === "download") {
        download.artifact = null;
      }
      const installFailureCount =
        errorContext === "install"
          ? recovery.recordInstallMarkerFailure(new Date().toISOString(), failedHandoff)
          : status.state.installFailureCount;
      if (!status.checkInFlight && !download.inFlight) {
        activity.setUpdateState({
          status: "error",
          message,
          checkedAt: new Date().toISOString(),
          downloadPercent: null,
          errorContext,
          canRetry:
            status.state.availableVersion !== null || status.state.downloadedVersion !== null,
          installFailureCount,
        });
      }
      console.error(`[desktop-updater] Updater error: ${message}`);
      if (errorContext === "install" && !installPreparationPending) {
        recovery.recoverDesktopAfterUpdaterInstallFailure();
      }
    });
    autoUpdater.on("download-progress", (progress) => {
      const percent = Math.floor(progress.percent);
      downloadActions.updateDownloadStallTimerOnProgress(progress);
      if (
        shouldBroadcastDownloadProgress(status.state, progress.percent) ||
        status.state.message !== null
      ) {
        activity.setUpdateState(
          reduceDesktopUpdateStateOnDownloadProgress(status.state, progress.percent),
        );
      }
      const milestone = percent - (percent % 10);
      if (milestone > lastLoggedDownloadMilestone) {
        lastLoggedDownloadMilestone = milestone;
        console.info(`[desktop-updater] Download progress: ${percent}%`);
      }
    });
    autoUpdater.on("update-downloaded", (info) => {
      const task = downloadActions.recordDownloadedUpdateIdentity(info);
      download.identityTask = task;
      const clearTask = () => {
        if (download.identityTask === task) download.identityTask = null;
      };
      void task.then(clearTask, clearTask);
    });

    activity.clearUpdatePollTimer();

    if (status.automaticActivitySuppressed) {
      console.info(
        "[desktop-updater] Startup and periodic update checks suppressed after failed install verification.",
      );
      return;
    }

    activityState.startupTimer = setTimeout(() => {
      activityState.startupTimer = null;
      void activity.checkForUpdates("startup");
    }, AUTO_UPDATE_STARTUP_DELAY_MS);
    activityState.startupTimer.unref();

    activity.scheduleUpdatePoll();
  }
  return { configureAutoUpdater };
}
