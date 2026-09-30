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

export interface ClaudeSessionContext {
  resultUsageBaseline?: ClaudeResultUsageBaseline;
  readonly gatewaySessionLease?: AgentGatewaySessionLease;
  session: ProviderSession;
  readonly startInput: Parameters<ClaudeAdapterShape["startSession"]>[0];
  readonly lifecycleGeneration?: string;
  readonly promptQueue: Queue.Queue<PromptQueueItem>;
  readonly query: ClaudeQueryRuntime;

  readonly artifactsEnabled: boolean;

  initToolNames?: ReadonlySet<string>;
  readonly messageStream?: AsyncIterable<SDKMessage>;
  readonly processOwner: ClaudeProcessOwner;
  stopDeferred?: Deferred.Deferred<void, ProviderAdapterProcessError>;

  pendingDispatches?: number;
  streamFiber: Fiber.Fiber<void, Error> | undefined;
  readonly startedAt: string;
  readonly basePermissionMode: PermissionMode | undefined;

  readonly spawnPermissionMode: PermissionMode;

  firstTurnSpawnModeAuthoritative: boolean;
  lastInteractionMode: ProviderInteractionMode | undefined;
  currentApiModelId: string | undefined;
  resumeSessionId: string | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;

  approvalsAlwaysAllowedForSession: boolean;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<{
    id: TurnId;
    items: Array<unknown>;
  }>;
  readonly inFlightTools: Map<number, ToolInFlight>;
  readonly trackedTasks: Map<string, ClaudeTrackedTask>;
  turnState: ClaudeTurnState | undefined;

  lastTurnId: TurnId | undefined;
  interruptRequestedTurnId: TurnId | undefined;
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
  compactionMessageId: string | undefined;

  processedTokenTotal: number;
  processedTokenTurnBaseline: number;

  processedTokenResultBaseline: number;
  processedTokenBaselineKnown: boolean;
  readonly requestUsage: ClaudeRequestUsage;
  lastResultUuid: string | undefined;
  lastAssistantUuid: string | undefined;
  lastThreadStartedId: string | undefined;

  rerouteOriginalApiModelId: string | undefined;

  readonly emittedContextUsageWarnings: Set<string>;
  stopped: boolean;

  readonly warnedUnhandledSdkKinds: Set<string>;

  readonly subagentRuns: Map<string, ClaudeSubagentRun>;

  readonly pendingSubagentSteers: Map<string, Array<string>>;

  readonly pendingSubagentStops: Set<string>;
  // Last background-task ids from background_tasks_changed (REPLACE semantics); diffed so only newly
  // backgrounded work gets announced. Foreground/terminal patches may evict ids, but background
  // patches never seed the set because they can race the aggregate snapshot and suppress its "Moved
  // to background" notice entirely.
  readonly knownBackgroundTaskIds: Set<string>;
  // Task ids with provider-terminal evidence. Agent-scoped human interactions are cancelled only on
  // this evidence (or whole-session stop), never merely because their parent foreground turn
  // completed.
  readonly terminalTaskIds: Set<string>;
  // Late messages still tagged with them must not resurrect a scoped run: the synthetic turn that
  // would start on the settled child thread never completes and pins the strip row on "Running". The
  // status also corrects the Task tool_result's error shape (a user stop returns an error result that
  // would otherwise read "Failed").
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

export interface ClaudeStopSessionOptions {
  readonly emitExitEvent?: boolean;

  readonly interruptStream?: boolean;
}
