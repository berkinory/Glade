import type { DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import { isKeyboardShortcutsHelpChord } from "@glade/shared/browser/browserShortcuts";
import {
  GLADE_SOURCE_DESKTOP_BUILD_MARKER,
  gladeDesktopIdentity,
  resolveGladeDesktopRuntimeFlavor,
} from "@glade/shared/platform/desktopIdentity";
import { configureElectronNetwork } from "betterwright/electron";
import { app, protocol, safeStorage } from "electron";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { BackendSupervisionPolicy } from "../backend/backendSupervisionPolicy";
import { BrowserVault } from "../browser/automation/browserVault";
import { BrowserVaultCapture } from "../browser/automation/browserVaultCapture";
import {
  sendBrowserAnnotationEvent,
  sendBrowserCopyLink,
  sendBrowserState,
} from "../browser/browserIpc";
import { DesktopBrowserManager } from "../browser/browserManager";
import { LOCAL_HTML_PREVIEW_SCHEME } from "../browser/localHtmlPreviewProtocol";
import { MigrationConsentHandoff } from "../storage/migrationConsentHandoff";
import { type DesktopRuntime } from "./desktopRuntimeTypes";
import { DESKTOP_IPC_CHANNELS } from "./ipc/ipcChannels";
import { makeDeferredDesktopQuitIntentCoordinator } from "./lifecycle/desktopQuitIntent";
import { RendererCrashPolicy } from "./lifecycle/rendererCrashRecovery";
import { makeRunningChatsQuitGuard } from "./lifecycle/runningChatsQuitGuard";
import { resolveDesktopRuntimeInfo } from "./lifecycle/runtimeArch";
import { syncShellEnvironment } from "./lifecycle/syncShellEnvironment";
import { makeUpdateInstallPreparationCoordinator } from "./updates/updateInstallPreparation";
import { createInitialDesktopUpdateState } from "./updates/updateMachine";
import { PendingUpdateCacheClearQueue } from "./updates/updatePendingCache";
export function initializeDesktopState(desktopRuntime: {
  -readonly [Key in keyof DesktopRuntime]: DesktopRuntime[Key];
}): void {
  desktopRuntime.requestedSourceBuildMarker = process.env.GLADE_SOURCE_DESKTOP_BUILD_MARKER;
  if (
    desktopRuntime.requestedSourceBuildMarker !== undefined &&
    desktopRuntime.requestedSourceBuildMarker !== GLADE_SOURCE_DESKTOP_BUILD_MARKER
  ) {
    throw new Error("The source desktop launcher and built main are incompatible. Rebuild Glade.");
  }
  desktopRuntime.startupBundleIdentity = desktopRuntime.captureStartupBundleIdentity();
  desktopRuntime.shellEnvironmentSync = syncShellEnvironment();
  desktopRuntime.IPC = DESKTOP_IPC_CHANNELS;
  desktopRuntime.MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH = 16 * 1024 * 1024;
  desktopRuntime.packagedDesktopFlavor = app.isPackaged
    ? (
        JSON.parse(FS.readFileSync(Path.join(app.getAppPath(), "package.json"), "utf8")) as {
          gladeDesktopFlavor?: unknown;
        }
      ).gladeDesktopFlavor
    : undefined;
  desktopRuntime.isSourceDesktopBuild =
    desktopRuntime.requestedSourceBuildMarker === GLADE_SOURCE_DESKTOP_BUILD_MARKER &&
    desktopRuntime.packagedDesktopFlavor === undefined;
  desktopRuntime.isDevelopment =
    (!app.isPackaged || desktopRuntime.isSourceDesktopBuild) &&
    Boolean(process.env.VITE_DEV_SERVER_URL);
  desktopRuntime.desktopFlavor = resolveGladeDesktopRuntimeFlavor({
    isPackaged: app.isPackaged,
    isDevelopment: desktopRuntime.isDevelopment,
    packagedFlavor: desktopRuntime.packagedDesktopFlavor,
    requestedFlavor: process.env.GLADE_DESKTOP_FLAVOR,
    allowDevelopmentOverride: desktopRuntime.isSourceDesktopBuild,
  });
  desktopRuntime.desktopIdentity = gladeDesktopIdentity(desktopRuntime.desktopFlavor);
  desktopRuntime.BASE_DIR =
    process.env.GLADE_HOME?.trim() ||
    Path.join(OS.homedir(), desktopRuntime.desktopIdentity.defaultHomeDirectoryName);
  desktopRuntime.STATE_DIR = Path.join(desktopRuntime.BASE_DIR, "userdata");
  desktopRuntime.DESKTOP_WINDOW_STATE_PATH = Path.join(
    desktopRuntime.STATE_DIR,
    "desktop-window-state.json",
  );
  desktopRuntime.DESKTOP_APP_ICON_PATH = Path.join(desktopRuntime.STATE_DIR, "desktop-app-icon");
  desktopRuntime.DESKTOP_CUSTOM_TITLE_BAR_PATH = Path.join(
    desktopRuntime.STATE_DIR,
    "desktop-custom-title-bar.json",
  );
  desktopRuntime.AGENT_CURSOR_PREFERENCE_PATH = Path.join(
    desktopRuntime.STATE_DIR,
    "agent-cursor-colors.json",
  );
  desktopRuntime.DESKTOP_SCHEME = desktopRuntime.desktopIdentity.scheme;
  desktopRuntime.ROOT_DIR = Path.resolve(__dirname, "../../..");
  desktopRuntime.APP_DISPLAY_NAME = desktopRuntime.desktopIdentity.displayName;
  desktopRuntime.APP_USER_MODEL_ID = desktopRuntime.desktopIdentity.bundleId;
  desktopRuntime.COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
  desktopRuntime.COMMIT_HASH_DISPLAY_LENGTH = 12;
  desktopRuntime.LOG_DIR = Path.join(desktopRuntime.STATE_DIR, "logs");
  desktopRuntime.DESKTOP_LOG_FILE_NAME = "desktop-main.log";
  desktopRuntime.BACKEND_LOG_FILE_NAME = "server-child.log";
  desktopRuntime.LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
  desktopRuntime.LOG_FILE_MAX_FILES = 10;
  desktopRuntime.APP_RUN_ID = Crypto.randomBytes(6).toString("hex");
  desktopRuntime.DESKTOP_BACKEND_SHUTDOWN_TOKEN = Crypto.randomBytes(32).toString("hex");
  desktopRuntime.DESKTOP_BROWSER_HOST_CAPABILITY = Crypto.randomBytes(32).toString("base64url");
  desktopRuntime.DESKTOP_BROWSER_HOST_CAPABILITY_FD = 3;
  desktopRuntime.userDataPath = desktopRuntime.resolveUserDataPath();
  app.setPath("userData", desktopRuntime.userDataPath);
  process.on("uncaughtExceptionMonitor", (_error: unknown) => {});
  desktopRuntime.hasSingleInstanceLock = app.requestSingleInstanceLock();
  desktopRuntime.AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
  desktopRuntime.AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
  desktopRuntime.AUTO_UPDATE_FOREGROUND_RECHECK_MIN_INTERVAL_MS = 5 * 60 * 1000;
  desktopRuntime.AUTO_UPDATE_FOREGROUND_RECHECK_MIN_BACKGROUND_MS = 30 * 1000;
  desktopRuntime.AUTO_UPDATE_CHECK_TIMEOUT_MS = 45 * 1000;
  desktopRuntime.AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS = 60 * 1000;
  desktopRuntime.AUTO_UPDATE_DOWNLOAD_SETTLE_TIMEOUT_MS = 20 * 1000;
  desktopRuntime.AUTO_UPDATE_STALLED_DOWNLOAD_CANCELLATION_SUPPRESSION_MS = 2 * 60 * 1000;
  desktopRuntime.AUTO_UPDATE_INSTALL_WATCHDOG_MS = 15 * 1000;
  desktopRuntime.AUTO_UPDATE_DIAGNOSTICS_TIMEOUT_MS = 2_800;
  desktopRuntime.BROWSER_SESSION_RESTORE_TIMEOUT_MS = 5_000;
  desktopRuntime.UPDATE_CHECK_REASON_MIGRATION_RECOVERY = "migration recovery";
  desktopRuntime.UPDATE_INSTALL_MARKER_FILE_NAME = "pending-update-install.json";
  desktopRuntime.BACKEND_FORCE_KILL_DELAY_MS = 8_000;
  desktopRuntime.BACKEND_SHUTDOWN_TIMEOUT_MS = 10_000;
  desktopRuntime.POSIX_BACKEND_TERMINATE_DELAY_MS = 15_000;
  desktopRuntime.POSIX_BACKEND_FORCE_KILL_DELAY_MS = 18_000;
  desktopRuntime.POSIX_BACKEND_SHUTDOWN_TIMEOUT_MS = 20_000;
  desktopRuntime.BACKEND_MAX_OLD_SPACE_ENV_KEYS = ["GLADE_BACKEND_MAX_OLD_SPACE_MB"] as const;
  desktopRuntime.DESKTOP_UPDATE_ALLOW_PRERELEASE = false;
  desktopRuntime.BROWSER_PERF_SAMPLE_INTERVAL_MS = 5_000;
  desktopRuntime.DESKTOP_MENU_ZOOM_FACTOR_STEP = 1.1;
  desktopRuntime.DESKTOP_MENU_MIN_ZOOM_FACTOR = 0.25;
  desktopRuntime.DESKTOP_MENU_MAX_ZOOM_FACTOR = 5;
  desktopRuntime.GLADE_BROWSER_LABEL = "Glade browser";
  desktopRuntime.browserPerfLoggingEnabled = process.env.GLADE_BROWSER_PERF === "1";
  desktopRuntime.mainWindow = null;
  desktopRuntime.customTitleBarActive = false;
  desktopRuntime.backendProcess = null;
  desktopRuntime.backendPort = 0;
  desktopRuntime.backendAuthToken = "";
  desktopRuntime.backendHttpUrl = "";
  desktopRuntime.backendWsUrl = "";
  desktopRuntime.backendReadinessAbortController = null;
  desktopRuntime.backendInitialWindowOpenInFlight = null;
  desktopRuntime.backendLifecycleDialogInFlight = null;
  desktopRuntime.backendListeningDetector = null;
  desktopRuntime.backendSupervision = new BackendSupervisionPolicy();
  desktopRuntime.rendererCrashPolicy = new RendererCrashPolicy();
  desktopRuntime.rendererCrashDialogInFlight = null;
  desktopRuntime.lastBackendFailureDetail = null;
  desktopRuntime.restartTimer = null;
  desktopRuntime.isQuitting = false;
  desktopRuntime.isUpdaterInstallPreparing = false;
  desktopRuntime.isUpdaterQuitAndInstallInFlight = false;
  desktopRuntime.updateInstallPreparation = makeUpdateInstallPreparationCoordinator();
  desktopRuntime.deferredDesktopQuitIntent = makeDeferredDesktopQuitIntentCoordinator();
  desktopRuntime.runningChatsQuitGuard = makeRunningChatsQuitGuard();
  desktopRuntime.desktopShutdownPromise = null;
  desktopRuntime.desktopStartupBlockedForDatabaseRestore = false;
  desktopRuntime.migrationConsentHandoff = new MigrationConsentHandoff();
  desktopRuntime.desktopShutdownComplete = false;
  desktopRuntime.desktopProtocolRegistered = false;
  desktopRuntime.aboutCommitHashCache = undefined;
  desktopRuntime.appUpdateYmlCache = undefined;
  desktopRuntime.desktopLogSink = null;
  desktopRuntime.backendLogSink = null;
  desktopRuntime.restoreStdIoCapture = null;
  desktopRuntime.unreadBackgroundNotificationCount = 0;
  desktopRuntime.browserPerfInterval = null;
  desktopRuntime.annotationGuestPreload = Path.join(__dirname, "guestPreload.js");
  desktopRuntime.browserOsKeyStore = {
    available: async () => {
      await app.whenReady();
      return (
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text")
      );
    },
    encrypt: (value: string) => safeStorage.encryptString(value),
    decrypt: (value: Buffer) => safeStorage.decryptString(value),
  };
  desktopRuntime.browserVault = new BrowserVault(
    Path.join(desktopRuntime.BASE_DIR, "browser-vault"),
    desktopRuntime.browserOsKeyStore,
  );
  desktopRuntime.browserSessionRestore = undefined;
  desktopRuntime.browserVaultCapture = new BrowserVaultCapture(desktopRuntime.browserVault);
  desktopRuntime.browserManager = new DesktopBrowserManager({
    onRuntimeReady: (runtime) => desktopRuntime.browserVaultCapture.register(runtime),
    onHumanControl: (threadId) => desktopRuntime.browserVaultCapture.noteHumanActivity(threadId),
    annotationPreloadPath: desktopRuntime.annotationGuestPreload,
    beforeInputEvent: (event, input) => {
      if (
        isKeyboardShortcutsHelpChord(
          {
            type: input.type,
            key: input.key,
            code: input.code,
            meta: input.meta,
            ctrl: input.control,
            shift: input.shift,
            alt: input.alt,
            repeat: input.isAutoRepeat,
          },
          {
            isMac: process.platform === "darwin",
            isWindows: process.platform === "win32",
          },
        )
      ) {
        event.preventDefault();
        desktopRuntime.dispatchMenuAction("show-shortcuts");
        return true;
      }

      const target = desktopRuntime.resolveMenuTargetWindow()?.webContents;
      if (!target) return false;
      return (
        desktopRuntime.handleDesktopPhysicalZoomShortcut(event, input, target) ||
        desktopRuntime.handleDesktopZoomShortcut(event, input, target)
      );
    },
  });
  desktopRuntime.browserHostPipeServer = null;
  desktopRuntime.computerManager = null;
  desktopRuntime.configuredUpdaterCacheDirName = null;
  desktopRuntime.browserManager.subscribe((state) => {
    sendBrowserState(desktopRuntime.mainWindow?.webContents, state);
  });
  desktopRuntime.browserManager.subscribeCopyLink((event) => {
    sendBrowserCopyLink(desktopRuntime.mainWindow?.webContents, event);
  });
  desktopRuntime.browserManager.subscribeAnnotationEvents((event) => {
    sendBrowserAnnotationEvent(desktopRuntime.mainWindow?.webContents, event);
  });
  desktopRuntime.destructiveMenuIconCache = undefined;
  desktopRuntime.desktopRuntimeInfo = resolveDesktopRuntimeInfo({
    platform: process.platform,
    processArch: process.arch,
    runningUnderArm64Translation: app.runningUnderARM64Translation === true,
  });
  desktopRuntime.initialUpdateState = (): DesktopUpdateState =>
    createInitialDesktopUpdateState(
      app.getVersion(),
      desktopRuntime.desktopRuntimeInfo,
      desktopRuntime.desktopFlavor === "development" ? "production" : desktopRuntime.desktopFlavor,
    );
  desktopRuntime.initializePackagedLogging();
  desktopRuntime.CONTEXT_MENU_ICON_DATA_URL_PREFIX = "data:image/png;base64,";
  desktopRuntime.CONTEXT_MENU_ICON_MAX_DATA_URL_LENGTH = 64_000;
  desktopRuntime.MAC_CONTEXT_MENU_LABEL_TRAILING_PADDING = "\u2003\u2003";
  desktopRuntime.updatePollTimer = null;
  desktopRuntime.updateStartupTimer = null;
  desktopRuntime.updateCheckInFlight = false;
  desktopRuntime.updateDownloadInFlight = false;
  desktopRuntime.activeUpdateCheck = null;
  desktopRuntime.settleActiveUpdateCheck = null;
  desktopRuntime.activeUpdatePreparation = null;
  desktopRuntime.updaterConfigured = false;
  desktopRuntime.updateState = desktopRuntime.initialUpdateState();
  desktopRuntime.updateBackgroundedAtMs = null;
  desktopRuntime.updateBackgroundBlurTimer = null;
  desktopRuntime.updateCheckTimeoutTimer = null;
  desktopRuntime.updateDownloadStallTimer = null;
  desktopRuntime.updateInstallWatchdogTimer = null;
  desktopRuntime.automaticUpdateActivitySuppressed = false;
  desktopRuntime.updateDownloadCancellationToken = null;
  desktopRuntime.rejectUpdateDownloadStall = null;
  desktopRuntime.lastUpdateDownloadProgressSample = null;
  desktopRuntime.stalledDownloadCancellationSuppressionsRemaining = 0;
  desktopRuntime.stalledDownloadCancellationSuppressionExpiresAtMs = 0;
  desktopRuntime.downloadedUpdateArtifact = null;
  desktopRuntime.downloadedUpdateIdentityTask = null;
  desktopRuntime.activeUpdateInstallHandoff = null;
  desktopRuntime.pendingUpdateCacheClearQueue = new PendingUpdateCacheClearQueue();
  protocol.registerSchemesAsPrivileged([
    {
      scheme: desktopRuntime.DESKTOP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,

        codeCache: true,
      },
    },
    {
      scheme: LOCAL_HTML_PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ]);
  desktopRuntime.servedStaticRootCache = undefined;
  desktopRuntime.windowsTaskbarIcoBytesCache = new Map<string, Buffer>();
  desktopRuntime.windowsShellStampTimer = null;
  desktopRuntime.windowsShellStampResolve = null;
  desktopRuntime.desktopAppIconApplyTail = Promise.resolve();
  desktopRuntime.lastPersistedMacAppIcon = null;
  desktopRuntime.BUNDLE_SWAP_POLL_INTERVAL_MS = 15_000;
  desktopRuntime.bundleSwapPollTimer = null;
  desktopRuntime.bundleSwapPromptOpen = false;
  desktopRuntime.cuaDriverHost = undefined;
  desktopRuntime.disposeComputerDesktopLifecycle = undefined;
  desktopRuntime.cuaHostEndpoint = undefined;
  desktopRuntime.escapeKillSwitchMonitor = undefined;
  desktopRuntime.linuxEscapeKillSwitchMonitor = undefined;
  desktopRuntime.MIN_DESKTOP_WINDOW_WIDTH = 1024;
  desktopRuntime.MIN_DESKTOP_WINDOW_HEIGHT = 700;
  if (desktopRuntime.hasSingleInstanceLock) {
    desktopRuntime.repairBrowserProfileBeforeElectronReady(desktopRuntime.userDataPath);
  }
  desktopRuntime.configureAppIdentity();
  configureElectronNetwork();
  desktopRuntime.browserEngineFeatures = new Set([
    ...app.commandLine.getSwitchValue("enable-features").split(",").filter(Boolean),
    "WebMCPTesting",
    "DevToolsWebMCPSupport",
  ]);
  app.commandLine.appendSwitch(
    "enable-features",
    [...desktopRuntime.browserEngineFeatures].join(","),
  );
  if (!desktopRuntime.hasSingleInstanceLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      desktopRuntime.focusMainWindow();
    });
  }
}
