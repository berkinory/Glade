import type {
  PreviewWorkspaceRestoreInput,
  WorkspaceRestorePreview,
} from "../orchestration/workspaceRestore";
import {
  ProviderManagementContext,
  ProviderListMcpServersResult,
  ProviderManageMcpServerInput,
  ProviderManagementResult,
  ProviderPluginInventoryResult,
  ProviderManagePluginInput,
} from "../provider/providerManagement";
import { Schema } from "effect";
import type {
  ImportProjectInput,
  ImportProjectResult,
  ListProjectImportsInput,
  ReadImportedHistoryInput,
  ReadImportedHistoryResult,
  ListProjectImportsResult,
} from "../workspace/projectImport";

import type {
  AuthBearerBootstrapResult,
  AuthBootstrapInput,
  AuthBootstrapResult,
  AuthClientSession,
  AuthCreatePairingCredentialInput,
  AuthLogoutResult,
  AuthPairingCredentialResult,
  AuthPairingLink,
  AuthRevokeClientSessionInput,
  AuthRevokePairingLinkInput,
  AuthSessionState,
  AuthWebSocketTokenResult,
} from "../transport/auth/auth";
import type {
  GitCheckoutInput,
  GitActionProgressEvent,
  GitWorktreeSetupProgressEvent,
  GitCreateBranchInput,
  GitCreateDetachedWorktreeInput,
  GitCreateDetachedWorktreeResult,
  GitHubRepositoryInput,
  GitHubRepositoryResult,
  GitHandoffThreadInput,
  GitHandoffThreadResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitListRecentCommitsInput,
  GitListRecentCommitsResult,
  GitReadCommitInput,
  GitReadCommitResult,
  GitPullInput,
  GitPullResult,
  GitBlameLineInput,
  GitBlameLineResult,
  GitReadFileAtRevInput,
  GitReadSourceControlFilesInput,
  GitReadRequestOptions,
  GitReadFileAtRevResult,
  GitReadWorkingTreeDiffInput,
  GitReadWorkingTreeDiffResult,
  GitSourceControlFilesResult,
  GitWorkingTreeDiffStatsResult,
  GitRemoveIndexLockInput,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitStageFilesInput,
  GitStageFilesResult,
  GitRevertUnstagedFileInput,
  GitCommitStagedInput,
  GitFetchInput,
  GitIgnorePathsInput,
  GitRebaseInput,
  GitUndoCommitInput,
  GitUndoCommitResult,
  GitRebaseStateInput,
  GitRebaseStateResult,
  GitRevertUnstagedFileResult,
  GitStashAndCheckoutInput,
  GitStashDropInput,
  GitStashInfoInput,
  GitStashInfoResult,
  GitStatusInput,
  GitStatusWatchInput,
  GitStatusStreamEvent,
  GitSidebarSummaryInput,
  GitSidebarSummaryResult,
  GitStatusResult,
  GitSummarizeDiffInput,
  GitGenerateCommitMessageInput,
  GitGenerateCommitMessageResult,
  GitSummarizeDiffResult,
  GitUnstageFilesInput,
  GitUnstageFilesResult,
} from "../git/git";
import type {
  GitHubProjectProvisionInput,
  GitHubProjectProvisionProgressEvent,
  GitHubProjectProvisionResult,
} from "../git/githubProjectProvisioning";
import type {
  ProjectCreateLocalFilePreviewGrantInput,
  ProjectCreateLocalFilePreviewGrantResult,
  ProjectListDirectoriesInput,
  ProjectListDirectoriesResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectFileChangeEvent,
  ProjectWatchFileInput,
  ProjectPrewarmSearchIndexInput,
  ProjectPrewarmSearchIndexResult,
  ProjectResolveWorkspaceFileReferencesInput,
  ProjectResolveWorkspaceFileReferencesResult,
  ProjectResolveOutOfRootFileReferenceInput,
  ProjectResolveOutOfRootFileReferenceResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectSearchContentInput,
  ProjectSearchContentResult,
  ProjectSearchLocalEntriesInput,
  ProjectSearchLocalEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
  ProjectManageEntryInput,
  ProjectManageEntryResult,
} from "../workspace/project";
import type { FilesystemBrowseInput, FilesystemBrowseResult } from "../workspace/filesystem";
import type {
  ComputerActionResult,
  ComputerControlEnabledResult,
  ComputerEvent,
  ComputerGetStateInput,
  ComputerGetStatusInput,
  ComputerInputClickInput,
  ComputerInputKeyInput,
  ComputerInputScrollInput,
  ComputerProvisionInput,
  ComputerProvisionResult,
  ComputerSetControlEnabledInput,
  ComputerState,
  ComputerStatusResult,
  ComputerThreadInput,
  ThreadComputerState,
} from "../computer/computer";
import type {
  ComputerGetAuditHistoryInput,
  ComputerGetAuditHistoryResult,
} from "../computer/computerAudit";
import type {
  ServerConfig,
  ServerDiagnosticsResult,
  ServerReadThreadDiagnosticsInput,
  ServerReadThreadDiagnosticsResult,
  ServerGetEnvironmentResult,
  ServerConsumeCodexResetCreditInput,
  ServerConsumeCodexResetCreditResult,
  ServerGetProviderUsageSnapshotInput,
  ServerGetProviderUsageSnapshotResult,
  ServerListProviderUsageInput,
  ServerListProviderUsageResult,
  ServerGetSettingsResult,
  ServerListLocalServersResult,
  ServerListWorktreesResult,
  ServerProviderUpdateInput,
  ServerProviderUpdateResult,
  ServerRefreshProvidersResult,
  ServerStopLocalServerInput,
  ServerStopLocalServerResult,
  ServerUpdateSettingsInput,
  ServerUpdateSettingsResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
  ServerVoicePrewarmInput,
  ServerVoicePrewarmResult,
  ServerVoiceTranscriptionInput,
  ServerVoiceTranscriptionResult,
} from "../server/server";
import type {
  TerminalAckOutputInput,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "../terminal/terminal";
import type { ClientOrchestrationCommand } from "../orchestration/commands";
import type {
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetThreadDetailSnapshotInput,
  OrchestrationGetThreadDetailSnapshotResult,
  OrchestrationImportThreadInput,
  OrchestrationImportThreadResult,
  OrchestrationListProviderDeliveryBlockersInput,
  OrchestrationListProviderDeliveryBlockersResult,
  OrchestrationReconcileProviderDeliveryInput,
  OrchestrationReconcileProviderDeliveryResult,
  OrchestrationPrepareQuitResumeInput,
  OrchestrationPrepareQuitResumeResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationSubscribeThreadInput,
  OrchestrationUnsubscribeThreadInput,
} from "../orchestration/rpc";
import type { OrchestrationEvent } from "../orchestration/events";
import type {
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
} from "../orchestration/snapshots";
import type { EditorId } from "../settings/editor";
import type { ThreadId } from "../core/baseSchemas";
import type {
  ProviderComposerCapabilities,
  ProviderGetComposerCapabilitiesInput,
  ProviderListAgentsInput,
  ProviderListAgentsResult,
  ProviderListCommandsInput,
  ProviderListCommandsResult,
  ProviderListModelsInput,
  ProviderListModelsResult,
  ProviderListPluginsInput,
  ProviderListPluginsResult,
  ProviderListSkillsInput,
  ProviderListSkillsResult,
  ProviderSkillsCatalogInput,
  ProviderSkillsCatalogResult,
  ProviderReadPluginInput,
  ProviderReadPluginResult,
} from "../provider/providerDiscovery";
import type {
  StatsGetProfileStatsInput,
  StatsGetProfileStatsResult,
  StatsGetProfileTokenStatsInput,
  StatsGetProfileTokenStatsResult,
} from "../server/stats";
import type { BrowserAnnotationMethods } from "../browser/browserAnnotations";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;

  separatorBefore?: boolean;
  destructive?: boolean;

  icon?: string;
}

