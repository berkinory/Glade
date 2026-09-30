import {
  type RuntimeContentStreamKind,
  type CanonicalRequestType,
  type CanonicalItemType,
} from "@glade/contracts/provider/runtimeMetadata";
import type {
  SDKUserMessage,
  SDKAssistantMessageError,
  PermissionUpdate,
  SDKMessage,
  PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import { ClaudeCacheObservation } from "@glade/contracts/provider/claudeCache";
import { ThreadId, TurnId, ApprovalRequestId } from "@glade/contracts/core/baseSchemas";
import { type ClaudeTrackedTask } from "../claudeTaskTracker.ts";
import {
  type ProviderInteractionMode,
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
} from "@glade/contracts/provider/sessionPolicy";
import { Deferred, Queue, Fiber } from "effect";
import {
  type UserInputQuestion,
  type ThreadTokenUsageSnapshot,
} from "@glade/contracts/provider/runtimePayloads";
import { type ClaudeResultUsageBaseline } from "../claudeResultUsage.ts";
import { type AgentGatewaySessionLease } from "../../../agentGateway/sessionLease.ts";
import { type ProviderSession } from "@glade/contracts/provider/provider";
import { type ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import { ProviderAdapterProcessError } from "../../core/Errors.ts";
import { type ClaudeApiEffort } from "@glade/contracts/provider/model";
import { ClaudeRequestUsage } from "../claudeRequestUsage.ts";
import { type ClaudeWorkflowRuntimeState } from "../claudeWorkflowRuntime.ts";
import { ClaudeQueryRuntime, ClaudeProcessOwner } from "./adapterConfiguration";

export const PROVIDER = "claudeAgent" as const;

export type ClaudeTextStreamKind = Extract<
  RuntimeContentStreamKind,
  "assistant_text" | "reasoning_text"
>;

export type ClaudeToolResultStreamKind = Extract<
  RuntimeContentStreamKind,
  "command_output" | "file_change_output"
>;

export type PromptQueueItem =
  | {
      readonly type: "message";
      readonly message: SDKUserMessage;
    }
  | {
      readonly type: "terminate";
    };

export interface ClaudeResumeState {
  readonly claudeCache?: ClaudeCacheObservation;
  readonly threadId?: ThreadId;
  readonly resume?: string;
  readonly resumeSessionAt?: string;
  readonly turnCount?: number;
  readonly trackedTasks?: ReadonlyArray<ClaudeTrackedTask>;
  readonly processedTokenTotal?: number;
  readonly tokenAccountingVersion?: 1;
}

export interface ClaudeTurnState {
  readonly turnId: TurnId;
  readonly startedAt: string;
  readonly interactionMode: ProviderInteractionMode;

  readonly synthetic?: true;
  readonly explicitCompaction?: { readonly nativeSessionId: string; boundaryObserved: boolean };

  compactionInProgress?: boolean;
  readonly items: Array<unknown>;
  readonly assistantTextBlocks: Map<number, AssistantTextBlockState>;
  readonly assistantTextBlockOrder: Array<AssistantTextBlockState>;
  readonly capturedProposedPlanKeys: Set<string>;
  readonly sawFileChange: boolean;
  readonly assistantError?: {
    readonly code: SDKAssistantMessageError;
    readonly message: string;
  };
  nextSyntheticAssistantBlockIndex: number;

  assistantMessageBlockBase: number;
}

export interface AssistantTextBlockState {
  readonly itemId: string;
  readonly blockIndex: number;
  emittedTextDelta: boolean;
  fallbackText: string;
  streamClosed: boolean;
  completionEmitted: boolean;
}

export interface PendingApproval {
  readonly requestType: CanonicalRequestType;
  readonly detail?: string;
  readonly suggestions?: ReadonlyArray<PermissionUpdate>;
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
  readonly settled: Deferred.Deferred<ProviderApprovalDecision>;
  readonly turnId?: TurnId;
  readonly providerItemId?: string;
  readonly agentId?: string;
  settlementStarted: boolean;
}

export interface PendingUserInputResult {
  readonly answers: ProviderUserInputAnswers;
  readonly cancelled: boolean;
}

export interface PendingUserInput {
  readonly questions: ReadonlyArray<UserInputQuestion>;
  readonly result: Deferred.Deferred<PendingUserInputResult>;
  readonly settled: Deferred.Deferred<PendingUserInputResult>;
  readonly turnId?: TurnId;
  readonly providerItemId?: string;
  readonly agentId?: string;
  settlementStarted: boolean;
}

export interface ToolInFlight {
  readonly itemId: string;
  readonly itemType: CanonicalItemType;
  readonly toolName: string;
  readonly title: string;
  readonly detail?: string;
  readonly input: Record<string, unknown>;
  readonly partialInputJson: string;
  readonly lastEmittedInputFingerprint?: string;
}

export interface ClaudeSubagentRun {
  readonly gatewayParentTurnId: string | undefined;
  readonly toolUseId: string;
  taskId: string | undefined;
  readonly context: ClaudeSessionContext;
}

type ClaudeTokenUsageState = "current" | "skip-compaction-call" | "awaiting-fresh-assistant";

export interface ClaudeSessionIdentity {
  readonly gatewaySessionLease?: AgentGatewaySessionLease;
  session: ProviderSession;
  readonly startInput: Parameters<ClaudeAdapterShape["startSession"]>[0];
  readonly lifecycleGeneration?: string;
  readonly startedAt: string;
  resumeSessionId: string | undefined;
  lastThreadStartedId: string | undefined;
  stopped: boolean;
}

export interface ClaudeSessionQuery {
  readonly promptQueue: Queue.Queue<PromptQueueItem>;
  readonly query: ClaudeQueryRuntime;
  readonly artifactsEnabled: boolean;
  initToolNames?: ReadonlySet<string>;
  readonly messageStream?: AsyncIterable<SDKMessage>;
  readonly processOwner: ClaudeProcessOwner;
  stopDeferred?: Deferred.Deferred<void, ProviderAdapterProcessError>;
  streamFiber: Fiber.Fiber<void, Error> | undefined;
  readonly basePermissionMode: PermissionMode | undefined;
  readonly spawnPermissionMode: PermissionMode;
  firstTurnSpawnModeAuthoritative: boolean;
  currentApiModelId: string | undefined;
  rerouteOriginalApiModelId: string | undefined;
  readonly warnedUnhandledSdkKinds: Set<string>;
}

export interface ClaudeSessionTurn {
  pendingDispatches?: number;
  lastInteractionMode: ProviderInteractionMode | undefined;
  readonly turns: Array<{
    id: TurnId;
    items: Array<unknown>;
  }>;
  readonly inFlightTools: Map<number, ToolInFlight>;
  readonly trackedTasks: Map<string, ClaudeTrackedTask>;
  turnState: ClaudeTurnState | undefined;
  lastTurnId: TurnId | undefined;
  interruptRequestedTurnId: TurnId | undefined;
  compactionMessageId: string | undefined;
}

export interface ClaudeSessionPendingInteractions {
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  approvalsAlwaysAllowedForSession: boolean;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
}

export interface ClaudeSessionUsageCache {
  resultUsageBaseline?: ClaudeResultUsageBaseline;
  lastKnownContextWindow: number | undefined;
  currentAutoCompactWindow: number | undefined;
  currentAlwaysThinkingEnabled: boolean | undefined;
  currentEffort: ClaudeApiEffort | null;
  currentUltracode: boolean;
  currentFastMode: boolean;
  lastKnownAutoCompactThreshold: number | undefined;
  contextUsageControlEnabled: boolean;
  lastKnownTokenUsage: ThreadTokenUsageSnapshot | undefined;
  cacheObservation?: ClaudeCacheObservation | undefined;
  cacheRequestStartedAt?: { messageId: string; at: string };
  hasObservedCacheRequest?: boolean;
  tokenUsageState: ClaudeTokenUsageState;
  processedTokenTotal: number;
  processedTokenTurnBaseline: number;
  processedTokenResultBaseline: number;
  processedTokenBaselineKnown: boolean;
  readonly requestUsage: ClaudeRequestUsage;
  lastResultUuid: string | undefined;
  lastAssistantUuid: string | undefined;
  readonly emittedContextUsageWarnings: Set<string>;
}

export interface ClaudeSessionSubagents {
  readonly subagentRuns: Map<string, ClaudeSubagentRun>;
  readonly pendingSubagentSteers: Map<string, Array<string>>;
  readonly pendingSubagentStops: Set<string>;
  // Background task announcements use replacement snapshots; a partial background patch can race them.
  readonly knownBackgroundTaskIds: Set<string>;
  // Agent-scoped human interactions settle only on terminal task evidence or session stop.
  readonly terminalTaskIds: Set<string>;
  // Settled tool ids fence late child messages so stopped runs cannot reappear as running.
  readonly settledSubagentToolUseIds: Map<string, "completed" | "failed" | "stopped">;
  readonly liveWorkflowTaskIds: Set<string>;
  readonly knownWorkflowTaskIds: Set<string>;
  readonly workflowTaskIdByMemberTaskId: Map<string, string>;
  readonly workflowRuntimePollers: Map<string, Fiber.Fiber<void>>;
  readonly workflowAgentLabels: Map<string, Array<string>>;
  readonly workflowRuntimeStates: Map<string, ClaudeWorkflowRuntimeState>;
  readonly subagentRefs?: {
    readonly providerThreadId: string;
    readonly providerParentThreadId: string;
  };
}

export interface ClaudeSessionContext
  extends
    ClaudeSessionIdentity,
    ClaudeSessionQuery,
    ClaudeSessionTurn,
    ClaudeSessionPendingInteractions,
    ClaudeSessionUsageCache,
    ClaudeSessionSubagents {}

export interface ClaudeStopSessionOptions {
  readonly emitExitEvent?: boolean;

  readonly interruptStream?: boolean;
}
