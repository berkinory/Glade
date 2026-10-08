import { Schema } from "effect";
import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "../../core/baseSchemas";
import { GitActionProgressEvent, GitWorktreeSetupProgressEvent } from "../../git/git";
import { GitHubProjectProvisionProgressEvent } from "../../git/githubProjectProvisioning";
import { OrchestrationEvent } from "../../orchestration/events";
import { ORCHESTRATION_WS_CHANNELS } from "../../orchestration/rpc";
import {
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
} from "../../orchestration/snapshots";
import { GladeAppOpenRequest } from "../../provider/agentGatewayTools";
import {
  ServerConfigUpdatedPayload,
  ServerLifecycleStreamEvent,
  ServerProviderStatusesUpdatedPayload,
  ServerSettingsUpdatedPayload,
} from "../../server/server";
import { TerminalEvent } from "../../terminal/terminal";

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
  serverGetRuntimeStatus: "server.getRuntimeStatus",
  serverGetKeepAwakeStatus: "server.getKeepAwakeStatus",
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

const WsPushSequence = NonNegativeInt;

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

const WsPushAppPresentation = makeWsPushSchema(WS_CHANNELS.appPresentation, GladeAppOpenRequest);
const WsPushServerWelcome = makeWsPushSchema(WS_CHANNELS.serverWelcome, WsWelcomePayload);
const WsPushServerMaintenanceUpdated = makeWsPushSchema(
  WS_CHANNELS.serverMaintenanceUpdated,
  ServerLifecycleStreamEvent,
);
const WsPushServerConfigUpdated = makeWsPushSchema(
  WS_CHANNELS.serverConfigUpdated,
  ServerConfigUpdatedPayload,
);
const WsPushServerProviderStatusesUpdated = makeWsPushSchema(
  WS_CHANNELS.serverProviderStatusesUpdated,
  ServerProviderStatusesUpdatedPayload,
);
const WsPushServerSettingsUpdated = makeWsPushSchema(
  WS_CHANNELS.serverSettingsUpdated,
  ServerSettingsUpdatedPayload,
);
const WsPushGitActionProgress = makeWsPushSchema(
  WS_CHANNELS.gitActionProgress,
  GitActionProgressEvent,
);
const WsPushGitWorktreeSetupProgress = makeWsPushSchema(
  WS_CHANNELS.gitWorktreeSetupProgress,
  GitWorktreeSetupProgressEvent,
);
const WsPushProjectProvisionProgress = makeWsPushSchema(
  WS_CHANNELS.projectProvisionProgress,
  GitHubProjectProvisionProgressEvent,
);
const WsPushTerminalEvent = makeWsPushSchema(WS_CHANNELS.terminalEvent, TerminalEvent);
const WsPushOrchestrationDomainEvent = makeWsPushSchema(
  ORCHESTRATION_WS_CHANNELS.domainEvent,
  OrchestrationEvent,
);
const WsPushOrchestrationShellEvent = makeWsPushSchema(
  ORCHESTRATION_WS_CHANNELS.shellEvent,
  OrchestrationShellStreamItem,
);
const WsPushOrchestrationThreadEvent = makeWsPushSchema(
  ORCHESTRATION_WS_CHANNELS.threadEvent,
  OrchestrationThreadStreamItem,
);

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
  WsPushOrchestrationDomainEvent,
  WsPushOrchestrationShellEvent,
  WsPushOrchestrationThreadEvent,
]);
export type WsPush = typeof WsPush.Type;

export type WsPushMessage<C extends WsPushChannel> = Extract<WsPush, { channel: C }>;