export interface DesktopContextMenuItem<T extends string = string> extends ContextMenuItem<T> {
  iconDataUrl?: string;
  iconTemplate?: boolean;
}

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
  installFailureCount: number;

  flavor: "production" | "development";

  releaseUrl: string | null;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export interface BrowserTabState {
  openerTabId?: string;
  id: string;
  url: string;
  title: string;

  runtimeSurface?: "native" | "renderer";
  status: "live" | "suspended";
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  faviconUrl: string | null;
  lastCommittedUrl: string | null;
  lastError: string | null;
}

export interface ThreadBrowserState {
  threadId: ThreadId;
  version: number;
  open: boolean;
  activeTabId: string | null;
  tabs: BrowserTabState[];
  lastError: string | null;
}

export interface BrowserOpenInput {
  threadId: ThreadId;
  initialUrl?: string;
}

export interface BrowserThreadInput {
  threadId: ThreadId;
}

export interface BrowserTabInput {
  threadId: ThreadId;
  tabId: string;
}

export interface BrowserNavigateInput {
  threadId: ThreadId;
  tabId?: string;
  url: string;
}

export interface BrowserNewTabInput {
  threadId: ThreadId;
  url?: string;
  activate?: boolean;
}

export interface BrowserPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserSetPanelBoundsInput {
  threadId: ThreadId;
  bounds: BrowserPanelBounds | null;
  surface?: "native" | "renderer";

