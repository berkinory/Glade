import type {
  GitPublishContextInput,
  GitPublishContextResult,
  GitPublishRepositoryInput,
  GitPublishRepositoryResult,
} from "../git/githubRepositoryPublishing";
import type { DesktopMenuShortcutState } from "./menuShortcuts";
import type { BrowserTabsChanged } from "../browser/browserHost";
import type { BrowserPanelCommand, BrowserTabsSubscribeInput } from "../transport/ws/browserRpc";
import type { ComputerGrantTarget, ComputerState } from "../transport/ws/computerRpc";
import type {
  BrowserPickedElement,
  BrowserPickTarget,
  BrowserViewPlacement,
} from "../browser/browserView";
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

// Computer Use needs Accessibility and Screen Recording on macOS; other platforms report
// "not-applicable".
export interface DesktopComputerPermissions {
  readonly status: "granted" | "missing" | "not-applicable";
  readonly accessibility: boolean;
  readonly screenRecording: boolean;
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

export const DesktopAppIcon = Schema.Literals(["default", "dark"]);
export type DesktopAppIcon = typeof DesktopAppIcon.Type;

export interface DesktopClipboardFile {
  path: string;
  name: string;
  kind: "file" | "directory";
}

export interface DesktopWindowMaterialState {
  readonly supported: boolean;
  readonly enabled: boolean;
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
  windowMaterial?: {
    getState: () => Promise<DesktopWindowMaterialState>;
    setEnabled: (enabled: boolean) => Promise<DesktopWindowMaterialState>;
  };
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

  setMenuShortcuts: (state: DesktopMenuShortcutState) => Promise<void>;
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
  server?: {
    transcribeVoice: (
      input: ServerVoiceTranscriptionInput,
    ) => Promise<ServerVoiceTranscriptionResult>;
  };
  computer?: {
    getPermissions: () => Promise<DesktopComputerPermissions>;
    // Prompts for Accessibility; Screen Recording has no prompt, so openSettings opens its pane.
    requestPermissions: () => Promise<DesktopComputerPermissions>;
    openSettings: () => Promise<void>;
  };
  browser?: {
    placeView: (placement: BrowserViewPlacement) => void;
    // Resolves with null when the pick is cancelled (Escape, toggle off, another pick).
    pickElement: (target: BrowserPickTarget) => Promise<BrowserPickedElement | null>;
    cancelPick: (threadId: string) => void;
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
  browser: {
    onTabs: (
      input: BrowserTabsSubscribeInput,
      callback: (event: BrowserTabsChanged) => void,
    ) => () => void;
    command: (command: BrowserPanelCommand) => Promise<void>;
  };
  computer: {
    onState: (callback: (state: ComputerState) => void) => () => void;
    revokeGrant: (target: ComputerGrantTarget) => Promise<void>;
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
    publishContext: (input: GitPublishContextInput) => Promise<GitPublishContextResult>;
    publishRepository: (input: GitPublishRepositoryInput) => Promise<GitPublishRepositoryResult>;
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
}
