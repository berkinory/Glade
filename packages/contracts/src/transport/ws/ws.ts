import {
  GitPublishContextInput,
  GitPublishRepositoryInput,
} from "../../git/githubRepositoryPublishing";
import { GladeAppOpenRequest } from "../../provider/agentGatewayTools";
import { PreviewWorkspaceRestoreInput } from "../../orchestration/workspaceRestore";
import {
  ProviderManagementContext,
  ProviderManageMcpServerInput,
  ProviderManagePluginInput,
} from "../../provider/providerManagement";
import { Schema, Struct } from "effect";
import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "../../core/baseSchemas";
import { ClientOrchestrationCommand } from "../../orchestration/commands";
import { OrchestrationEvent } from "../../orchestration/events";
import {
  OrchestrationSubscribeShellInput,
  OrchestrationSubscribeThreadInput,
  OrchestrationUnsubscribeShellInput,
  OrchestrationUnsubscribeThreadInput,
  ORCHESTRATION_WS_CHANNELS,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetThreadDetailSnapshotInput,
  OrchestrationGetShellSnapshotInput,
  OrchestrationRepairStateInput,
  ORCHESTRATION_WS_METHODS,
  OrchestrationGetSnapshotInput,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsInput,
} from "../../orchestration/rpc";
import {
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
} from "../../orchestration/snapshots";
import {
  GitActionProgressEvent,
  GitBlameLineInput,
  GitReadFileAtRevInput,
  GitReadSourceControlFilesInput,
  GitCheckoutInput,
  GitCreateBranchInput,
  GitCreateDetachedWorktreeInput,
  GitHubRepositoryInput,
  GitHandoffThreadInput,
  GitPreparePullRequestThreadInput,
  GitCreateWorktreeInput,
  GitInitInput,
  GitListBranchesInput,
  GitListRecentCommitsInput,
  GitReadCommitInput,
  GitPullInput,
  GitPullRequestRefInput,
  GitReadWorkingTreeDiffInput,
  GitRemoveWorktreeInput,
  GitRemoveIndexLockInput,
  GitRunStackedActionInput,
  GitStageFilesInput,
  GitRevertUnstagedFileInput,
  GitCommitStagedInput,
  GitFetchInput,
  GitIgnorePathsInput,
  GitRebaseInput,
  GitUndoCommitInput,
  GitRebaseStateInput,
  GitStashAndCheckoutInput,
  GitStashDropInput,
  GitStashInfoInput,
  GitStatusInput,
  GitStatusWatchInput,
  GitSidebarSummaryInput,
  GitSummarizeDiffInput,
  GitGenerateCommitMessageInput,
  GitUnstageFilesInput,
  GitWorktreeSetupProgressEvent,
} from "../../git/git";
import {
  TerminalAckOutputInput,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalWriteInput,
} from "../../terminal/terminal";
import { KeybindingRule } from "../../settings/keybindings";
import {
  ProjectCreateLocalFilePreviewGrantInput,
  ProjectListDirectoriesInput,
  ProjectReadFileInput,
  ProjectWatchFileInput,
  ProjectPrewarmSearchIndexInput,
  ProjectResolveWorkspaceFileReferencesInput,
  ProjectResolveOutOfRootFileReferenceInput,
  ProjectSearchEntriesInput,
  ProjectSearchContentInput,
  ProjectSearchLocalEntriesInput,
  ProjectWriteFileInput,
  ProjectManageEntryInput,
} from "../../workspace/project";
import { FilesystemBrowseInput } from "../../workspace/filesystem";
import { COMPUTER_WS_CHANNELS, ComputerEvent } from "../../computer/computer";
import { OpenInEditorInput } from "../../settings/editor";
import {
  ServerConfigUpdatedPayload,
  ServerReadThreadDiagnosticsInput,
  ServerLifecycleStreamEvent,
  ServerProviderUpdateInput,
  ServerUpdateSettingsInput,
  ServerConsumeCodexResetCreditInput,
  ServerGetProviderUsageSnapshotInput,
  ServerListProviderUsageInput,
  ServerProviderStatusesUpdatedPayload,
  ServerSettingsUpdatedPayload,
  ServerStopLocalServerInput,
  ServerVoicePrewarmInput,
  ServerVoiceTranscriptionInput,
} from "../../server/server";
import { StatsGetProfileStatsInput, StatsGetProfileTokenStatsInput } from "../../server/stats";
import {
  ProviderListCommandsInput,
  ProviderGetComposerCapabilitiesInput,
  ProviderListPluginsInput,
  ProviderListModelsInput,
  ProviderListAgentsInput,
  ProviderReadPluginInput,
  ProviderListSkillsInput,
  ProviderSkillsCatalogInput,
} from "../../provider/providerDiscovery";
import {
  GitHubProjectProvisionInput,
  GitHubProjectProvisionProgressEvent,
} from "../../git/githubProjectProvisioning";