  occluded?: boolean;

  preview?: boolean;

  pageZoomFactor?: number;
}

export interface BrowserAttachWebviewInput extends BrowserTabInput {
  webContentsId: number;
}

export interface BrowserDetachWebviewInput extends BrowserTabInput {
  webContentsId: number;
}

export interface BrowserCaptureScreenshotResult {
  name: string;
  mimeType: "image/png";
  sizeBytes: number;
  bytes: Uint8Array;
}

export type DesktopComputerPlatform = "macos" | "windows" | "linux" | "other";
export type DesktopComputerPermission =
  | "granted"
  | "denied"
  | "not-determined"
  | "restricted"
  | "unknown";
export type DesktopComputerStatus =
  | "unsupported"
  | "disabled"
  | "permission-required"
  | "starting"
  | "ready"
  | "error";

export type DesktopComputerSettingsPane = "accessibility" | "input-monitoring" | "screen-recording";

export type DesktopComputerPermissionKind = "accessibility" | "inputMonitoring" | "screenRecording";

export type DesktopComputerPermissionGuideState = "closed" | "granted";

export interface DesktopComputerState {
  platform: DesktopComputerPlatform;
  supported: boolean;
  status: DesktopComputerStatus;

  accessibilityPermission?: DesktopComputerPermission;
  inputMonitoringPermission: DesktopComputerPermission;
  screenRecordingPermission: DesktopComputerPermission;
  message: string | null;

  permissionSetupErrorCode?:
    | "permission_setup_bundle_unavailable"
    | "permission_setup_registration_unresolved"
    | "permission_setup_identity_mismatch";

  appDisplayName: string;
}

export interface BrowserCopyLinkEvent {
  threadId: ThreadId;
  url: string;
}

export interface BrowserUseOpenPanelRequest {
  threadId: ThreadId;
}

interface BrowserControlMethods {
  vault?: import("../browser/browserVault").BrowserVaultMethods;
  open: (input: BrowserOpenInput) => Promise<ThreadBrowserState>;
  close: (input: BrowserThreadInput) => Promise<ThreadBrowserState>;
  hide: (input: BrowserThreadInput) => Promise<void>;
  getState: (input: BrowserThreadInput) => Promise<ThreadBrowserState>;
  setPanelBounds: (input: BrowserSetPanelBoundsInput) => Promise<void>;
  attachWebview: (input: BrowserAttachWebviewInput) => Promise<ThreadBrowserState>;
  detachWebview: (input: BrowserDetachWebviewInput) => Promise<void>;
  copyLink: (input: BrowserTabInput) => Promise<void>;
  copyScreenshotToClipboard: (input: BrowserTabInput) => Promise<void>;
  captureScreenshot: (input: BrowserTabInput) => Promise<BrowserCaptureScreenshotResult>;
  capturePreview: (input: BrowserTabInput) => Promise<string | null>;
  navigate: (input: BrowserNavigateInput) => Promise<ThreadBrowserState>;
  reload: (input: BrowserTabInput) => Promise<ThreadBrowserState>;
  goBack: (input: BrowserTabInput) => Promise<ThreadBrowserState>;
  goForward: (input: BrowserTabInput) => Promise<ThreadBrowserState>;
  newTab: (input: BrowserNewTabInput) => Promise<ThreadBrowserState>;
  closeTab: (input: BrowserTabInput) => Promise<ThreadBrowserState>;
  selectTab: (input: BrowserTabInput) => Promise<ThreadBrowserState>;
  openDevTools: (input: BrowserTabInput) => Promise<void>;
  onState: (listener: (state: ThreadBrowserState) => void) => () => void;
}

