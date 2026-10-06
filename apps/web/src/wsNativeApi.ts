import type {
  GladeAppOpenRequest,
  GladeAppOpenAck,
} from "@glade/contracts/provider/agentGatewayTools";
import { bindCommitGeneration } from "./lib/commitGenerationBinding";
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
} from "@glade/contracts/transport/auth/auth";
import type { ContextMenuItem, NativeApi } from "@glade/contracts/ipc/ipc";
import type {
  GitActionProgressEvent,
  GitWorktreeSetupProgressEvent,
} from "@glade/contracts/git/git";
import type { GitHubProjectProvisionProgressEvent } from "@glade/contracts/git/githubProjectProvisioning";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type {
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
} from "@glade/contracts/orchestration/snapshots";
import {
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
} from "@glade/contracts/orchestration/rpc";
import {
  type ServerProviderStatusesUpdatedPayload,
  type ServerLifecycleStreamEvent,
  type ServerSettingsUpdatedPayload,
  ServerVoiceTranscriptionResult,
  ServerConfigUpdatedPayload,
} from "@glade/contracts/server/server";
import type { TerminalEvent } from "@glade/contracts/terminal/terminal";
import { WS_CHANNELS, WS_METHODS, type WsWelcomePayload } from "@glade/contracts/transport/ws/ws";
import type { WsBootstrapNegotiateResult } from "@glade/contracts/transport/ws/wsCompatibility";
import {
  COMPUTER_WS_CHANNELS,
  COMPUTER_WS_METHODS,
  type ComputerEvent,
} from "@glade/contracts/computer/computer";
import { VOICE_TRANSCRIPTION_UPLOAD_ROUTE_PATH } from "@glade/shared/transport/binaryTransfer";
import { Option, Schema } from "effect";
import { showConfirmDialogFallback } from "./confirmDialogFallback";
import { showContextMenuFallback } from "./contextMenuFallback";
import { requireHttpExternalUrl } from "./lib/externalUrl";
import { withNativeMenuIcons } from "./lib/nativeMenuIcons";
import { isMacNavigatorPlatform } from "./lib/utils";
import { WsTransport } from "./wsTransport.implementation";
import type { WsThreadStreamFailure } from "./wsTransport.support";
import { emitWsCompatibilityIssue, emitWsTransportState } from "./wsTransportEvents";
import { resolveWsHttpUrl } from "./lib/wsHttpUrl";
import {
  createListenerRegistry,
  fallbackBrowserStateListeners,
  defaultBrowserTitle,
  createFallbackTab,
  cloneBrowserState,
  getFallbackBrowserState,
  emitFallbackBrowserState,
  markFallbackBrowserStateChanged,
  ensureFallbackBrowserWorkspace,
  resolveFallbackBrowserTab,
} from "./wsNativeApiBrowser";
let instance: { api: NativeApi; transport: WsTransport } | null = null;

export function readWsServerCapabilities(): ReadonlyArray<string> | null {
  return instance?.transport.getCompatibility()?.capabilities ?? null;
}

export function onWsServerCapabilitiesChange(
  listener: (capabilities: ReadonlyArray<string> | null) => void,
  options?: { readonly replayCurrent?: boolean },
): () => void {
  if (!instance) createWsNativeApi();
  const transport = instance?.transport;
  if (!transport) {
    if (options?.replayCurrent) listener(null);
    return () => undefined;
  }
  return transport.onCompatibilityChange(
    (compatibility: WsBootstrapNegotiateResult | null) =>
      listener(compatibility?.capabilities ?? null),
    options,
  );
}

function subscribeWithReplay<T>(input: {
  readonly registry: {
    subscribe: (listener: (payload: T) => void) => () => unknown;
  };
  readonly listener: (payload: T) => void;
  readonly latest: T | null;
}): () => void {
  const unsubscribe = input.registry.subscribe(input.listener);
  if (input.latest) {
    try {
      input.listener(input.latest);
    } catch {}
  }
  return () => void unsubscribe();
}

const welcomeListeners = createListenerRegistry<WsWelcomePayload>();
const serverConfigUpdatedListeners = createListenerRegistry<ServerConfigUpdatedPayload>();
const serverProviderStatusesUpdatedListeners =
  createListenerRegistry<ServerProviderStatusesUpdatedPayload>();
const serverMaintenanceUpdatedListeners = createListenerRegistry<ServerLifecycleStreamEvent>();
const serverSettingsUpdatedListeners = createListenerRegistry<ServerSettingsUpdatedPayload>();
const gitActionProgressListeners = createListenerRegistry<GitActionProgressEvent>();
const gitWorktreeSetupProgressListeners = createListenerRegistry<GitWorktreeSetupProgressEvent>();
const projectProvisionProgressListeners =
  createListenerRegistry<GitHubProjectProvisionProgressEvent>();

