import type { DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import { app } from "electron";
import { formatErrorMessage } from "../lifecycle/desktopLogging";
import { makeDeferredDesktopQuitIntentCoordinator } from "../lifecycle/desktopQuitIntent";
import { resolveDesktopRuntimeInfo } from "../lifecycle/runtimeArch";
import { createAutoUpdater } from "./autoUpdater";
import { createInstallRecovery } from "./installRecovery";
import { createUpdateActivity } from "./updateActivity";
import { createUpdateCache } from "./updateCache";
import { createUpdateDomainState } from "./updateDomainState";
import { createUpdateDownload } from "./updateDownload";
import { createUpdateInstall } from "./updateInstall";
import { markInstallHandoffSync } from "./updateInstallMarker";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnInstallFailure,
} from "./updateMachine";
import { desktopFlavor } from "../desktopEnvironment";
import { desktopIdentity, isDevelopment } from "../desktopEnvironment";
import { getAutoUpdateDisabledReason } from "./updateState";

export interface UpdateResources {
  readAppUpdateYml: () => Record<string, string> | null;
  resolveEmbeddedWindowsPublisherSubjects: () => string[];
}

export interface UpdateLifecycle {
  isQuitting: () => boolean;
  setQuitting: (value: boolean) => void;
  hasShutdownStarted: () => boolean;
  startBackend: () => void;
  stopBackendAndWaitForExit: () => Promise<void>;
  requestGracefulAppQuit: (reason: string) => void;
  writeDesktopLogHeader: (message: string) => void;
}

