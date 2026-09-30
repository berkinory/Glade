import type { DesktopAppIcon, DesktopTheme, DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import {
  gladeDesktopIdentity,
  resolveGladeDesktopRuntimeFlavor,
} from "@glade/shared/platform/desktopIdentity";
import { RotatingFileSink } from "@glade/shared/platform/logging";
import { type MigrationSchemaTooNewStartupBlock } from "@glade/shared/platform/migrationRecovery";
import type { FileFilter } from "electron";
import { BrowserWindow } from "electron";
import { type UpdateDownloadedEvent } from "electron-updater";
import * as ChildProcess from "node:child_process";
import { BackendSupervisionPolicy } from "../backend/backendSupervisionPolicy";
import { ServerListeningDetector } from "../backend/serverListeningDetector";
import { BrowserSessionRestore } from "../browser/automation/browserSessionRestore";
import { BrowserVault } from "../browser/automation/browserVault";
import { BrowserVaultCapture } from "../browser/automation/browserVaultCapture";
import { DesktopBrowserManager } from "../browser/browserManager";
import { BrowserHostPipeServer } from "../browser/browserUsePipeServer";
import { DesktopComputerManager } from "../computer/computerPermissions";
import { CuaDriverHost } from "../computer/cua/cuaDriverHost";
import { EscapeKillSwitchMonitor } from "../computer/cua/escapeKillSwitchMonitor";
import { LinuxEscapeKillSwitchMonitor } from "../computer/cua/linuxEscapeKillSwitchMonitor";
import {
  type DesktopMigrationRecoveryOutcome,
  type DesktopMigrationRecoveryPaths,
} from "../storage/desktopMigrationRecovery";
import { MigrationConsentHandoff } from "../storage/migrationConsentHandoff";
import { makeDeferredDesktopQuitIntentCoordinator } from "./lifecycle/desktopQuitIntent";
import { RendererCrashPolicy } from "./lifecycle/rendererCrashRecovery";
import { makeRunningChatsQuitGuard } from "./lifecycle/runningChatsQuitGuard";
import { resolveDesktopRuntimeInfo } from "./lifecycle/runtimeArch";
import { syncShellEnvironment } from "./lifecycle/syncShellEnvironment";
import { type BundleSignature } from "./protocol/bundleSwapDetection";
import { type UpdateArtifactIdentity } from "./updates/updateArtifactIdentity";
import { type UpdateInstallHandoffExpectation } from "./updates/updateInstallMarker";
import { type UpdateInstallPreparationAttempt } from "./updates/updateInstallPreparation";
import { PendingUpdateCacheClearQueue } from "./updates/updatePendingCache";
import { type DownloadProgressSample } from "./updates/updateState";
export type DesktopUpdateErrorContext = DesktopUpdateState["errorContext"];
export interface ServedStaticRoot {
  readonly dir: string;

  readonly snapshotted: boolean;
}
export interface BundleIdentity {
  readonly path: string;
  readonly signature: BundleSignature | null;
}
export class BundleChangedDuringStartupError extends Error {
  readonly bundlePath: string;
  readonly baseline: BundleSignature | null;
  readonly current: BundleSignature | null;

  constructor(input: {
    bundlePath: string;
    baseline: BundleSignature | null;
    current: BundleSignature | null;
  }) {
    super("The packaged application changed while its static assets were being prepared.");
    this.name = "BundleChangedDuringStartupError";
    this.bundlePath = input.bundlePath;
    this.baseline = input.baseline;
    this.current = input.current;
  }
}
export type BackendStartTrigger = "lifecycle" | "crash-restart";
export interface DesktopRuntime {
  readonly requestedSourceBuildMarker: string | undefined;
  readonly startupBundleIdentity: BundleIdentity | null;
  readonly shellEnvironmentSync: ReturnType<typeof syncShellEnvironment>;
  readonly IPC: {
    readonly pickFolder: "desktop:pick-folder";
    readonly saveFile: "desktop:save-file";
    readonly confirm: "desktop:confirm";
    readonly setTheme: "desktop:set-theme";
    readonly getAppIcon: "desktop:get-app-icon";
    readonly setAppIcon: "desktop:set-app-icon";
    readonly contextMenu: "desktop:context-menu";
    readonly openExternal: "desktop:open-external";
    readonly showInFolder: "desktop:show-in-folder";
    readonly clipboardWriteImage: "desktop:clipboard-write-image";
    readonly windowMinimize: "desktop:window-minimize";
    readonly windowToggleMaximize: "desktop:window-toggle-maximize";
    readonly windowClose: "desktop:window-close";
    readonly windowGetState: "desktop:window-get-state";
    readonly windowState: "desktop:window-state";
    readonly customTitleBarGetState: "desktop:custom-title-bar-get-state";
    readonly customTitleBarSetPreference: "desktop:custom-title-bar-set-preference";
    readonly customTitleBarRelaunch: "desktop:custom-title-bar-relaunch";
    readonly menuAction: "desktop:menu-action";
    readonly quitConfirmationRequest: "desktop:quit-confirmation-request";
    readonly quitConfirmationResponse: "desktop:quit-confirmation-response";
    readonly updateState: "desktop:update-state";
    readonly updateGetState: "desktop:update-get-state";
    readonly updateCheck: "desktop:update-check";
    readonly updateDownload: "desktop:update-download";
    readonly updateInstall: "desktop:update-install";
    readonly notificationsIsSupported: "desktop:notifications-is-supported";
    readonly notificationsShow: "desktop:notifications-show";
    readonly zoomFactor: "desktop:zoom-factor";
    readonly zoomFactorChanged: "desktop:zoom-factor-changed";
    readonly wsUrl: "desktop:get-ws-url";
    readonly transcribeVoice: "desktop:server-transcribe-voice";
    readonly computerPreviewFrame: "computerPreview.frame";
    readonly computerSetCursorStyle: "desktop:computer-set-cursor-style";
    readonly storageMigration: {
      readonly read: "desktop:storage-migration-read";
      readonly acknowledge: "desktop:storage-migration-acknowledge";
    };
    readonly computerPermissions: {
      readonly getState: "desktop:computer-permissions-get-state";
      readonly requestPermissions: "desktop:computer-permissions-request-permissions";
      readonly startPermissionSetup: "desktop:computer-permissions-start-permission-setup";
      readonly openPermissionSettings: "desktop:computer-permissions-open-permission-settings";
      readonly restartApp: "desktop:computer-permissions-restart-app";
      readonly showPermissionGuide: "desktop:computer-permissions-show-permission-guide";
      readonly hidePermissionGuide: "desktop:computer-permissions-hide-permission-guide";
      readonly permissionGuideState: "desktop:computer-permissions-permission-guide-state";
      readonly state: "desktop:computer-permissions-state";
    };
    readonly browser: {
      readonly vault: {
        readonly snapshot: "desktop:browser-vault-snapshot";
        readonly configure: "desktop:browser-vault-configure";
        readonly remove: "desktop:browser-vault-remove";
        readonly respond: "desktop:browser-vault-respond";
        readonly setupMaster: "desktop:browser-vault-setup-master";
        readonly unlock: "desktop:browser-vault-unlock";
        readonly lock: "desktop:browser-vault-lock";
        readonly reveal: "desktop:browser-vault-reveal";
        readonly changed: "desktop:browser-vault-changed";
      };
      readonly webMcpCompatibilityPolicy: "desktop:browser-webmcp-compatibility-policy";
      readonly state: "desktop:browser-state";
      readonly open: "desktop:browser-open";
      readonly close: "desktop:browser-close";
      readonly hide: "desktop:browser-hide";
      readonly getState: "desktop:browser-get-state";
      readonly setBounds: "desktop:browser-set-bounds";
      readonly attachWebview: "desktop:browser-attach-webview";
      readonly detachWebview: "desktop:browser-detach-webview";
      readonly requestOpenPanel: "desktop:browser-use-request-open-panel";
      readonly copyLink: "desktop:browser-copy-link";
      readonly requestCopyLink: "desktop:browser-request-copy-link";
      readonly copyScreenshotToClipboard: "desktop:browser-copy-screenshot-to-clipboard";
      readonly captureScreenshot: "desktop:browser-capture-screenshot";
      readonly capturePreview: "desktop:browser-capture-preview";
      readonly navigate: "desktop:browser-navigate";
      readonly reload: "desktop:browser-reload";
      readonly goBack: "desktop:browser-go-back";
      readonly goForward: "desktop:browser-go-forward";
      readonly newTab: "desktop:browser-new-tab";
      readonly closeTab: "desktop:browser-close-tab";
      readonly selectTab: "desktop:browser-select-tab";
      readonly openDevTools: "desktop:browser-open-devtools";
      readonly annotations: {
        readonly start: "desktop:browser-annotations-start";
        readonly cancel: "desktop:browser-annotations-cancel";
        readonly syncMarkers: "desktop:browser-annotations-sync-markers";
        readonly event: "desktop:browser-annotations-event";
        readonly guestMessage: "desktop:browser-annotations-guest-message";
      };
    };
  };
  readonly MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH: number;
  readonly packagedDesktopFlavor: unknown;
  readonly isSourceDesktopBuild: boolean;
  readonly isDevelopment: boolean;
  readonly desktopFlavor: ReturnType<typeof resolveGladeDesktopRuntimeFlavor>;
  readonly desktopIdentity: ReturnType<typeof gladeDesktopIdentity>;
  readonly BASE_DIR: string;
  readonly STATE_DIR: string;
  readonly DESKTOP_WINDOW_STATE_PATH: string;
  readonly DESKTOP_APP_ICON_PATH: string;
  readonly DESKTOP_CUSTOM_TITLE_BAR_PATH: string;
  readonly AGENT_CURSOR_PREFERENCE_PATH: string;
  readonly DESKTOP_SCHEME: string;
  readonly ROOT_DIR: string;
  readonly APP_DISPLAY_NAME: string;
  readonly APP_USER_MODEL_ID: string;
  readonly COMMIT_HASH_PATTERN: RegExp;
  readonly COMMIT_HASH_DISPLAY_LENGTH: 12;
  readonly LOG_DIR: string;
  readonly DESKTOP_LOG_FILE_NAME: "desktop-main.log";
  readonly BACKEND_LOG_FILE_NAME: "server-child.log";
  readonly LOG_FILE_MAX_BYTES: number;
  readonly LOG_FILE_MAX_FILES: 10;
  readonly APP_RUN_ID: string;
  readonly DESKTOP_BACKEND_SHUTDOWN_TOKEN: string;
  readonly DESKTOP_BROWSER_HOST_CAPABILITY: string;
  readonly DESKTOP_BROWSER_HOST_CAPABILITY_FD: 3;
  readonly userDataPath: string;
  readonly hasSingleInstanceLock: boolean;
  readonly AUTO_UPDATE_STARTUP_DELAY_MS: 15000;
  readonly AUTO_UPDATE_POLL_INTERVAL_MS: number;
  readonly AUTO_UPDATE_FOREGROUND_RECHECK_MIN_INTERVAL_MS: number;
  readonly AUTO_UPDATE_FOREGROUND_RECHECK_MIN_BACKGROUND_MS: number;
  readonly AUTO_UPDATE_CHECK_TIMEOUT_MS: number;
  readonly AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS: number;
  readonly AUTO_UPDATE_DOWNLOAD_SETTLE_TIMEOUT_MS: number;
  readonly AUTO_UPDATE_STALLED_DOWNLOAD_CANCELLATION_SUPPRESSION_MS: number;
  readonly AUTO_UPDATE_INSTALL_WATCHDOG_MS: number;
  readonly AUTO_UPDATE_DIAGNOSTICS_TIMEOUT_MS: 2800;
  readonly BROWSER_SESSION_RESTORE_TIMEOUT_MS: 5000;
  readonly UPDATE_CHECK_REASON_MIGRATION_RECOVERY: "migration recovery";
  readonly UPDATE_INSTALL_MARKER_FILE_NAME: "pending-update-install.json";
  readonly BACKEND_FORCE_KILL_DELAY_MS: 8000;
  readonly BACKEND_SHUTDOWN_TIMEOUT_MS: 10000;
  readonly POSIX_BACKEND_TERMINATE_DELAY_MS: 15000;
  readonly POSIX_BACKEND_FORCE_KILL_DELAY_MS: 18000;
  readonly POSIX_BACKEND_SHUTDOWN_TIMEOUT_MS: 20000;
  readonly BACKEND_MAX_OLD_SPACE_ENV_KEYS: readonly ["GLADE_BACKEND_MAX_OLD_SPACE_MB"];
  readonly DESKTOP_UPDATE_ALLOW_PRERELEASE: false;
  readonly BROWSER_PERF_SAMPLE_INTERVAL_MS: 5000;
  readonly DESKTOP_MENU_ZOOM_FACTOR_STEP: 1.1;
  readonly DESKTOP_MENU_MIN_ZOOM_FACTOR: 0.25;
  readonly DESKTOP_MENU_MAX_ZOOM_FACTOR: 5;
  readonly GLADE_BROWSER_LABEL: "Glade browser";
  readonly browserPerfLoggingEnabled: boolean;
  mainWindow: BrowserWindow | null;
  customTitleBarActive: boolean;
  backendProcess: ChildProcess.ChildProcess | null;
  backendPort: number;
  backendAuthToken: string;
  backendHttpUrl: string;
  backendWsUrl: string;
  backendReadinessAbortController: AbortController | null;
  backendInitialWindowOpenInFlight: Promise<void> | null;
  backendLifecycleDialogInFlight: Promise<void> | null;
  backendListeningDetector: ServerListeningDetector | null;
  readonly backendSupervision: BackendSupervisionPolicy;
  readonly rendererCrashPolicy: RendererCrashPolicy;
  rendererCrashDialogInFlight: Promise<void> | null;
  lastBackendFailureDetail: string | null;
  restartTimer: NodeJS.Timeout | null;
  isQuitting: boolean;
  isUpdaterInstallPreparing: boolean;
  isUpdaterQuitAndInstallInFlight: boolean;
  readonly updateInstallPreparation: {
    begin(): UpdateInstallPreparationAttempt | null;
    cancel(): boolean;
    requireActive(attempt: UpdateInstallPreparationAttempt): void;
    release(attempt: UpdateInstallPreparationAttempt): void;
  };
  readonly deferredDesktopQuitIntent: ReturnType<typeof makeDeferredDesktopQuitIntentCoordinator>;
  readonly runningChatsQuitGuard: ReturnType<typeof makeRunningChatsQuitGuard>;
  desktopShutdownPromise: Promise<void> | null;
  desktopStartupBlockedForDatabaseRestore: boolean;
  readonly migrationConsentHandoff: MigrationConsentHandoff;
  desktopShutdownComplete: boolean;
  desktopProtocolRegistered: boolean;
  aboutCommitHashCache: string | null | undefined;
  appUpdateYmlCache: Record<string, string> | null | undefined;
  desktopLogSink: RotatingFileSink | null;
  backendLogSink: RotatingFileSink | null;
  restoreStdIoCapture: (() => void) | null;
  unreadBackgroundNotificationCount: number;
  browserPerfInterval: NodeJS.Timeout | null;
  readonly annotationGuestPreload: string;
  readonly browserOsKeyStore: {
    available: () => Promise<boolean>;
    encrypt: (value: string) => Buffer<ArrayBufferLike>;
    decrypt: (value: Buffer) => string;
  };
  readonly browserVault: BrowserVault;
  browserSessionRestore: BrowserSessionRestore | undefined;
  readonly browserVaultCapture: BrowserVaultCapture;
  readonly browserManager: DesktopBrowserManager;
  browserHostPipeServer: BrowserHostPipeServer | null;
  computerManager: DesktopComputerManager | null;
  configuredUpdaterCacheDirName: string | null;
  startBrowserPerformanceLogging: () => void;
  ensureBrowserHostPipeServer: () => Promise<void>;
  destructiveMenuIconCache: Electron.NativeImage | null | undefined;
  readonly desktopRuntimeInfo: ReturnType<typeof resolveDesktopRuntimeInfo>;
  readonly initialUpdateState: () => DesktopUpdateState;
  sanitizeLogValue: (value: string) => string;
  writeDesktopLogHeader: (message: string) => void;
  writeBackendSessionBoundary: (phase: "START" | "END", details: string) => void;
  safeConsoleError: (message?: any, ...optionalParams: any[]) => void;
  formatErrorMessage: (error: unknown) => string;
  getSafeExternalUrl: (rawUrl: unknown) => string | null;
  getSafeTheme: (rawTheme: unknown) => DesktopTheme | null;
  getDesktopWindowState: (window: BrowserWindow) => { isMaximized: boolean; isFullscreen: boolean };
  isSaveFileInput: (
    input: unknown,
  ) => input is { defaultFilename: string; contents: string; filters?: FileFilter[] };
  cancelBackendReadinessWait: () => void;
  reserveBackendEndpoint: (reason: string) => Promise<void>;
  waitForBackendWindowReady: (baseUrl: string) => Promise<"listening" | "http">;
  ensureInitialBackendWindowOpen: (baseUrl: string) => void;
  initializePackagedLogging: () => void;
  getDestructiveMenuIcon: () => Electron.NativeImage | undefined;
  readonly CONTEXT_MENU_ICON_DATA_URL_PREFIX: "data:image/png;base64,";
  readonly CONTEXT_MENU_ICON_MAX_DATA_URL_LENGTH: 64000;
  readonly MAC_CONTEXT_MENU_LABEL_TRAILING_PADDING: "  ";
  createContextMenuIcon: (dataUrl: unknown, template?: boolean) => Electron.NativeImage | undefined;
  updatePollTimer: NodeJS.Timeout | null;
  updateStartupTimer: NodeJS.Timeout | null;
  updateCheckInFlight: boolean;
  updateDownloadInFlight: boolean;
  activeUpdateCheck: Promise<void> | null;
  settleActiveUpdateCheck: (() => void) | null;
  activeUpdatePreparation: Promise<void> | null;
  updaterConfigured: boolean;
  updateState: DesktopUpdateState;
  updateBackgroundedAtMs: number | null;
  updateBackgroundBlurTimer: NodeJS.Timeout | null;
  updateCheckTimeoutTimer: NodeJS.Timeout | null;
  updateDownloadStallTimer: NodeJS.Timeout | null;
  updateInstallWatchdogTimer: NodeJS.Timeout | null;
  automaticUpdateActivitySuppressed: boolean;
  updateDownloadCancellationToken: any;
  rejectUpdateDownloadStall: ((error: Error) => void) | null;
  lastUpdateDownloadProgressSample: DownloadProgressSample | null;
  stalledDownloadCancellationSuppressionsRemaining: number;
  stalledDownloadCancellationSuppressionExpiresAtMs: number;
  downloadedUpdateArtifact: {
    readonly version: string;
    readonly identity: UpdateArtifactIdentity;
  } | null;
  downloadedUpdateIdentityTask: Promise<void> | null;
  pendingDownloadedUpdateIdentity: () => Promise<void> | null;
  activeUpdateInstallHandoff: UpdateInstallHandoffExpectation | null;
  readonly pendingUpdateCacheClearQueue: PendingUpdateCacheClearQueue;
  resolveUpdaterErrorContext: () => DesktopUpdateErrorContext;
  clearUpdaterInstallInFlightAfterError: (input?: {
    readonly preservePendingPreparation?: boolean;
  }) => boolean;
  deferDesktopQuitUntilUpdaterSettles: (reason: string) => void;
  replayDeferredDesktopQuitAfterUpdaterSettles: () => boolean;
  recoverDesktopAfterUpdaterInstallFailure: () => void;
  getUpdateInstallMarkerPath: () => string;
  recordInstallMarkerFailure: (
    nowIso: string,
    expected: UpdateInstallHandoffExpectation | null,
  ) => number;
  logMacUpdateDiagnostics: (context: string) => Promise<void>;
  armInstallWatchdog: () => void;
  resolveAppRoot: () => string;
  readAppUpdateYml: () => Record<string, string> | null;
  resolveEmbeddedWindowsPublisherSubjects: () => string[];
  resolveAboutCommitHash: () => string | null;
  resolveBackendEntry: () => string;
  resolveBackendCwd: () => string;
  requireCurrentDesktopMigrationBundle: () => Promise<boolean>;
  desktopMigrationRecoveryPaths: () => DesktopMigrationRecoveryPaths;
  isDesktopMigrationRecoveryPending: () => boolean;
  handleDesktopMigrationRecovery: () => Promise<DesktopMigrationRecoveryOutcome>;
  servedStaticRootCache: ServedStaticRoot | null | undefined;
  resolveServedStaticRoot: () => ServedStaticRoot | null;
  handleFatalStartupError: (stage: string, error: unknown) => void;
  registerDesktopProtocol: () => void;
  dispatchMenuAction: (action: string) => void;
  resolveMenuTargetWindow: () => BrowserWindow | null;
  attachDesktopZoomFactorSync: (window: BrowserWindow) => void;
  handleDesktopPhysicalZoomShortcut: (
    event: Electron.Event,
    input: Electron.Input,
    target: Electron.WebContents,
  ) => boolean;
  attachDesktopPhysicalZoomShortcuts: (window: BrowserWindow) => void;
  handleDesktopZoomShortcut: (
    event: Electron.Event,
    input: Electron.Input,
    target: Electron.WebContents,
  ) => boolean;
  resolveAutoUpdateDisabledReason: () => string | null;
  configureApplicationMenu: () => void;
  resolveResourcePath: (fileName: string) => string | null;
  resolveNotificationIconPath: () => string | null;
  resolveComputerHelperPath: () => string;
  resolveComputerAppBundlePath: () => string;
  initializeDesktopComputer: () => void;
  clearUnreadNotificationBadge: () => void;
  focusMainWindow: (options?: { stealAppFocus?: boolean }) => void;
  showDesktopNotification: (input: {
    title: string;
    body?: string;
    silent?: boolean;
    suppressWhenForeground?: boolean;
    threadId?: string;
  }) => boolean;
  resolveUserDataPath: () => string;
  repairBrowserProfileBeforeElectronReady: (userDataPath: string) => void;
  configureAppIdentity: () => void;
  readDesktopAppIcon: () => DesktopAppIcon;
  persistDesktopAppIcon: (icon: DesktopAppIcon) => void;
  materializeWindowsShellIcon: (icon: DesktopAppIcon, sourcePath: string) => string;
  readonly windowsTaskbarIcoBytesCache: Map<string, Buffer<ArrayBufferLike>>;
  windowsShellStampTimer: NodeJS.Immediate | null;
  windowsShellStampResolve: (() => void) | null;
  desktopAppIconApplyTail: Promise<void>;
  lastPersistedMacAppIcon: "dark" | "default" | "icon" | null;
  applyDesktopAppIcon: (
    icon: DesktopAppIcon,
    window?: BrowserWindow | null,
    options?: { reregisterTaskbarButton?: boolean; flushShellIconCache?: boolean },
  ) => Promise<void>;
  applyPersistedDesktopAppIcon: (
    window?: BrowserWindow | null,
    options?: { reregisterTaskbarButton?: boolean; flushShellIconCache?: boolean },
  ) => Promise<void>;
  applyInitialMacDockIcon: () => void;
  registerMacAppearanceIconSync: () => void;
  refreshMacIconCacheOnVersionChange: () => void;
  readonly BUNDLE_SWAP_POLL_INTERVAL_MS: 15000;
  bundleSwapPollTimer: NodeJS.Timeout | null;
  bundleSwapPromptOpen: boolean;
  readBundleSignature: (bundlePath: string) => BundleSignature | null;
  captureStartupBundleIdentity: () => BundleIdentity | null;
  restartAfterStartupBundleSwap: (error: BundleChangedDuringStartupError) => void;
  startBundleSwapWatcher: () => void;
  clearUpdatePollTimer: () => void;
  scheduleUpdatePoll: () => void;
  isExplicitUpdateCheckReason: (reason: string) => boolean;
  emitUpdateState: () => void;
  setUpdateState: (patch: Partial<DesktopUpdateState>) => void;
  shouldEnableAutoUpdates: () => boolean;
  isAcceptableUpdateVersion: (version: string | null | undefined) => boolean;
  describeRejectedUpdateVersion: (version: string) => string;
  processInstallMarkerOnStartup: () => void;
  clearPendingUpdateCache: (reason: string) => Promise<void>;
  clearPendingUpdateCacheWhenSafe: (reason: string) => void;
  clearUpdateBackgroundBlurTimer: () => void;
  clearUpdateCheckTimeoutTimer: () => void;
  armUpdateCheckTimeout: (reason: string) => void;
  clearUpdateDownloadStallTimer: () => void;
  isStalledDownloadCancellationSuppressionArmed: () => boolean;
  consumeStalledDownloadCancellationSuppression: () => void;
  armUpdateDownloadStallTimer: (reason: string) => void;
  updateDownloadStallTimerOnProgress: (progress: DownloadProgressSample) => void;
  markDesktopAppBackgrounded: () => void;
  handleDesktopAppForegrounded: () => void;
  beginActiveUpdateCheck: () => () => void;
  checkForUpdates: (reason: string) => Promise<void>;
  downloadAvailableUpdate: () => Promise<{ accepted: boolean; completed: boolean }>;
  prepareAvailableUpdateInBackground: (reason: string) => void;
  canInstallUpdateFromRecovery: () => boolean;
  installLatestUpdateForMigrationRecovery: () => Promise<string | null>;
  installDownloadedUpdate: () => Promise<{ accepted: boolean; completed: boolean }>;
  recordDownloadedUpdateIdentity: (info: UpdateDownloadedEvent) => Promise<void>;
  configureAutoUpdater: () => void;
  backendNodeArgs: () => string[];
  cuaDriverHost: CuaDriverHost | undefined;
  disposeComputerDesktopLifecycle: (() => void) | undefined;
  cuaHostEndpoint: string | undefined;
  escapeKillSwitchMonitor: EscapeKillSwitchMonitor | undefined;
  linuxEscapeKillSwitchMonitor: LinuxEscapeKillSwitchMonitor | undefined;
  startCuaHost: () => Promise<void>;
  openDesktopLogDirectory: () => Promise<void>;
  handleDesktopSchemaTooNewRecovery: (block: MigrationSchemaTooNewStartupBlock) => Promise<void>;
  startBackend: (trigger?: BackendStartTrigger) => void;
  stopBackendAndWaitForExit: () => Promise<void>;
  confirmRunningChatsThenQuit: (reason: string) => Promise<void>;
  requestGracefulAppQuit: (reason: string) => void;
  registerIpcHandlers: () => void;
  getDesktopCustomTitleBarState: () => {
    readonly supported: boolean;
    readonly preference: boolean;
    readonly active: boolean;
    readonly restartRequired: boolean;
  };
  readonly MIN_DESKTOP_WINDOW_WIDTH: 1024;
  readonly MIN_DESKTOP_WINDOW_HEIGHT: 700;
  createWindow: () => BrowserWindow;
  attachRendererCrashRecovery: (window: BrowserWindow) => void;
  configureMediaPermissions: () => void;
  readonly browserEngineFeatures: Set<string>;
  bootstrap: () => Promise<void>;
}