function omitNullUserInputAnswers(
  command: Parameters<NativeApi["orchestration"]["dispatchCommand"]>[0],
) {
  if (command.type !== "thread.user-input.respond") {
    return command;
  }

  return {
    ...command,
    answers: Object.fromEntries(
      Object.entries(command.answers).filter(
        ([, answer]) => answer !== null && answer !== undefined,
      ),
    ),
  };
}
const terminalEventListeners = createListenerRegistry<TerminalEvent>();
const computerEventListeners = createListenerRegistry<ComputerEvent>();
const orchestrationDomainEventListeners = createListenerRegistry<OrchestrationEvent>();
const orchestrationShellEventListeners = createListenerRegistry<OrchestrationShellStreamItem>();
const orchestrationThreadEventListeners = createListenerRegistry<OrchestrationThreadStreamItem>();
const threadStreamFailureListeners = createListenerRegistry<WsThreadStreamFailure>();

function clearWsNativeApiListeners(): void {
  welcomeListeners.clear();
  serverConfigUpdatedListeners.clear();
  serverProviderStatusesUpdatedListeners.clear();
  serverMaintenanceUpdatedListeners.clear();
  serverSettingsUpdatedListeners.clear();
  gitActionProgressListeners.clear();
  gitWorktreeSetupProgressListeners.clear();
  projectProvisionProgressListeners.clear();
  terminalEventListeners.clear();
  computerEventListeners.clear();
  orchestrationDomainEventListeners.clear();
  orchestrationShellEventListeners.clear();
  orchestrationThreadEventListeners.clear();
  threadStreamFailureListeners.clear();
  fallbackBrowserStateListeners.clear();
}

async function requestAuthJson<T>(
  path: string,
  options: {
    readonly method?: "GET" | "POST";
    readonly body?: unknown;
  } = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    ...(hasBody
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        }
      : {}),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Auth request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

const decodeVoiceTranscriptionResult = Schema.decodeUnknownOption(ServerVoiceTranscriptionResult);