export interface DesktopNotificationPermission {
  readonly status:
    | "granted"
    | "denied"
    | "not-determined"
    | "provisional"
    | "restricted"
    | "unsupported"
    | "unknown";
  readonly canRequest: boolean;
  readonly canOpenSettings: boolean;
}

export interface DesktopNotificationInput {
  title: string;
  body?: string;
  silent?: boolean;
  suppressWhenForeground?: boolean;
  threadId?: ThreadId;
}

export interface DesktopWindowState {
  isMaximized: boolean;
  isFullscreen: boolean;
}

export type DesktopQuitConfirmationPresentation = "native" | "in-app";

export interface DesktopQuitConfirmationRequest {
  readonly requestId: string;
  readonly presentation: DesktopQuitConfirmationPresentation;
}

export interface DesktopQuitConfirmationChat {
  readonly id: string;
  readonly title: string;
}

export type DesktopQuitConfirmationResponse =
  | {
      readonly requestId: string;
      readonly phase: "ready";
      readonly runningCount: number;
      readonly chats: ReadonlyArray<DesktopQuitConfirmationChat>;
    }
  | {
      readonly requestId: string;
      readonly phase: "decision";
      readonly allow: boolean;
    };

export interface DesktopCustomTitleBarState {
  supported: boolean;
  preference: boolean;
  active: boolean;
  restartRequired: boolean;
}

export const DesktopAppIcon = Schema.Literals(["default", "icon", "dark"]);
export type DesktopAppIcon = typeof DesktopAppIcon.Type;

export interface DesktopComputerPreviewFrame {
  readonly windowId: number;
  readonly seq: number;
  readonly jpeg: Uint8Array;
}

export interface DesktopAgentCursorStyle {
  readonly fill?: string;
  readonly rim?: string;
  readonly shadow?: string;
}

export interface DesktopClipboardFile {
  path: string;
  name: string;
  kind: "file" | "directory";
}

export interface DesktopBridge {
  getWsUrl: () => string | null;