export function createUpdates(input: {
  resources: UpdateResources;
  lifecycle: UpdateLifecycle;
  notifications: { clearUnreadNotificationBadge: () => void };
}) {
  const { resources, lifecycle, notifications } = input;
  const deferredQuit = makeDeferredDesktopQuitIntentCoordinator();
  const resolveAutoUpdateDisabledReason = (): string | null =>
    getAutoUpdateDisabledReason({
      isDevelopment,
      isPackaged: app.isPackaged,
      platform: process.platform,
      appImage: process.env.APPIMAGE,
      disabledByEnv:
        desktopIdentity.usesScriptedUpdates || process.env.GLADE_DISABLE_AUTO_UPDATE === "1",
      hasUpdateFeedConfig:
        resources.readAppUpdateYml() !== null || Boolean(process.env.GLADE_DESKTOP_MOCK_UPDATES),
    });
  const desktopRuntimeInfo = resolveDesktopRuntimeInfo({
    platform: process.platform,
    processArch: process.arch,
    runningUnderArm64Translation: app.runningUnderARM64Translation === true,
  });
  const initialState = createInitialDesktopUpdateState(
    app.getVersion(),
    desktopRuntimeInfo,
    desktopFlavor === "development" ? "production" : desktopFlavor,
  );
  const { status, activity, download, install, cache, cancellation } =
    createUpdateDomainState(initialState);

  let downloadActions!: ReturnType<typeof createUpdateDownload>;
  let recovery!: ReturnType<typeof createInstallRecovery>;

  const activityActions = createUpdateActivity({
    status,
    activity,
    download,
    cancellation,
    checkForUpdates: (reason) => downloadActions.checkForUpdates(reason),
    resolveAutoUpdateDisabledReason,
    clearUnreadNotificationBadge: notifications.clearUnreadNotificationBadge,
  });
  const cacheActions = createUpdateCache({
    status,
    cache,
    download,
    getUpdateInstallMarkerPath: () => recovery.getUpdateInstallMarkerPath(),
    setUpdateState: activityActions.setUpdateState,
    logMacUpdateDiagnostics: (context) => recovery.logMacUpdateDiagnostics(context),
  });
  downloadActions = createUpdateDownload({
    status,
    download,
    install,
    lifecycle: { isQuitting: lifecycle.isQuitting },
    activity: {
      isExplicitUpdateCheckReason: activityActions.isExplicitUpdateCheckReason,
      scheduleUpdatePoll: activityActions.scheduleUpdatePoll,
      beginActiveUpdateCheck: activityActions.beginActiveUpdateCheck,
      setUpdateState: activityActions.setUpdateState,
      clearUpdateCheckTimeoutTimer: activityActions.clearUpdateCheckTimeoutTimer,
    },
    timing: {
      armUpdateCheckTimeout: activityActions.armUpdateCheckTimeout,
      armUpdateDownloadStallTimer: activityActions.armUpdateDownloadStallTimer,
      clearUpdateDownloadStallTimer: activityActions.clearUpdateDownloadStallTimer,
    },
    version: {
      isAcceptableUpdateVersion: activityActions.isAcceptableUpdateVersion,
      describeRejectedUpdateVersion: activityActions.describeRejectedUpdateVersion,
    },
    cache: {
      clearPendingUpdateCache: cacheActions.clearPendingUpdateCache,
      clearPendingUpdateCacheWhenSafe: cacheActions.clearPendingUpdateCacheWhenSafe,
      pendingClear: cache.pendingClear,
    },
  });
  recovery = createInstallRecovery({
    status,
    download,
    install,
    activity: {
      setUpdateState: activityActions.setUpdateState,
      scheduleUpdatePoll: activityActions.scheduleUpdatePoll,
    },
    lifecycle: {
      isQuitting: lifecycle.isQuitting,
      setQuitting: lifecycle.setQuitting,
      hasShutdownStarted: lifecycle.hasShutdownStarted,
      startBackend: lifecycle.startBackend,
      requestGracefulAppQuit: lifecycle.requestGracefulAppQuit,
      writeDesktopLogHeader: lifecycle.writeDesktopLogHeader,
    },
    deferredQuit,
  });
  const installActions = createUpdateInstall({
    status,
    download,
    install,
    activity: {
      activeCheck: () => activity.activeCheck,
      checkForUpdates: downloadActions.checkForUpdates,
      downloadAvailableUpdate: downloadActions.downloadAvailableUpdate,
      setUpdateState: activityActions.setUpdateState,
      clearUpdatePollTimer: activityActions.clearUpdatePollTimer,
    },
    cache: { clearPendingUpdateCache: cacheActions.clearPendingUpdateCache },
    recovery: {
      getUpdateInstallMarkerPath: recovery.getUpdateInstallMarkerPath,
      logMacUpdateDiagnostics: recovery.logMacUpdateDiagnostics,
      armInstallWatchdog: recovery.armInstallWatchdog,
      clearUpdaterInstallInFlightAfterError: recovery.clearUpdaterInstallInFlightAfterError,
      recordInstallMarkerFailure: recovery.recordInstallMarkerFailure,
      recoverDesktopAfterUpdaterInstallFailure: recovery.recoverDesktopAfterUpdaterInstallFailure,
      replayDeferredDesktopQuitAfterUpdaterSettles:
        recovery.replayDeferredDesktopQuitAfterUpdaterSettles,
    },
    lifecycle: {
      isQuitting: lifecycle.isQuitting,
      setQuitting: lifecycle.setQuitting,
      stopBackendAndWaitForExit: lifecycle.stopBackendAndWaitForExit,
      resolveAutoUpdateDisabledReason,
    },
    version: {
      isAcceptableUpdateVersion: activityActions.isAcceptableUpdateVersion,
      describeRejectedUpdateVersion: activityActions.describeRejectedUpdateVersion,
    },
  });
  const updater = createAutoUpdater({
    status,
    activityState: activity,
    download,
    install,
    resources: {
      readAppUpdateYml: resources.readAppUpdateYml,
      resolveEmbeddedWindowsPublisherSubjects: resources.resolveEmbeddedWindowsPublisherSubjects,
      processInstallMarkerOnStartup: cacheActions.processInstallMarkerOnStartup,
      shouldEnableAutoUpdates: activityActions.shouldEnableAutoUpdates,
      desktopRuntimeInfo,
    },
    activity: {
      setUpdateState: activityActions.setUpdateState,
      clearUpdateCheckTimeoutTimer: activityActions.clearUpdateCheckTimeoutTimer,
      isAcceptableUpdateVersion: activityActions.isAcceptableUpdateVersion,
      describeRejectedUpdateVersion: activityActions.describeRejectedUpdateVersion,
      clearPendingUpdateCache: cacheActions.clearPendingUpdateCache,
      clearUpdatePollTimer: activityActions.clearUpdatePollTimer,
      scheduleUpdatePoll: activityActions.scheduleUpdatePoll,
      checkForUpdates: downloadActions.checkForUpdates,
    },
    downloadActions: {
      prepareAvailableUpdateInBackground: downloadActions.prepareAvailableUpdateInBackground,
      recordDownloadedUpdateIdentity: downloadActions.recordDownloadedUpdateIdentity,
      updateDownloadStallTimerOnProgress: activityActions.updateDownloadStallTimerOnProgress,
    },
    recovery: {
      resolveUpdaterErrorContext: recovery.resolveUpdaterErrorContext,
      isStalledDownloadCancellationSuppressionArmed:
        activityActions.isStalledDownloadCancellationSuppressionArmed,
      consumeStalledDownloadCancellationSuppression:
        activityActions.consumeStalledDownloadCancellationSuppression,
      clearUpdaterInstallInFlightAfterError: recovery.clearUpdaterInstallInFlightAfterError,
      recordInstallMarkerFailure: recovery.recordInstallMarkerFailure,
      recoverDesktopAfterUpdaterInstallFailure: recovery.recoverDesktopAfterUpdaterInstallFailure,
    },
  });

  function beforeQuit(event: { preventDefault(): void }): boolean {
    if (install.handoffInFlight) {
      try {
        if (
          !install.activeHandoff ||
          !markInstallHandoffSync(recovery.getUpdateInstallMarkerPath(), install.activeHandoff)
        ) {
          throw new Error("Durable update install handoff no longer matches the active attempt.");
        }
      } catch (error) {
        event.preventDefault();
        const failedHandoff = install.activeHandoff;
        recovery.clearUpdaterInstallInFlightAfterError();
        const consecutiveFailures = recovery.recordInstallMarkerFailure(
          new Date().toISOString(),
          failedHandoff,
        );
        activityActions.setUpdateState({
          ...reduceDesktopUpdateStateOnInstallFailure(
            status.state,
            "The downloaded update could not be handed to the installer safely.",
          ),
          installFailureCount: consecutiveFailures,
        });
        console.error(
          `[desktop-updater] Refused mismatched install handoff during quit: ${formatErrorMessage(error)}`,
        );
        recovery.recoverDesktopAfterUpdaterInstallFailure();
        return true;
      }
      if (deferredQuit.observeUpdaterQuitAttempt()) {
        lifecycle.writeDesktopLogHeader(
          "deferred quit preserved through updater quit-and-install attempt",
        );
      }
      lifecycle.writeDesktopLogHeader("before-quit allowing updater quit-and-install");
      return true;
    }
    if (install.preparing) {
      recovery.deferDesktopQuitUntilUpdaterSettles("before-quit");
      event.preventDefault();
      return true;
    }
    return false;
  }

  function clearTimers(): void {
    activityActions.clearUpdateBackgroundBlurTimer();
    activityActions.clearUpdateCheckTimeoutTimer();
    activityActions.clearUpdatePollTimer();
  }

  return {
    getState: (): DesktopUpdateState => status.state,
    emitState: activityActions.emitUpdateState,
    configure: updater.configureAutoUpdater,
    check: downloadActions.checkForUpdates,
    download: downloadActions.downloadAvailableUpdate,
    install: installActions.installDownloadedUpdate,
    isInstallPreparing: () => install.preparing,
    isInstallHandoff: () => install.handoffInFlight,
    clearTimers,
    deferQuit: recovery.deferDesktopQuitUntilUpdaterSettles,
    beforeQuit,
    markDesktopAppBackgrounded: activityActions.markDesktopAppBackgrounded,
    handleDesktopAppForegrounded: activityActions.handleDesktopAppForegrounded,
  };
}