async function requestVoiceTranscriptionUpload(
  input: Parameters<NativeApi["server"]["transcribeVoice"]>[0],
) {
  const params = new URLSearchParams({
    provider: input.provider,
    cwd: input.cwd,
    mimeType: input.mimeType,
    sampleRateHz: String(input.sampleRateHz),
    durationMs: String(input.durationMs),
    ...(input.threadId ? { threadId: input.threadId } : {}),
  });
  const decoded = atob(input.audioBase64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  const response = await fetch(
    resolveWsHttpUrl(`${VOICE_TRANSCRIPTION_UPLOAD_ROUTE_PATH}?${params.toString()}`),
    { method: "POST", credentials: "include", body: bytes },
  );
  if (response.status === 404 || response.status === 405) {
    void response.body?.cancel().catch(() => undefined);
    throw new VoiceUploadRouteUnavailableError();
  }
  const payload: unknown = await response.json().catch(() => null);
  const result = response.ok ? decodeVoiceTranscriptionResult(payload) : Option.none();
  if (Option.isNone(result)) {
    const message =
      payload !== null &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : response.ok
          ? "The voice transcription service returned an invalid response. Please try again."
          : `Voice transcription failed with status ${response.status}.`;
    throw new Error(message);
  }
  return result.value;
}

class VoiceUploadRouteUnavailableError extends Error {}

// If a welcome was already received before this call, the listener fires synchronously with the
// cached payload. This avoids the race between WebSocket connect and React effect registration.
export function onServerWelcome(listener: (payload: WsWelcomePayload) => void): () => void {
  const latestWelcome = instance?.transport.getLatestPush(WS_CHANNELS.serverWelcome)?.data ?? null;
  return subscribeWithReplay({ registry: welcomeListeners, listener, latest: latestWelcome });
}

export function onServerConfigUpdated(
  listener: (payload: ServerConfigUpdatedPayload) => void,
): () => void {
  const latestConfig =
    instance?.transport.getLatestPush(WS_CHANNELS.serverConfigUpdated)?.data ?? null;
  return subscribeWithReplay({
    registry: serverConfigUpdatedListeners,
    listener,
    latest: latestConfig,
  });
}

export function onServerProviderStatusesUpdated(
  listener: (payload: ServerProviderStatusesUpdatedPayload) => void,
): () => void {
  const latestProviderStatuses =
    instance?.transport.getLatestPush(WS_CHANNELS.serverProviderStatusesUpdated)?.data ?? null;
  return subscribeWithReplay({
    registry: serverProviderStatusesUpdatedListeners,
    listener,
    latest: latestProviderStatuses,
  });
}

export function onServerMaintenanceUpdated(
  listener: (payload: ServerLifecycleStreamEvent) => void,
): () => void {
  const latestMaintenance =
    instance?.transport.getLatestPush(WS_CHANNELS.serverMaintenanceUpdated)?.data ?? null;
  return subscribeWithReplay({
    registry: serverMaintenanceUpdatedListeners,
    listener,
    latest: latestMaintenance,
  });
}

export function onServerSettingsUpdated(
  listener: (payload: ServerSettingsUpdatedPayload) => void,
): () => void {
  const latestSettings =
    instance?.transport.getLatestPush(WS_CHANNELS.serverSettingsUpdated)?.data ?? null;
  return subscribeWithReplay({
    registry: serverSettingsUpdatedListeners,
    listener,
    latest: latestSettings,
  });
}

export function onThreadStreamFailure(
  listener: (failure: WsThreadStreamFailure) => void,
): () => void {
  const unsubscribe = threadStreamFailureListeners.subscribe(listener);
  return () => void unsubscribe();
}

export function createWsNativeApi(): NativeApi {
  if (instance) {
    if (instance.transport.getState() !== "disposed") {
      return instance.api;
    }
    instance = null;
  }

  const transport = new WsTransport();
  const commitGeneration = bindCommitGeneration({
    generateCommitMessage: (input) =>
      transport.request(WS_METHODS.gitGenerateCommitMessage, input, { timeoutMs: null }),
    commitStaged: (input) =>
      transport.request(WS_METHODS.gitCommitStaged, input, { timeoutMs: null }),
  });
  let unsubscribeDomainEventTransport: (() => void) | null = null;
  transport.onStateChange((state) => emitWsTransportState(state));
  transport.onCompatibilityIssue((issue) => emitWsCompatibilityIssue(issue), {
    replayCurrent: true,
  });

  transport.subscribe(WS_CHANNELS.serverWelcome, (message) => {
    welcomeListeners.emit(message.data);
  });
  transport.subscribe(WS_CHANNELS.serverConfigUpdated, (message) => {
    serverConfigUpdatedListeners.emit(message.data);
  });
  transport.subscribe(WS_CHANNELS.serverProviderStatusesUpdated, (message) => {
    serverProviderStatusesUpdatedListeners.emit(message.data);
  });
  transport.subscribe(WS_CHANNELS.serverMaintenanceUpdated, (message) => {
    serverMaintenanceUpdatedListeners.emit(message.data);
  });
  transport.subscribe(WS_CHANNELS.serverSettingsUpdated, (message) => {
    serverSettingsUpdatedListeners.emit(message.data);
  });
  transport.subscribe(WS_CHANNELS.gitActionProgress, (message) => {
    gitActionProgressListeners.emit(message.data);
  });
  transport.subscribe(WS_CHANNELS.gitWorktreeSetupProgress, (message) => {
    gitWorktreeSetupProgressListeners.emit(message.data);
  });
  transport.subscribe(WS_CHANNELS.projectProvisionProgress, (message) => {
    projectProvisionProgressListeners.emit(message.data);
  });
  transport.subscribe(WS_CHANNELS.terminalEvent, (message) => {
    terminalEventListeners.emit(message.data);
  });
  transport.subscribe(COMPUTER_WS_CHANNELS.event, (message) => {
    computerEventListeners.emit(message.data);
  });
  transport.subscribe(ORCHESTRATION_WS_CHANNELS.shellEvent, (message) => {
    orchestrationShellEventListeners.emit(message.data);
  });
  transport.subscribe(ORCHESTRATION_WS_CHANNELS.threadEvent, (message) => {
    orchestrationThreadEventListeners.emit(message.data);
  });
  transport.onThreadStreamFailure((failure) => {
    threadStreamFailureListeners.emit(failure);
  });
  const api: NativeApi = {
    dialogs: {
      pickFolder: async () => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFolder();
      },
      saveFile: async (input) => {
        if (window.desktopBridge?.saveFile) {
          return window.desktopBridge.saveFile(input);
        }
        const blob = new Blob([input.contents], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        try {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = input.defaultFilename;
          anchor.click();
        } finally {
          URL.revokeObjectURL(url);
        }
        return null;
      },
      confirm: async (message) => {
        return showConfirmDialogFallback(message);
      },
    },
    terminal: {
      open: (input) => transport.request(WS_METHODS.terminalOpen, input),
      write: (input) => transport.request(WS_METHODS.terminalWrite, input),
      ackOutput: (input) => transport.request(WS_METHODS.terminalAckOutput, input),
      resize: (input) => transport.request(WS_METHODS.terminalResize, input),
      clear: (input) => transport.request(WS_METHODS.terminalClear, input),
      restart: (input) => transport.request(WS_METHODS.terminalRestart, input),
      close: (input) => transport.request(WS_METHODS.terminalClose, input),
      onEvent: terminalEventListeners.subscribe,
    },
    projects: {
      listDirectories: (input) => transport.request(WS_METHODS.projectsListDirectories, input),
      searchEntries: (input) => transport.request(WS_METHODS.projectsSearchEntries, input),
      searchLocalEntries: (input) =>
        transport.request(WS_METHODS.projectsSearchLocalEntries, input),
      searchContent: (input, options) =>
        transport.request(WS_METHODS.projectsSearchContent, input, options),
      prewarmSearchIndex: (input) =>
        transport.request(WS_METHODS.projectsPrewarmSearchIndex, input),
      readFile: (input, options) =>
        options?.signal
          ? transport.request(WS_METHODS.projectsReadFile, input, { signal: options.signal })
          : transport.request(WS_METHODS.projectsReadFile, input),
      onFileChange: (input, callback) => transport.subscribeProjectFileChange(input, callback),
      resolveWorkspaceFileReferences: (input) =>
        transport.request(WS_METHODS.projectsResolveWorkspaceFileReferences, input),
      resolveOutOfRootFileReference: (input) =>
        transport.request(WS_METHODS.projectsResolveOutOfRootFileReference, input),
      createLocalFilePreviewGrant: (input) =>
        transport.request(WS_METHODS.projectsCreateLocalFilePreviewGrant, input),
      writeFile: (input) => transport.request(WS_METHODS.projectsWriteFile, input),
      manageEntry: (input) => transport.request(WS_METHODS.projectsManageEntry, input),
      provisionFromGitHub: (input, options) =>
        transport.request(WS_METHODS.projectsProvisionFromGitHub, input, {
          timeoutMs: null,
          ...(options?.signal ? { signal: options.signal } : {}),
        }),
      onProvisionProgress: projectProvisionProgressListeners.subscribe,
    },
    filesystem: {
      browse: (input) => transport.request(WS_METHODS.filesystemBrowse, input),
    },
    shell: {
      openInEditor: (cwd, editor) =>
        transport.request(WS_METHODS.shellOpenInEditor, { cwd, editor }),
      openExternal: async (url) => {
        const externalUrl = requireHttpExternalUrl(url);
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(externalUrl);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        window.open(externalUrl, "_blank", "noopener,noreferrer");
      },
      showInFolder: async (path) => {
        if (window.desktopBridge) {
          await window.desktopBridge.showInFolder(path);
        }
      },
    },
    git: {
      githubRepository: (input) => transport.request(WS_METHODS.gitGithubRepository, input),
      pull: (input) => transport.request(WS_METHODS.gitPull, input),
      status: (input) => transport.request(WS_METHODS.gitStatus, input),
      sidebarSummary: (input) => transport.request(WS_METHODS.gitSidebarSummary, input),
      onStatus: (input, callback) => transport.subscribeGitStatus(input, callback),
      readWorkingTreeDiff: (input) => transport.request(WS_METHODS.gitReadWorkingTreeDiff, input),
      readSourceControlFiles: (input, options) =>
        transport.request(WS_METHODS.gitReadSourceControlFiles, input, options),
      readFileAtRev: (input, options) =>
        transport.request(WS_METHODS.gitReadFileAtRev, input, options),
      workingTreeDiffStats: (input) => transport.request(WS_METHODS.gitWorkingTreeDiffStats, input),
      blameLine: (input) => transport.request(WS_METHODS.gitBlameLine, input),
      generateCommitMessage: commitGeneration.generateCommitMessage,
      summarizeDiff: (input) =>
        transport.request(WS_METHODS.gitSummarizeDiff, input, {
          timeoutMs: null,
        }),
      runStackedAction: (input) =>
        transport.request(WS_METHODS.gitRunStackedAction, input, {
          timeoutMs: null,
        }),
      listBranches: (input) => transport.request(WS_METHODS.gitListBranches, input),
      listRecentCommits: (input) => transport.request(WS_METHODS.gitListRecentCommits, input),
      readCommit: (input) => transport.request(WS_METHODS.gitReadCommit, input),
      createWorktree: (input) => transport.request(WS_METHODS.gitCreateWorktree, input),

      createDetachedWorktree: (input) =>
        transport.request(WS_METHODS.gitCreateDetachedWorktree, input, {
          timeoutMs: null,
        }),
      removeWorktree: (input) => transport.request(WS_METHODS.gitRemoveWorktree, input),
      createBranch: (input) => transport.request(WS_METHODS.gitCreateBranch, input),
      checkout: (input) => transport.request(WS_METHODS.gitCheckout, input),
      stashAndCheckout: (input) => transport.request(WS_METHODS.gitStashAndCheckout, input),
      stashDrop: (input) => transport.request(WS_METHODS.gitStashDrop, input),
      stashInfo: (input) => transport.request(WS_METHODS.gitStashInfo, input),
      removeIndexLock: (input) => transport.request(WS_METHODS.gitRemoveIndexLock, input),
      init: (input) => transport.request(WS_METHODS.gitInit, input),
      publishContext: (input) => transport.request(WS_METHODS.gitPublishContext, input),
      publishRepository: (input) =>
        transport.request(WS_METHODS.gitPublishRepository, input, { timeoutMs: null }),
      stageFiles: (input) => transport.request(WS_METHODS.gitStageFiles, input),
      commitStaged: commitGeneration.commitStaged,
      fetch: (input) => transport.request(WS_METHODS.gitFetch, input, { timeoutMs: null }),
      ignorePaths: (input) =>
        transport.request(WS_METHODS.gitIgnorePaths, input, { timeoutMs: null }),
      rebase: (input) => transport.request(WS_METHODS.gitRebase, input, { timeoutMs: null }),
      checkUndoCommit: (input) =>
        transport.request(WS_METHODS.gitCheckUndoCommit, input, { timeoutMs: null }),
      undoCommit: (input) =>
        transport.request(WS_METHODS.gitUndoCommit, input, { timeoutMs: null }),
      rebaseState: (input) => transport.request(WS_METHODS.gitRebaseState, input),
      revertUnstagedFile: (input) => transport.request(WS_METHODS.gitRevertUnstagedFile, input),
      unstageFiles: (input) => transport.request(WS_METHODS.gitUnstageFiles, input),
      handoffThread: (input) => transport.request(WS_METHODS.gitHandoffThread, input),
      resolvePullRequest: (input) => transport.request(WS_METHODS.gitResolvePullRequest, input),
      preparePullRequestThread: (input) =>
        transport.request(WS_METHODS.gitPreparePullRequestThread, input),
      onActionProgress: gitActionProgressListeners.subscribe,
      onWorktreeSetupProgress: gitWorktreeSetupProgressListeners.subscribe,
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        if (window.desktopBridge) {
          const desktopItems = isMacNavigatorPlatform() ? await withNativeMenuIcons(items) : items;
          return window.desktopBridge.showContextMenu(desktopItems, position);
        }
        return showContextMenuFallback(items, position);
      },
    },
    server: {
      getConfig: () => transport.request(WS_METHODS.serverGetConfig),
      getEnvironment: () => transport.request(WS_METHODS.serverGetEnvironment),
      getSettings: () => transport.request(WS_METHODS.serverGetSettings),
      updateSettings: (input) => transport.request(WS_METHODS.serverUpdateSettings, input),
      getAuthSession: () => requestAuthJson<AuthSessionState>("/api/auth/session"),
      bootstrapAuth: (input: AuthBootstrapInput) =>
        requestAuthJson<AuthBootstrapResult>("/api/auth/bootstrap", {
          method: "POST",
          body: input,
        }),
      bootstrapBearerAuth: (input: AuthBootstrapInput) =>
        requestAuthJson<AuthBearerBootstrapResult>("/api/auth/bootstrap/bearer", {
          method: "POST",
          body: input,
        }),
      issueAuthWebSocketToken: () =>
        requestAuthJson<AuthWebSocketTokenResult>("/api/auth/ws-token", { method: "POST" }),
      createAuthPairingToken: (input?: AuthCreatePairingCredentialInput) =>
        requestAuthJson<AuthPairingCredentialResult>("/api/auth/pairing-token", {
          method: "POST",
          ...(input ? { body: input } : {}),
        }),
      listAuthPairingLinks: () =>
        requestAuthJson<ReadonlyArray<AuthPairingLink>>("/api/auth/pairing-links"),
      revokeAuthPairingLink: (input: AuthRevokePairingLinkInput) =>
        requestAuthJson<{ revoked: boolean }>("/api/auth/pairing-links/revoke", {
          method: "POST",
          body: input,
        }),
      listAuthClients: () => requestAuthJson<ReadonlyArray<AuthClientSession>>("/api/auth/clients"),
      revokeAuthClient: (input: AuthRevokeClientSessionInput) =>
        requestAuthJson<{ revoked: boolean }>("/api/auth/clients/revoke", {
          method: "POST",
          body: input,
        }),
      revokeOtherAuthClients: () =>
        requestAuthJson<{ revokedCount: number }>("/api/auth/clients/revoke-others", {
          method: "POST",
        }),
      logoutAuthSession: async () => {
        const result = await requestAuthJson<AuthLogoutResult>("/api/auth/logout", {
          method: "POST",
        });
        await transport.dispose();
        return result;
      },

      refreshProviders: () =>
        transport.request(WS_METHODS.serverRefreshProviders, undefined, { timeoutMs: 180_000 }),

      updateProvider: (input) =>
        transport.request(WS_METHODS.serverUpdateProvider, input, { timeoutMs: null }),
      listWorktrees: () => transport.request(WS_METHODS.serverListWorktrees),
      listLocalServers: () => transport.request(WS_METHODS.serverListLocalServers),
      stopLocalServer: (input) => transport.request(WS_METHODS.serverStopLocalServer, input),
      getProviderUsageSnapshot: (input) =>
        transport.request(WS_METHODS.serverGetProviderUsageSnapshot, input),
      listProviderUsage: (input) => transport.request(WS_METHODS.serverListProviderUsage, input),
      consumeCodexResetCredit: (input) =>
        transport.request(WS_METHODS.serverConsumeCodexResetCredit, input),
      getDiagnostics: () => transport.request(WS_METHODS.serverGetDiagnostics),
      readThreadDiagnostics: (input) =>
        transport.request(WS_METHODS.serverReadThreadDiagnostics, input),
      prewarmVoice: (input) => transport.request(WS_METHODS.serverPrewarmVoice, input),
      transcribeVoice: async (input) => {
        try {
          return await requestVoiceTranscriptionUpload(input);
        } catch (error) {
          if (!(error instanceof VoiceUploadRouteUnavailableError)) {
            throw error;
          }
          return transport.request(WS_METHODS.serverTranscribeVoice, input, { timeoutMs: null });
        }
      },
      upsertKeybinding: (input) => transport.request(WS_METHODS.serverUpsertKeybinding, input),
    },
    stats: {
      getProfileStats: (input) => transport.request(WS_METHODS.statsGetProfileStats, input),
      getProfileTokenStats: (input) =>
        transport.request(WS_METHODS.statsGetProfileTokenStats, input),
    },
    provider: {
      getComposerCapabilities: (input) =>
        transport.request(WS_METHODS.providerGetComposerCapabilities, input),

      listCommands: (input) => transport.request(WS_METHODS.providerListCommands, input),
      listSkills: (input) => transport.request(WS_METHODS.providerListSkills, input),
      listSkillsCatalog: (input) => transport.request(WS_METHODS.providerListSkillsCatalog, input),
      listPlugins: (input) => transport.request(WS_METHODS.providerListPlugins, input),
      listMcpServers: (input) => transport.request(WS_METHODS.providerListMcpServers, input),
      manageMcpServer: (input) => transport.request(WS_METHODS.providerManageMcpServer, input),
      pluginInventory: (input) => transport.request(WS_METHODS.providerPluginInventory, input),
      managePlugin: (input) => transport.request(WS_METHODS.providerManagePlugin, input),

      readPlugin: (input) => transport.request(WS_METHODS.providerReadPlugin, input),
      listModels: (input) => transport.request(WS_METHODS.providerListModels, input),
      listAgents: (input) => transport.request(WS_METHODS.providerListAgents, input),
    },
    orchestration: {
      getSnapshot: () => transport.request(ORCHESTRATION_WS_METHODS.getSnapshot),
      getShellSnapshot: () => transport.request(ORCHESTRATION_WS_METHODS.getShellSnapshot),
      getThreadDetailSnapshot: (input) =>
        transport.request(ORCHESTRATION_WS_METHODS.getThreadDetailSnapshot, input),
      prepareHandoff: (input) =>
        transport.request(ORCHESTRATION_WS_METHODS.prepareHandoff, input, { timeoutMs: null }),
      dispatchCommand: (command) => {
        const payload = { command: omitNullUserInputAnswers(command) };
        return command.type === "thread.turn.start"
          ? transport.dispatchTurn(command)
          : transport.request(ORCHESTRATION_WS_METHODS.dispatchCommand, payload);
      },
      repairState: () => transport.request(ORCHESTRATION_WS_METHODS.repairState),
      previewWorkspaceRestore: (input) =>
        transport.request(ORCHESTRATION_WS_METHODS.previewWorkspaceRestore, input),
      getTurnDiff: (input) => transport.request(ORCHESTRATION_WS_METHODS.getTurnDiff, input),
      getFullThreadDiff: (input) =>
        transport.request(ORCHESTRATION_WS_METHODS.getFullThreadDiff, input),
      replayEvents: (fromSequenceExclusive, threadId) =>
        transport.request(ORCHESTRATION_WS_METHODS.replayEvents, {
          fromSequenceExclusive,
          ...(threadId === undefined ? {} : { threadId }),
        }),
      listProviderDeliveryBlockers: (input = {}) =>
        transport.request(ORCHESTRATION_WS_METHODS.listProviderDeliveryBlockers, input),
      reconcileProviderDelivery: (input) =>
        transport.request(ORCHESTRATION_WS_METHODS.reconcileProviderDelivery, input),
      prepareQuitResume: (input) =>
        transport.request(ORCHESTRATION_WS_METHODS.prepareQuitResume, input),
      subscribeShell: () => transport.request<void>(ORCHESTRATION_WS_METHODS.subscribeShell, {}),
      unsubscribeShell: () =>
        transport.request<void>(ORCHESTRATION_WS_METHODS.unsubscribeShell, {}),
      subscribeThread: (input) =>
        transport.request<void>(ORCHESTRATION_WS_METHODS.subscribeThread, input),
      unsubscribeThread: (input) =>
        transport.request<void>(ORCHESTRATION_WS_METHODS.unsubscribeThread, input),
      onDomainEvent: (callback) => {
        const shouldStartTransport = orchestrationDomainEventListeners.size === 0;
        const unsubscribe = orchestrationDomainEventListeners.subscribe(callback);
        if (shouldStartTransport) {
          unsubscribeDomainEventTransport = transport.subscribe(
            ORCHESTRATION_WS_CHANNELS.domainEvent,
            (message) => orchestrationDomainEventListeners.emit(message.data),
          );
        }
        return () => {
          unsubscribe();
          if (orchestrationDomainEventListeners.size === 0) {
            unsubscribeDomainEventTransport?.();
            unsubscribeDomainEventTransport = null;
          }
        };
      },
      onShellEvent: orchestrationShellEventListeners.subscribe,
      onThreadEvent: orchestrationThreadEventListeners.subscribe,
    },
    computer: {
      getStatus: (input) => transport.request(COMPUTER_WS_METHODS.getStatus, input),
      getAuditHistory: (input) => transport.request(COMPUTER_WS_METHODS.getAuditHistory, input),
      getState: (input) => transport.request(COMPUTER_WS_METHODS.getState, input),
      provision: (input) =>
        transport.request(COMPUTER_WS_METHODS.provision, input, { timeoutMs: null }),
      getThreadState: (input) => transport.request(COMPUTER_WS_METHODS.getThreadState, input),
      setControlEnabled: (input) => transport.request(COMPUTER_WS_METHODS.setControlEnabled, input),
      inputClick: (input) => transport.request(COMPUTER_WS_METHODS.inputClick, input),
      inputScroll: (input) => transport.request(COMPUTER_WS_METHODS.inputScroll, input),
      inputKey: (input) => transport.request(COMPUTER_WS_METHODS.inputKey, input),
      onEvent: computerEventListeners.subscribe,
    },
    browser: {
      ...(window.desktopBridge?.browser?.vault
        ? { vault: window.desktopBridge.browser.vault }
        : {}),
      open: async (input) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.open(input);
        }
        const state = ensureFallbackBrowserWorkspace(input.threadId);
        if (input.initialUrl && state.tabs.length > 0) {
          const activeTab = resolveFallbackBrowserTab(state);
          activeTab.url = input.initialUrl;
          activeTab.title = defaultBrowserTitle(input.initialUrl);
          activeTab.lastCommittedUrl = input.initialUrl;
        }
        markFallbackBrowserStateChanged(state);
        return emitFallbackBrowserState(input.threadId);
      },
      close: async (input) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.close(input);
        }
        const state = getFallbackBrowserState(input.threadId);
        state.open = false;
        state.activeTabId = null;
        state.tabs = [];
        state.lastError = null;
        markFallbackBrowserStateChanged(state);
        return emitFallbackBrowserState(input.threadId);
      },
      hide: async (input) => {
        if (window.desktopBridge) {
          await window.desktopBridge.browser.hide(input);
        }
      },
      getState: async (input) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.getState(input);
        }
        return cloneBrowserState(getFallbackBrowserState(input.threadId));
      },
      setPanelBounds: async (input) => {
        if (window.desktopBridge) {
          await window.desktopBridge.browser.setPanelBounds(input);
          return;
        }
      },
      attachWebview: async (input) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.attachWebview(input);
        }
        return cloneBrowserState(getFallbackBrowserState(input.threadId));
      },
      detachWebview: async (input) => {
        if (window.desktopBridge) {
          await window.desktopBridge.browser.detachWebview(input);
        }
      },
      copyLink: async (input) => {
        if (window.desktopBridge) {
          await window.desktopBridge.browser.copyLink(input);
          return;
        }
        throw new Error("Copying the browser link requires the desktop app.");
      },
      copyScreenshotToClipboard: async (input) => {
        if (window.desktopBridge) {
          await window.desktopBridge.browser.copyScreenshotToClipboard(input);
          return;
        }
        throw new Error("Browser screenshots require the desktop app.");
      },
      captureScreenshot: async (input) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.captureScreenshot(input);
        }
        throw new Error("Browser screenshots require the desktop app.");
      },
      capturePreview: async (input) => window.desktopBridge?.browser.capturePreview(input) ?? null,
      navigate: async (input) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.navigate(input);
        }
        const state = ensureFallbackBrowserWorkspace(input.threadId);
        const tab = resolveFallbackBrowserTab(state, input.tabId);
        tab.url = input.url;
        tab.title = defaultBrowserTitle(input.url);
        tab.lastCommittedUrl = input.url;
        tab.lastError = null;
        tab.status = "live";
        state.activeTabId = tab.id;
        markFallbackBrowserStateChanged(state);
        return emitFallbackBrowserState(input.threadId);
      },
      reload: async (input) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.reload(input);
        }
        return cloneBrowserState(getFallbackBrowserState(input.threadId));
      },
      goBack: async (input) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.goBack(input);
        }
        return cloneBrowserState(getFallbackBrowserState(input.threadId));
      },
      goForward: async (input) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.goForward(input);
        }
        return cloneBrowserState(getFallbackBrowserState(input.threadId));
      },
      newTab: async (input) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.newTab(input);
        }
        const state = ensureFallbackBrowserWorkspace(input.threadId);
        const tab = createFallbackTab(input.url);
        state.tabs = [...state.tabs, tab];
        if (input.activate !== false || !state.activeTabId) {
          state.activeTabId = tab.id;
        }
        markFallbackBrowserStateChanged(state);
        return emitFallbackBrowserState(input.threadId);
      },
      closeTab: async (input) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.closeTab(input);
        }
        const state = ensureFallbackBrowserWorkspace(input.threadId);
        const nextTabs = state.tabs.filter((tab) => tab.id !== input.tabId);
        if (nextTabs.length === state.tabs.length) {
          return cloneBrowserState(state);
        }
        state.tabs = nextTabs;
        if (nextTabs.length === 0) {
          state.open = false;
          state.activeTabId = null;
          state.lastError = null;
        } else if (!state.tabs.some((tab) => tab.id === state.activeTabId)) {
          state.activeTabId = state.tabs[0]?.id ?? null;
        }
        markFallbackBrowserStateChanged(state);
        return emitFallbackBrowserState(input.threadId);
      },
      selectTab: async (input) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.selectTab(input);
        }
        const state = ensureFallbackBrowserWorkspace(input.threadId);
        const tab = resolveFallbackBrowserTab(state, input.tabId);
        state.activeTabId = tab.id;
        markFallbackBrowserStateChanged(state);
        return emitFallbackBrowserState(input.threadId);
      },
      openDevTools: async (input) => {
        if (window.desktopBridge) {
          await window.desktopBridge.browser.openDevTools(input);
        }
      },
      annotations: {
        start: async (input) => {
          if (window.desktopBridge) {
            return window.desktopBridge.browser.annotations.start(input);
          }
          throw new Error("Browser annotations require the desktop app.");
        },
        cancel: async (input) => {
          if (window.desktopBridge) {
            await window.desktopBridge.browser.annotations.cancel(input);
            return;
          }
          throw new Error("Browser annotations require the desktop app.");
        },
        syncMarkers: async (input) => {
          if (window.desktopBridge) {
            await window.desktopBridge.browser.annotations.syncMarkers(input);
            return;
          }
          throw new Error("Browser annotations require the desktop app.");
        },
        onEvent: (callback) => {
          if (window.desktopBridge) {
            return window.desktopBridge.browser.annotations.onEvent(callback);
          }
          return () => {};
        },
      },
      onState: (callback) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.onState(callback);
        }
        return fallbackBrowserStateListeners.subscribe(callback);
      },
      onCopyLink: (callback) => {
        if (window.desktopBridge) {
          return window.desktopBridge.browser.onBrowserCopyLink(callback);
        }
        return () => {};
      },
    },
  };

  instance = { api, transport };
  return api;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void instance?.transport.dispose();
    instance = null;
    clearWsNativeApiListeners();
  });
}

export function onAppPresentation(listener: (request: GladeAppOpenRequest) => void): () => void {
  if (!instance) createWsNativeApi();
  return instance!.transport.subscribe(WS_CHANNELS.appPresentation, (message) =>
    listener(message.data),
  );
}
export async function acknowledgeAppPresentation(input: GladeAppOpenAck): Promise<boolean> {
  if (!instance) createWsNativeApi();
  return instance!.transport.request(WS_METHODS.acknowledgeAppPresentation, input);
}