export const WS_METHODS = {
  subscribeAppPresentation: "app.subscribePresentation",
  acknowledgeAppPresentation: "app.acknowledgePresentation",
  projectsListDirectories: "projects.listDirectories",
  projectsSearchEntries: "projects.searchEntries",
  projectsSearchLocalEntries: "projects.searchLocalEntries",
  projectsSearchContent: "projects.searchContent",
  projectsPrewarmSearchIndex: "projects.prewarmSearchIndex",
  projectsReadFile: "projects.readFile",
  projectsSubscribeFileChange: "projects.subscribeFileChange",
  projectsResolveWorkspaceFileReferences: "projects.resolveWorkspaceFileReferences",
  projectsResolveOutOfRootFileReference: "projects.resolveOutOfRootFileReference",
  projectsCreateLocalFilePreviewGrant: "projects.createLocalFilePreviewGrant",
  projectsWriteFile: "projects.writeFile",
  projectsManageEntry: "projects.manageEntry",
  projectsProvisionFromGitHub: "projects.provisionFromGitHub",

  filesystemBrowse: "filesystem.browse",

  shellOpenInEditor: "shell.openInEditor",

  gitPull: "git.pull",
  gitGithubRepository: "git.githubRepository",
  gitStatus: "git.status",
  gitSidebarSummary: "git.sidebarSummary",
  gitSubscribeStatus: "git.subscribeStatus",
  gitReadWorkingTreeDiff: "git.readWorkingTreeDiff",
  gitReadSourceControlFiles: "git.readSourceControlFiles",
  gitBlameLine: "git.blameLine",
  gitReadFileAtRev: "git.readFileAtRev",
  gitWorkingTreeDiffStats: "git.workingTreeDiffStats",
  gitGenerateCommitMessage: "git.generateCommitMessage",
  gitSummarizeDiff: "git.summarizeDiff",
  gitRunStackedAction: "git.runStackedAction",
  gitListBranches: "git.listBranches",
  gitListRecentCommits: "git.listRecentCommits",
  gitReadCommit: "git.readCommit",
  gitCreateWorktree: "git.createWorktree",
  gitCreateDetachedWorktree: "git.createDetachedWorktree",
  gitRemoveWorktree: "git.removeWorktree",
  gitCreateBranch: "git.createBranch",
  gitCheckout: "git.checkout",
  gitStashAndCheckout: "git.stashAndCheckout",
  gitStashDrop: "git.stashDrop",
  gitStashInfo: "git.stashInfo",
  gitRemoveIndexLock: "git.removeIndexLock",
  gitInit: "git.init",
  gitPublishContext: "git.publishContext",
  gitPublishRepository: "git.publishRepository",
  gitStageFiles: "git.stageFiles",
  gitCommitStaged: "git.commitStaged",
  gitFetch: "git.fetch",
  gitIgnorePaths: "git.ignorePaths",
  gitRebase: "git.rebase",
  gitCheckUndoCommit: "git.checkUndoCommit",
  gitUndoCommit: "git.undoCommit",
  gitRebaseState: "git.rebaseState",
  gitRevertUnstagedFile: "git.revertUnstagedFile",
  gitUnstageFiles: "git.unstageFiles",
  gitHandoffThread: "git.handoffThread",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalAckOutput: "terminal.ackOutput",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  serverGetConfig: "server.getConfig",
  serverGetEnvironment: "server.getEnvironment",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateProvider: "server.updateProvider",
  serverListWorktrees: "server.listWorktrees",
  serverListLocalServers: "server.listLocalServers",
  serverStopLocalServer: "server.stopLocalServer",
  serverGetProviderUsageSnapshot: "server.getProviderUsageSnapshot",
  serverListProviderUsage: "server.listProviderUsage",
  serverConsumeCodexResetCredit: "server.consumeCodexResetCredit",
  statsGetProfileStats: "stats.getProfileStats",
  statsGetProfileTokenStats: "stats.getProfileTokenStats",
  serverGetDiagnostics: "server.getDiagnostics",
  serverReadThreadDiagnostics: "server.readThreadDiagnostics",
  serverPrewarmVoice: "server.prewarmVoice",
  serverTranscribeVoice: "server.transcribeVoice",
  serverUpsertKeybinding: "server.upsertKeybinding",
  subscribeServerLifecycle: "server.subscribeLifecycle",
  subscribeServerConfig: "server.subscribeConfig",
  subscribeServerProviderStatuses: "server.subscribeProviderStatuses",
  subscribeServerSettings: "server.subscribeSettings",

  subscribeTerminalEvents: "terminal.subscribeEvents",
  subscribeOrchestrationDomainEvents: "orchestration.subscribeDomainEvents",

  providerGetComposerCapabilities: "provider.getComposerCapabilities",
  providerListCommands: "provider.listCommands",
  providerListSkills: "provider.listSkills",
  providerListSkillsCatalog: "provider.listSkillsCatalog",
  providerListPlugins: "provider.listPlugins",
  providerListMcpServers: "provider.listMcpServers",
  providerManageMcpServer: "provider.manageMcpServer",
  providerPluginInventory: "provider.pluginInventory",
  providerManagePlugin: "provider.managePlugin",

  providerReadPlugin: "provider.readPlugin",
  providerListModels: "provider.listModels",
  providerListAgents: "provider.listAgents",
} as const;