  getPathForFile?: (file: File) => string | null;
  pickFolder: () => Promise<string | null>;
  saveFile?: (input: {
    defaultFilename: string;
    contents: string;
    filters?: ReadonlyArray<{ name: string; extensions: ReadonlyArray<string> }>;
  }) => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  getAppIcon?: () => Promise<DesktopAppIcon>;
  setAppIcon: (icon: DesktopAppIcon) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly DesktopContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  showInFolder: (path: string) => Promise<void>;
  shell?: {
    showInFolder: (path: string) => Promise<void>;
  };
  clipboard?: {
    readFiles?: () => Promise<DesktopClipboardFile[]>;
    writeImagePngDataUrl: (dataUrl: string) => Promise<boolean>;
  };
  windowControls?: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<DesktopWindowState>;
    close: () => Promise<void>;
    getState: () => Promise<DesktopWindowState>;
    onState: (listener: (state: DesktopWindowState) => void) => () => void;
  };
  // Windows/Linux only. `frame` is fixed at BrowserWindow creation, so changing the preference
  // requires a relaunch before `active` catches up.
  customTitleBar?: {
    getState: () => Promise<DesktopCustomTitleBarState>;
    setPreference: (enabled: boolean) => Promise<DesktopCustomTitleBarState>;
    relaunch: () => Promise<void>;
  };

  computerPreview?: {
    onFrame: (listener: (frame: DesktopComputerPreviewFrame) => void) => () => void;
  };

  computer?: {
    setCursorStyle: (style: DesktopAgentCursorStyle | null) => Promise<void>;
  };
  onMenuAction: (listener: (action: string) => void) => () => void;
  onQuitConfirmationRequest: (
    listener: (request: DesktopQuitConfirmationRequest) => void,
  ) => () => void;
  replyQuitConfirmation: (response: DesktopQuitConfirmationResponse) => void;

  getZoomFactor: () => number;
  onZoomFactorChange: (listener: (zoomFactor: number) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdates: () => Promise<DesktopUpdateState>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
  notifications: {
    getPermission: () => Promise<DesktopNotificationPermission>;
    requestPermission: () => Promise<DesktopNotificationPermission>;
    openSettings: () => Promise<void>;
    isSupported: () => Promise<boolean>;
    show: (input: DesktopNotificationInput) => Promise<boolean>;
  };
  computerPermissions: {
    getState: (
      permissions?: readonly DesktopComputerPermissionKind[],
    ) => Promise<DesktopComputerState>;
    requestPermissions: (
      permissions?: readonly DesktopComputerPermissionKind[],
    ) => Promise<DesktopComputerState>;
    // Reads current grants without prompting, then walks the floating permission coach through each
    // pane still missing a grant — opening its System Settings page and raising that pane's prompt as
    // each step begins, so macOS never shows several permission dialogs at once.
    startPermissionSetup: (
      permissions: readonly DesktopComputerPermissionKind[],
    ) => Promise<DesktopComputerState>;
    openPermissionSettings: (pane: DesktopComputerSettingsPane) => Promise<boolean>;
    restartApp: () => Promise<void>;
    showPermissionGuide: (pane: DesktopComputerSettingsPane) => Promise<void>;
    hidePermissionGuide: () => Promise<void>;
    onPermissionGuideState: (
      listener: (state: DesktopComputerPermissionGuideState) => void,
    ) => () => void;
    onState: (listener: (state: DesktopComputerState) => void) => () => void;
  };
  server?: {
    transcribeVoice: (
      input: ServerVoiceTranscriptionInput,
    ) => Promise<ServerVoiceTranscriptionResult>;
  };
  browser: BrowserControlMethods & {
    annotations: BrowserAnnotationMethods;
    onBrowserUseOpenPanelRequest: (
      listener: (request: BrowserUseOpenPanelRequest) => void,
    ) => () => void;
    onBrowserCopyLink: (listener: (event: BrowserCopyLinkEvent) => void) => () => void;
  };
}

