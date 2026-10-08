import type { NativeThreadHistoryInput } from "../core/nativeThreadHistory.ts";
import type {
  ProviderManagementContext,
  ProviderListMcpServersResult,
  ProviderManageMcpServerInput,
  ProviderManagementResult,
  ProviderPluginInventoryResult,
  ProviderManagePluginInput,
} from "@glade/contracts/provider/providerManagement";
import type {
  ApprovalRequestId,
  ProviderKind,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import type {
  ProviderComposerCapabilities,
  ProviderListAgentsInput,
  ProviderListAgentsResult,
  ProviderListCommandsInput,
  ProviderListCommandsResult,
  ProviderListModelsInput,
  ProviderListModelsResult,
  ProviderListPluginsInput,
  ProviderListPluginsResult,
  ProviderReadPluginInput,
  ProviderReadPluginResult,
  ProviderListSkillsResult,
  ProviderListSkillsInput,
} from "@glade/contracts/provider/providerDiscovery";
import type {
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
} from "@glade/contracts/provider/sessionPolicy";
import type {
  ProviderForkThreadInput,
  ProviderForkThreadResult,
  ProviderStartReviewInput,
  ProviderSendTurnInput,
  ProviderSteerTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderTurnStartResult,
} from "@glade/contracts/provider/provider";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import type {
  ServerVoicePrewarmInput,
  ServerVoicePrewarmResult,
  ServerVoiceTranscriptionInput,
  ServerVoiceTranscriptionResult,
} from "@glade/contracts/server/server";
import type { Effect } from "effect";
import type { Stream } from "effect";

export const PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY = 2_048;

// Resolved once by the discovery service from settings, so adapters never guess the executable.
export interface ProviderDiscoveryRuntime {
  readonly binaryPath: string;
  // Changes when the executable, provider settings or signed-in account change.
  readonly identity: string;
}

export interface ProviderAdapterCapabilities {
  readonly supportsSkillMentions?: boolean;
  readonly supportsSkillDiscovery?: boolean;
  readonly supportsNativeSlashCommandDiscovery?: boolean;
  readonly supportsPluginMentions?: boolean;
  readonly supportsPluginDiscovery?: boolean;
  readonly supportsRuntimeModelList?: boolean;
  readonly supportsTurnSteering?: boolean;

  readonly supportsLiveTurnDiffPatch?: boolean;
}

export interface ProviderThreadTurnSnapshot {
  readonly id: TurnId;
  readonly items: ReadonlyArray<unknown>;
  readonly startedAt?: number | string;
  readonly completedAt?: number | string;
  readonly status?: string;
}

export interface ProviderThreadSnapshot {
  readonly threadId: ThreadId;
  readonly turns: ReadonlyArray<ProviderThreadTurnSnapshot>;
  readonly cwd?: string | null;
}

export interface ProviderAdapterShape<TError> {
  readonly provider: ProviderKind;
  readonly capabilities: ProviderAdapterCapabilities;
  readonly listMcpServers?: (
    input: ProviderManagementContext,
  ) => Effect.Effect<ProviderListMcpServersResult, TError>;
  readonly manageMcpServer?: (
    input: ProviderManageMcpServerInput,
  ) => Effect.Effect<ProviderManagementResult, TError>;
  readonly pluginInventory?: (
    input: ProviderManagementContext,
  ) => Effect.Effect<ProviderPluginInventoryResult, TError>;
  readonly managePlugin?: (
    input: ProviderManagePluginInput,
  ) => Effect.Effect<ProviderManagementResult, TError>;

  readonly startSession: (
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, TError>;

  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, TError>;

  readonly steerTurn?: (
    input: ProviderSteerTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, TError>;

  readonly startReview?: (
    input: ProviderStartReviewInput,
  ) => Effect.Effect<ProviderTurnStartResult, TError>;

  readonly interruptTurn: (
    threadId: ThreadId,
    turnId?: TurnId,
    providerThreadId?: string,
  ) => Effect.Effect<void, TError>;

  readonly stopTask?: (threadId: ThreadId, taskId: string) => Effect.Effect<void, TError>;

  readonly backgroundTask?: (threadId: ThreadId, toolUseId: string) => Effect.Effect<void, TError>;

  readonly respondToRequest: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Effect.Effect<void, TError>;

  readonly respondToUserInput: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) => Effect.Effect<void, TError>;

  readonly updateNativeHistory?: (input: NativeThreadHistoryInput) => Effect.Effect<void, TError>;

  readonly stopSession: (threadId: ThreadId) => Effect.Effect<void, TError>;

  /** False when a stored cursor holds no saved native conversation, so a start begins fresh. */
  readonly canResumeNativeConversation?: (resumeCursor: unknown) => boolean;

  readonly prepareSessionReplacement?: (input: ProviderSessionStartInput) => Effect.Effect<
    | {
        readonly previousSession: ProviderSession;
        readonly startSession: ProviderAdapterShape<TError>["startSession"];
      }
    | undefined,
    TError
  >;

  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  readonly hasSession: (threadId: ThreadId) => Effect.Effect<boolean>;

  readonly readThread: (threadId: ThreadId) => Effect.Effect<ProviderThreadSnapshot, TError>;

  readonly rollbackThread: (threadId: ThreadId, numTurns: number) => Effect.Effect<void, TError>;

  readonly compactThread?: (
    threadId: ThreadId,
    instructions?: string,
  ) => Effect.Effect<void, TError>;

  readonly forkThread?: (
    input: ProviderForkThreadInput,
  ) => Effect.Effect<ProviderForkThreadResult, TError>;

  readonly stopAll: () => Effect.Effect<void, TError>;

  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;

  readonly getComposerCapabilities?: () => Effect.Effect<ProviderComposerCapabilities, TError>;

  readonly listSkills?: (
    input: ProviderListSkillsInput,
    runtime: ProviderDiscoveryRuntime,
  ) => Effect.Effect<ProviderListSkillsResult, TError>;

  readonly listCommands?: (
    input: ProviderListCommandsInput,
  ) => Effect.Effect<ProviderListCommandsResult, TError>;

  readonly listPlugins?: (
    input: ProviderListPluginsInput,
  ) => Effect.Effect<ProviderListPluginsResult, TError>;

  readonly readPlugin?: (
    input: ProviderReadPluginInput,
  ) => Effect.Effect<ProviderReadPluginResult, TError>;

  readonly listModels?: (
    input: ProviderListModelsInput,
  ) => Effect.Effect<ProviderListModelsResult, TError>;

  readonly listAgents?: (
    input: ProviderListAgentsInput,
    runtime: ProviderDiscoveryRuntime,
  ) => Effect.Effect<ProviderListAgentsResult, TError>;

  readonly prewarmVoice?: (
    input: ServerVoicePrewarmInput,
  ) => Effect.Effect<ServerVoicePrewarmResult, TError>;

  readonly transcribeVoice?: (
    input: ServerVoiceTranscriptionInput,
  ) => Effect.Effect<ServerVoiceTranscriptionResult, TError>;
}