export const WS_CHANNELS = {
  appPresentation: "app.presentation",
  gitActionProgress: "git.actionProgress",
  gitWorktreeSetupProgress: "git.worktreeSetupProgress",
  projectProvisionProgress: "project.provisionProgress",
  terminalEvent: "terminal.event",
  serverWelcome: "server.welcome",
  serverMaintenanceUpdated: "server.maintenanceUpdated",
  serverConfigUpdated: "server.configUpdated",
  serverProviderStatusesUpdated: "server.providerStatusesUpdated",
  serverSettingsUpdated: "server.settingsUpdated",
} as const;

const tagRequestBody = <const Tag extends string, const Fields extends Schema.Struct.Fields>(
  tag: Tag,
  schema: Schema.Struct<Fields>,
) =>
  schema.mapFields(
    Struct.assign({ _tag: Schema.tag(tag) }),

    { unsafePreserveChecks: true },
  );

const WebSocketRequestBody = Schema.Union([
  tagRequestBody(
    ORCHESTRATION_WS_METHODS.dispatchCommand,
    Schema.Struct({ command: ClientOrchestrationCommand }),
  ),
  tagRequestBody(ORCHESTRATION_WS_METHODS.prepareHandoff, Schema.Struct({ threadId: ThreadId })),
  tagRequestBody(ORCHESTRATION_WS_METHODS.getSnapshot, OrchestrationGetSnapshotInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.getShellSnapshot, OrchestrationGetShellSnapshotInput),
  tagRequestBody(
    ORCHESTRATION_WS_METHODS.getThreadDetailSnapshot,
    OrchestrationGetThreadDetailSnapshotInput,
  ),
  tagRequestBody(ORCHESTRATION_WS_METHODS.repairState, OrchestrationRepairStateInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.getTurnDiff, OrchestrationGetTurnDiffInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.getFullThreadDiff, OrchestrationGetFullThreadDiffInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.previewWorkspaceRestore, PreviewWorkspaceRestoreInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.replayEvents, OrchestrationReplayEventsInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.subscribeShell, OrchestrationSubscribeShellInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.unsubscribeShell, OrchestrationUnsubscribeShellInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.subscribeThread, OrchestrationSubscribeThreadInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.unsubscribeThread, OrchestrationUnsubscribeThreadInput),
  tagRequestBody(WS_METHODS.projectsListDirectories, ProjectListDirectoriesInput),
  tagRequestBody(WS_METHODS.projectsSearchEntries, ProjectSearchEntriesInput),
  tagRequestBody(WS_METHODS.projectsSearchLocalEntries, ProjectSearchLocalEntriesInput),
  tagRequestBody(WS_METHODS.projectsSearchContent, ProjectSearchContentInput),
  tagRequestBody(WS_METHODS.projectsPrewarmSearchIndex, ProjectPrewarmSearchIndexInput),
  tagRequestBody(WS_METHODS.projectsReadFile, ProjectReadFileInput),
  tagRequestBody(WS_METHODS.projectsSubscribeFileChange, ProjectWatchFileInput),
  tagRequestBody(
    WS_METHODS.projectsResolveWorkspaceFileReferences,
    ProjectResolveWorkspaceFileReferencesInput,
  ),
  tagRequestBody(
    WS_METHODS.projectsResolveOutOfRootFileReference,
    ProjectResolveOutOfRootFileReferenceInput,
  ),
  tagRequestBody(
    WS_METHODS.projectsCreateLocalFilePreviewGrant,
    ProjectCreateLocalFilePreviewGrantInput,
  ),
  tagRequestBody(WS_METHODS.projectsWriteFile, ProjectWriteFileInput),
  Schema.Union([
    tagRequestBody(WS_METHODS.projectsManageEntry, ProjectManageEntryInput.members[0]),
    tagRequestBody(WS_METHODS.projectsManageEntry, ProjectManageEntryInput.members[1]),
  ]),
  tagRequestBody(WS_METHODS.projectsProvisionFromGitHub, GitHubProjectProvisionInput),

  tagRequestBody(WS_METHODS.filesystemBrowse, FilesystemBrowseInput),

  tagRequestBody(WS_METHODS.shellOpenInEditor, OpenInEditorInput),

  tagRequestBody(WS_METHODS.gitPull, GitPullInput),
  tagRequestBody(WS_METHODS.gitGithubRepository, GitHubRepositoryInput),
  tagRequestBody(WS_METHODS.gitStatus, GitStatusInput),
  tagRequestBody(WS_METHODS.gitSidebarSummary, GitSidebarSummaryInput),
  tagRequestBody(WS_METHODS.gitSubscribeStatus, GitStatusWatchInput),
  tagRequestBody(WS_METHODS.gitReadWorkingTreeDiff, GitReadWorkingTreeDiffInput),
  tagRequestBody(WS_METHODS.gitReadSourceControlFiles, GitReadSourceControlFilesInput),
  tagRequestBody(WS_METHODS.gitBlameLine, GitBlameLineInput),
  tagRequestBody(WS_METHODS.gitReadFileAtRev, GitReadFileAtRevInput),
  tagRequestBody(WS_METHODS.gitWorkingTreeDiffStats, GitReadWorkingTreeDiffInput),
  tagRequestBody(WS_METHODS.gitGenerateCommitMessage, GitGenerateCommitMessageInput),
  tagRequestBody(WS_METHODS.gitSummarizeDiff, GitSummarizeDiffInput),
  tagRequestBody(WS_METHODS.gitRunStackedAction, GitRunStackedActionInput),
  tagRequestBody(WS_METHODS.gitListBranches, GitListBranchesInput),
  tagRequestBody(WS_METHODS.gitListRecentCommits, GitListRecentCommitsInput),
  tagRequestBody(WS_METHODS.gitReadCommit, GitReadCommitInput),
  tagRequestBody(WS_METHODS.gitCreateWorktree, GitCreateWorktreeInput),
  tagRequestBody(WS_METHODS.gitCreateDetachedWorktree, GitCreateDetachedWorktreeInput),
  tagRequestBody(WS_METHODS.gitRemoveWorktree, GitRemoveWorktreeInput),
  tagRequestBody(WS_METHODS.gitCreateBranch, GitCreateBranchInput),
  tagRequestBody(WS_METHODS.gitCheckout, GitCheckoutInput),
  tagRequestBody(WS_METHODS.gitStashAndCheckout, GitStashAndCheckoutInput),
  tagRequestBody(WS_METHODS.gitStashDrop, GitStashDropInput),
  tagRequestBody(WS_METHODS.gitStashInfo, GitStashInfoInput),
  tagRequestBody(WS_METHODS.gitRemoveIndexLock, GitRemoveIndexLockInput),
  tagRequestBody(WS_METHODS.gitInit, GitInitInput),
  tagRequestBody(WS_METHODS.gitPublishContext, GitPublishContextInput),
  tagRequestBody(WS_METHODS.gitPublishRepository, GitPublishRepositoryInput),
  tagRequestBody(WS_METHODS.gitStageFiles, GitStageFilesInput),
  tagRequestBody(WS_METHODS.gitCommitStaged, GitCommitStagedInput),
  tagRequestBody(WS_METHODS.gitFetch, GitFetchInput),
  tagRequestBody(WS_METHODS.gitIgnorePaths, GitIgnorePathsInput),
  tagRequestBody(WS_METHODS.gitRebase, GitRebaseInput.members[0]),
  tagRequestBody(WS_METHODS.gitRebase, GitRebaseInput.members[1]),
  tagRequestBody(WS_METHODS.gitCheckUndoCommit, GitStatusInput),
  tagRequestBody(WS_METHODS.gitUndoCommit, GitUndoCommitInput),
  tagRequestBody(WS_METHODS.gitRebaseState, GitRebaseStateInput),
  tagRequestBody(WS_METHODS.gitRevertUnstagedFile, GitRevertUnstagedFileInput),
  tagRequestBody(WS_METHODS.gitUnstageFiles, GitUnstageFilesInput),
  tagRequestBody(WS_METHODS.gitHandoffThread, GitHandoffThreadInput),
  tagRequestBody(WS_METHODS.gitResolvePullRequest, GitPullRequestRefInput),
  tagRequestBody(WS_METHODS.gitPreparePullRequestThread, GitPreparePullRequestThreadInput),

  tagRequestBody(WS_METHODS.terminalOpen, TerminalOpenInput),
  tagRequestBody(WS_METHODS.terminalWrite, TerminalWriteInput),
  tagRequestBody(WS_METHODS.terminalAckOutput, TerminalAckOutputInput),
  tagRequestBody(WS_METHODS.terminalResize, TerminalResizeInput),
  tagRequestBody(WS_METHODS.terminalClear, TerminalClearInput),
  tagRequestBody(WS_METHODS.terminalRestart, TerminalRestartInput),
  tagRequestBody(WS_METHODS.terminalClose, TerminalCloseInput),

  tagRequestBody(WS_METHODS.serverGetConfig, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverGetEnvironment, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverGetSettings, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverUpdateSettings, ServerUpdateSettingsInput),
  tagRequestBody(WS_METHODS.serverRefreshProviders, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverUpdateProvider, ServerProviderUpdateInput),
  tagRequestBody(WS_METHODS.serverListWorktrees, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverListLocalServers, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverStopLocalServer, ServerStopLocalServerInput),
  tagRequestBody(WS_METHODS.serverGetProviderUsageSnapshot, ServerGetProviderUsageSnapshotInput),
  tagRequestBody(WS_METHODS.serverListProviderUsage, ServerListProviderUsageInput),
  tagRequestBody(WS_METHODS.serverConsumeCodexResetCredit, ServerConsumeCodexResetCreditInput),
  tagRequestBody(WS_METHODS.statsGetProfileStats, StatsGetProfileStatsInput),
  tagRequestBody(WS_METHODS.statsGetProfileTokenStats, StatsGetProfileTokenStatsInput),
  tagRequestBody(WS_METHODS.serverGetDiagnostics, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverReadThreadDiagnostics, ServerReadThreadDiagnosticsInput),
  tagRequestBody(WS_METHODS.serverPrewarmVoice, ServerVoicePrewarmInput),
  tagRequestBody(WS_METHODS.serverTranscribeVoice, ServerVoiceTranscriptionInput),
  tagRequestBody(WS_METHODS.serverUpsertKeybinding, KeybindingRule),

  tagRequestBody(WS_METHODS.providerGetComposerCapabilities, ProviderGetComposerCapabilitiesInput),
  tagRequestBody(WS_METHODS.providerListCommands, ProviderListCommandsInput),
  tagRequestBody(WS_METHODS.providerListSkills, ProviderListSkillsInput),
  tagRequestBody(WS_METHODS.providerListSkillsCatalog, ProviderSkillsCatalogInput),
  tagRequestBody(WS_METHODS.providerListPlugins, ProviderListPluginsInput),
  tagRequestBody(WS_METHODS.providerListMcpServers, ProviderManagementContext),
  tagRequestBody(WS_METHODS.providerManageMcpServer, ProviderManageMcpServerInput),
  tagRequestBody(WS_METHODS.providerPluginInventory, ProviderManagementContext),
  tagRequestBody(WS_METHODS.providerManagePlugin, ProviderManagePluginInput),

  tagRequestBody(WS_METHODS.providerReadPlugin, ProviderReadPluginInput),
  tagRequestBody(WS_METHODS.providerListModels, ProviderListModelsInput),
  tagRequestBody(WS_METHODS.providerListAgents, ProviderListAgentsInput),
]);