export interface NativeApi {
  dialogs: {
    pickFolder: () => Promise<string | null>;
    saveFile?: (input: {
      defaultFilename: string;
      contents: string;
      filters?: ReadonlyArray<{ name: string; extensions: ReadonlyArray<string> }>;
    }) => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  terminal: {
    open: (input: TerminalOpenInput) => Promise<TerminalSessionSnapshot>;
    write: (input: TerminalWriteInput) => Promise<void>;
    ackOutput: (input: TerminalAckOutputInput) => Promise<void>;
    resize: (input: TerminalResizeInput) => Promise<void>;
    clear: (input: TerminalClearInput) => Promise<void>;
    restart: (input: TerminalRestartInput) => Promise<TerminalSessionSnapshot>;
    close: (input: TerminalCloseInput) => Promise<void>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
  };
  projects: {
    listDirectories: (input: ProjectListDirectoriesInput) => Promise<ProjectListDirectoriesResult>;
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    searchLocalEntries: (
      input: ProjectSearchLocalEntriesInput,
    ) => Promise<ProjectSearchLocalEntriesResult>;
    searchContent: (
      input: ProjectSearchContentInput,
      options?: { readonly signal?: AbortSignal },
    ) => Promise<ProjectSearchContentResult>;
    prewarmSearchIndex: (
      input: ProjectPrewarmSearchIndexInput,
    ) => Promise<ProjectPrewarmSearchIndexResult>;
    readFile: (
      input: ProjectReadFileInput,
      options?: { readonly signal?: AbortSignal },
    ) => Promise<ProjectReadFileResult>;
    onFileChange?: (
      input: ProjectWatchFileInput,
      callback: (event: ProjectFileChangeEvent) => void,
    ) => () => void;
    resolveWorkspaceFileReferences: (
      input: ProjectResolveWorkspaceFileReferencesInput,
    ) => Promise<ProjectResolveWorkspaceFileReferencesResult>;
    resolveOutOfRootFileReference: (
      input: ProjectResolveOutOfRootFileReferenceInput,
    ) => Promise<ProjectResolveOutOfRootFileReferenceResult>;
    createLocalFilePreviewGrant: (
      input: ProjectCreateLocalFilePreviewGrantInput,
    ) => Promise<ProjectCreateLocalFilePreviewGrantResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
    manageEntry: (input: ProjectManageEntryInput) => Promise<ProjectManageEntryResult>;
    provisionFromGitHub: (
      input: GitHubProjectProvisionInput,
      options?: { readonly signal?: AbortSignal },
    ) => Promise<GitHubProjectProvisionResult>;
    onProvisionProgress: (
      callback: (event: GitHubProjectProvisionProgressEvent) => void,
    ) => () => void;
  };
  filesystem: {
    browse: (input: FilesystemBrowseInput) => Promise<FilesystemBrowseResult>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    showInFolder: (path: string) => Promise<void>;
  };
  git: {
    githubRepository: (input: GitHubRepositoryInput) => Promise<GitHubRepositoryResult>;
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>;
    listRecentCommits: (input: GitListRecentCommitsInput) => Promise<GitListRecentCommitsResult>;
    readCommit: (input: GitReadCommitInput) => Promise<GitReadCommitResult>;
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>;
    createDetachedWorktree: (
      input: GitCreateDetachedWorktreeInput,
    ) => Promise<GitCreateDetachedWorktreeResult>;
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
    createBranch: (input: GitCreateBranchInput) => Promise<void>;
    checkout: (input: GitCheckoutInput) => Promise<void>;
    stashAndCheckout: (input: GitStashAndCheckoutInput) => Promise<void>;
    stashDrop: (input: GitStashDropInput) => Promise<void>;
    stashInfo: (input: GitStashInfoInput) => Promise<GitStashInfoResult>;
    removeIndexLock: (input: GitRemoveIndexLockInput) => Promise<void>;
    init: (input: GitInitInput) => Promise<void>;
    stageFiles: (input: GitStageFilesInput) => Promise<GitStageFilesResult>;
    commitStaged: (input: GitCommitStagedInput) => Promise<void>;
    fetch: (input: GitFetchInput) => Promise<void>;
    ignorePaths: (input: GitIgnorePathsInput) => Promise<void>;
    rebase: (input: GitRebaseInput) => Promise<void>;
    checkUndoCommit: (input: GitStatusInput) => Promise<string | null>;
    undoCommit: (input: GitUndoCommitInput) => Promise<GitUndoCommitResult>;
    rebaseState: (input: GitRebaseStateInput) => Promise<GitRebaseStateResult>;
    revertUnstagedFile: (input: GitRevertUnstagedFileInput) => Promise<GitRevertUnstagedFileResult>;
    unstageFiles: (input: GitUnstageFilesInput) => Promise<GitUnstageFilesResult>;
    handoffThread: (input: GitHandoffThreadInput) => Promise<GitHandoffThreadResult>;
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;

    pull: (input: GitPullInput) => Promise<GitPullResult>;
    status: (input: GitStatusInput) => Promise<GitStatusResult>;
    sidebarSummary: (input: GitSidebarSummaryInput) => Promise<GitSidebarSummaryResult>;
    onStatus: (
      input: GitStatusWatchInput,
      callback: (event: GitStatusStreamEvent) => void,
    ) => () => void;
    readWorkingTreeDiff: (
      input: GitReadWorkingTreeDiffInput,
    ) => Promise<GitReadWorkingTreeDiffResult>;
    readSourceControlFiles: (
      input: GitReadSourceControlFilesInput,
      options?: GitReadRequestOptions,
    ) => Promise<GitSourceControlFilesResult>;
    readFileAtRev: (
      input: GitReadFileAtRevInput,
      options?: GitReadRequestOptions,
    ) => Promise<GitReadFileAtRevResult>;
    workingTreeDiffStats: (
      input: GitReadWorkingTreeDiffInput,
    ) => Promise<GitWorkingTreeDiffStatsResult>;
    blameLine: (input: GitBlameLineInput) => Promise<GitBlameLineResult>;
    generateCommitMessage: (
      input: GitGenerateCommitMessageInput,
    ) => Promise<GitGenerateCommitMessageResult>;
    summarizeDiff: (input: GitSummarizeDiffInput) => Promise<GitSummarizeDiffResult>;
    runStackedAction: (input: GitRunStackedActionInput) => Promise<GitRunStackedActionResult>;
    onActionProgress: (callback: (event: GitActionProgressEvent) => void) => () => void;
    onWorktreeSetupProgress: (
      callback: (event: GitWorktreeSetupProgressEvent) => void,
    ) => () => void;
  };

  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    getEnvironment: () => Promise<ServerGetEnvironmentResult>;
    getSettings: () => Promise<ServerGetSettingsResult>;
    updateSettings: (input: ServerUpdateSettingsInput) => Promise<ServerUpdateSettingsResult>;
    getAuthSession: () => Promise<AuthSessionState>;
    bootstrapAuth: (input: AuthBootstrapInput) => Promise<AuthBootstrapResult>;
    bootstrapBearerAuth: (input: AuthBootstrapInput) => Promise<AuthBearerBootstrapResult>;
    issueAuthWebSocketToken: () => Promise<AuthWebSocketTokenResult>;
    createAuthPairingToken: (
      input?: AuthCreatePairingCredentialInput,
    ) => Promise<AuthPairingCredentialResult>;
    listAuthPairingLinks: () => Promise<ReadonlyArray<AuthPairingLink>>;
    revokeAuthPairingLink: (input: AuthRevokePairingLinkInput) => Promise<{ revoked: boolean }>;
    listAuthClients: () => Promise<ReadonlyArray<AuthClientSession>>;
    revokeAuthClient: (input: AuthRevokeClientSessionInput) => Promise<{ revoked: boolean }>;
    revokeOtherAuthClients: () => Promise<{ revokedCount: number }>;
    logoutAuthSession: () => Promise<AuthLogoutResult>;
    refreshProviders: () => Promise<ServerRefreshProvidersResult>;
    updateProvider: (input: ServerProviderUpdateInput) => Promise<ServerProviderUpdateResult>;
    listWorktrees: () => Promise<ServerListWorktreesResult>;
    listLocalServers: () => Promise<ServerListLocalServersResult>;
    stopLocalServer: (input: ServerStopLocalServerInput) => Promise<ServerStopLocalServerResult>;
    getProviderUsageSnapshot: (
      input: ServerGetProviderUsageSnapshotInput,
    ) => Promise<ServerGetProviderUsageSnapshotResult>;
    listProviderUsage: (
      input: ServerListProviderUsageInput,
    ) => Promise<ServerListProviderUsageResult>;
    consumeCodexResetCredit: (
      input: ServerConsumeCodexResetCreditInput,
    ) => Promise<ServerConsumeCodexResetCreditResult>;
    getDiagnostics: () => Promise<ServerDiagnosticsResult>;
    readThreadDiagnostics: (
      input: ServerReadThreadDiagnosticsInput,
    ) => Promise<ServerReadThreadDiagnosticsResult>;
    prewarmVoice?: (input: ServerVoicePrewarmInput) => Promise<ServerVoicePrewarmResult>;
    transcribeVoice: (
      input: ServerVoiceTranscriptionInput,
    ) => Promise<ServerVoiceTranscriptionResult>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
  };
  stats: {
    getProfileStats: (input: StatsGetProfileStatsInput) => Promise<StatsGetProfileStatsResult>;
    getProfileTokenStats: (
      input: StatsGetProfileTokenStatsInput,
    ) => Promise<StatsGetProfileTokenStatsResult>;
  };
  provider: {
    getComposerCapabilities: (
      input: ProviderGetComposerCapabilitiesInput,
    ) => Promise<ProviderComposerCapabilities>;
    listCommands: (input: ProviderListCommandsInput) => Promise<ProviderListCommandsResult>;
    listSkills: (input: ProviderListSkillsInput) => Promise<ProviderListSkillsResult>;
    listSkillsCatalog: (input: ProviderSkillsCatalogInput) => Promise<ProviderSkillsCatalogResult>;
    listPlugins: (input: ProviderListPluginsInput) => Promise<ProviderListPluginsResult>;
    listMcpServers: (input: ProviderManagementContext) => Promise<ProviderListMcpServersResult>;
    manageMcpServer: (input: ProviderManageMcpServerInput) => Promise<ProviderManagementResult>;
    pluginInventory: (input: ProviderManagementContext) => Promise<ProviderPluginInventoryResult>;
    managePlugin: (input: ProviderManagePluginInput) => Promise<ProviderManagementResult>;

    readPlugin: (input: ProviderReadPluginInput) => Promise<ProviderReadPluginResult>;
    listModels: (input: ProviderListModelsInput) => Promise<ProviderListModelsResult>;
    listAgents: (input: ProviderListAgentsInput) => Promise<ProviderListAgentsResult>;
  };
  orchestration: {
    getSnapshot: () => Promise<OrchestrationReadModel>;
    getShellSnapshot: () => Promise<OrchestrationShellSnapshot>;
    getThreadDetailSnapshot: (
      input: OrchestrationGetThreadDetailSnapshotInput,
    ) => Promise<OrchestrationGetThreadDetailSnapshotResult>;
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    prepareHandoff: (input: { threadId: ThreadId }) => Promise<void>;
    importThread: (
      input: OrchestrationImportThreadInput,
    ) => Promise<OrchestrationImportThreadResult>;
    listProjectImports: (input: ListProjectImportsInput) => Promise<ListProjectImportsResult>;
    readImportedHistory: (input: ReadImportedHistoryInput) => Promise<ReadImportedHistoryResult>;
    importProject: (input: ImportProjectInput) => Promise<ImportProjectResult>;

    repairState: () => Promise<OrchestrationReadModel>;
    previewWorkspaceRestore: (
      input: PreviewWorkspaceRestoreInput,
    ) => Promise<WorkspaceRestorePreview>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    replayEvents: (
      fromSequenceExclusive: number,
      threadId?: ThreadId,
    ) => Promise<OrchestrationEvent[]>;
    listProviderDeliveryBlockers: (
      input?: OrchestrationListProviderDeliveryBlockersInput,
    ) => Promise<OrchestrationListProviderDeliveryBlockersResult>;
    reconcileProviderDelivery: (
      input: OrchestrationReconcileProviderDeliveryInput,
    ) => Promise<OrchestrationReconcileProviderDeliveryResult>;
    prepareQuitResume: (
      input: OrchestrationPrepareQuitResumeInput,
    ) => Promise<OrchestrationPrepareQuitResumeResult>;
    subscribeShell: () => Promise<void>;
    unsubscribeShell: () => Promise<void>;
    subscribeThread: (input: OrchestrationSubscribeThreadInput) => Promise<void>;
    unsubscribeThread: (input: OrchestrationUnsubscribeThreadInput) => Promise<void>;
    onDomainEvent: (callback: (event: OrchestrationEvent) => void) => () => void;
    onShellEvent: (callback: (event: OrchestrationShellStreamItem) => void) => () => void;
    onThreadEvent: (callback: (event: OrchestrationThreadStreamItem) => void) => () => void;
  };
  browser: BrowserControlMethods & {
    annotations: BrowserAnnotationMethods;
    onCopyLink: (callback: (event: BrowserCopyLinkEvent) => void) => () => void;
  };

  computer: {
    getStatus: (input: ComputerGetStatusInput) => Promise<ComputerStatusResult>;
    getAuditHistory: (
      input: ComputerGetAuditHistoryInput,
    ) => Promise<ComputerGetAuditHistoryResult>;
    provision: (input: ComputerProvisionInput) => Promise<ComputerProvisionResult>;
    setControlEnabled: (
      input: ComputerSetControlEnabledInput,
    ) => Promise<ComputerControlEnabledResult>;
    getThreadState: (input: ComputerThreadInput) => Promise<ThreadComputerState>;
    getState: (input: ComputerGetStateInput) => Promise<ComputerState>;

    inputClick: (input: ComputerInputClickInput) => Promise<ComputerActionResult>;
    inputScroll: (input: ComputerInputScrollInput) => Promise<ComputerActionResult>;
    inputKey: (input: ComputerInputKeyInput) => Promise<ComputerActionResult>;
    onEvent: (callback: (event: ComputerEvent) => void) => () => void;
  };
}