export const WebSocketRequest = Schema.Struct({
  id: TrimmedNonEmptyString,
  body: WebSocketRequestBody,
});
export type WebSocketRequest = typeof WebSocketRequest.Type;

export const WebSocketResponse = Schema.Struct({
  id: TrimmedNonEmptyString,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({
      message: Schema.String,
    }),
  ),
});
export type WebSocketResponse = typeof WebSocketResponse.Type;

export const WsPushSequence = NonNegativeInt;
export type WsPushSequence = typeof WsPushSequence.Type;

export const WsWelcomePayload = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  homeDir: Schema.optional(TrimmedNonEmptyString),
  chatWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
  projectName: TrimmedNonEmptyString,
  bootstrapProjectId: Schema.optional(ProjectId),
  bootstrapThreadId: Schema.optional(ThreadId),
});
export type WsWelcomePayload = typeof WsWelcomePayload.Type;

export interface WsPushPayloadByChannel {
  readonly [WS_CHANNELS.appPresentation]: typeof GladeAppOpenRequest.Type;
  readonly [WS_CHANNELS.serverWelcome]: WsWelcomePayload;
  readonly [WS_CHANNELS.serverMaintenanceUpdated]: ServerLifecycleStreamEvent;
  readonly [WS_CHANNELS.serverConfigUpdated]: typeof ServerConfigUpdatedPayload.Type;
  readonly [WS_CHANNELS.serverProviderStatusesUpdated]: typeof ServerProviderStatusesUpdatedPayload.Type;
  readonly [WS_CHANNELS.serverSettingsUpdated]: typeof ServerSettingsUpdatedPayload.Type;
  readonly [WS_CHANNELS.gitActionProgress]: typeof GitActionProgressEvent.Type;
  readonly [WS_CHANNELS.gitWorktreeSetupProgress]: typeof GitWorktreeSetupProgressEvent.Type;
  readonly [WS_CHANNELS.projectProvisionProgress]: typeof GitHubProjectProvisionProgressEvent.Type;
  readonly [WS_CHANNELS.terminalEvent]: typeof TerminalEvent.Type;
  readonly [COMPUTER_WS_CHANNELS.event]: typeof ComputerEvent.Type;
  readonly [ORCHESTRATION_WS_CHANNELS.domainEvent]: OrchestrationEvent;
  readonly [ORCHESTRATION_WS_CHANNELS.shellEvent]: OrchestrationShellStreamItem;
  readonly [ORCHESTRATION_WS_CHANNELS.threadEvent]: OrchestrationThreadStreamItem;
}

export type WsPushChannel = keyof WsPushPayloadByChannel;
export type WsPushData<C extends WsPushChannel> = WsPushPayloadByChannel[C];

const makeWsPushSchema = <const Channel extends string, Payload extends Schema.Schema<any>>(
  channel: Channel,
  payload: Payload,
) =>
  Schema.Struct({
    type: Schema.Literal("push"),
    sequence: WsPushSequence,
    channel: Schema.Literal(channel),
    data: payload,
  });

export const WsPushAppPresentation = makeWsPushSchema(
  WS_CHANNELS.appPresentation,
  GladeAppOpenRequest,
);
export const WsPushServerWelcome = makeWsPushSchema(WS_CHANNELS.serverWelcome, WsWelcomePayload);
export const WsPushServerMaintenanceUpdated = makeWsPushSchema(
  WS_CHANNELS.serverMaintenanceUpdated,
  ServerLifecycleStreamEvent,
);
export const WsPushServerConfigUpdated = makeWsPushSchema(
  WS_CHANNELS.serverConfigUpdated,
  ServerConfigUpdatedPayload,
);
export const WsPushServerProviderStatusesUpdated = makeWsPushSchema(
  WS_CHANNELS.serverProviderStatusesUpdated,
  ServerProviderStatusesUpdatedPayload,
);
export const WsPushServerSettingsUpdated = makeWsPushSchema(
  WS_CHANNELS.serverSettingsUpdated,
  ServerSettingsUpdatedPayload,
);
export const WsPushGitActionProgress = makeWsPushSchema(
  WS_CHANNELS.gitActionProgress,
  GitActionProgressEvent,
);
export const WsPushGitWorktreeSetupProgress = makeWsPushSchema(
  WS_CHANNELS.gitWorktreeSetupProgress,
  GitWorktreeSetupProgressEvent,
);
export const WsPushProjectProvisionProgress = makeWsPushSchema(
  WS_CHANNELS.projectProvisionProgress,
  GitHubProjectProvisionProgressEvent,
);
export const WsPushTerminalEvent = makeWsPushSchema(WS_CHANNELS.terminalEvent, TerminalEvent);
export const WsPushComputerEvent = makeWsPushSchema(COMPUTER_WS_CHANNELS.event, ComputerEvent);
export const WsPushOrchestrationDomainEvent = makeWsPushSchema(
  ORCHESTRATION_WS_CHANNELS.domainEvent,
  OrchestrationEvent,
);
export const WsPushOrchestrationShellEvent = makeWsPushSchema(
  ORCHESTRATION_WS_CHANNELS.shellEvent,
  OrchestrationShellStreamItem,
);
export const WsPushOrchestrationThreadEvent = makeWsPushSchema(
  ORCHESTRATION_WS_CHANNELS.threadEvent,
  OrchestrationThreadStreamItem,
);

export const WsPushChannelSchema = Schema.Literals([
  WS_CHANNELS.appPresentation,
  WS_CHANNELS.gitActionProgress,
  WS_CHANNELS.gitWorktreeSetupProgress,
  WS_CHANNELS.projectProvisionProgress,
  WS_CHANNELS.serverWelcome,
  WS_CHANNELS.serverMaintenanceUpdated,
  WS_CHANNELS.serverConfigUpdated,
  WS_CHANNELS.serverProviderStatusesUpdated,
  WS_CHANNELS.serverSettingsUpdated,
  WS_CHANNELS.terminalEvent,
  COMPUTER_WS_CHANNELS.event,
  ORCHESTRATION_WS_CHANNELS.domainEvent,
  ORCHESTRATION_WS_CHANNELS.shellEvent,
  ORCHESTRATION_WS_CHANNELS.threadEvent,
]);
export type WsPushChannelSchema = typeof WsPushChannelSchema.Type;

export const WsPush = Schema.Union([
  WsPushAppPresentation,
  WsPushServerWelcome,
  WsPushServerMaintenanceUpdated,
  WsPushServerConfigUpdated,
  WsPushServerProviderStatusesUpdated,
  WsPushServerSettingsUpdated,
  WsPushGitActionProgress,
  WsPushGitWorktreeSetupProgress,
  WsPushProjectProvisionProgress,
  WsPushTerminalEvent,
  WsPushComputerEvent,
  WsPushOrchestrationDomainEvent,
  WsPushOrchestrationShellEvent,
  WsPushOrchestrationThreadEvent,
]);
export type WsPush = typeof WsPush.Type;

export type WsPushMessage<C extends WsPushChannel> = Extract<WsPush, { channel: C }>;

export const WsPushEnvelopeBase = Schema.Struct({
  type: Schema.Literal("push"),
  sequence: WsPushSequence,
  channel: WsPushChannelSchema,
  data: Schema.Unknown,
});
export type WsPushEnvelopeBase = typeof WsPushEnvelopeBase.Type;

export const WsResponse = Schema.Union([WebSocketResponse, WsPush]);
export type WsResponse = typeof WsResponse.Type;
