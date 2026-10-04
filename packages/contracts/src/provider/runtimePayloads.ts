import { Schema, Option } from "effect";
import { NonNegativeInt, PositiveInt, RuntimeTaskId, TurnId } from "../core/baseSchemas";
import { AsyncUserInputQuestions } from "../orchestration/asyncUserInput";
import { ModelSelection } from "./sessionPolicy";
import { ProviderFailure } from "./providerFailure";
import {
  TrimmedNonEmptyStringSchema,
  UnknownRecordSchema,
  RuntimeSessionState,
  RuntimeSessionExitKind,
  RuntimeThreadState,
  RuntimeTurnState,
  RuntimeTaskStatus,
  CanonicalItemType,
  RuntimeItemStatus,
  RuntimeContentStreamKind,
  CanonicalRequestType,
  RuntimeErrorClass,
} from "./runtimeMetadata";

export const SessionStartedPayload = Schema.Struct({
  message: Schema.optional(TrimmedNonEmptyStringSchema),
  resume: Schema.optional(Schema.Unknown),
});

export type SessionStartedPayload = typeof SessionStartedPayload.Type;

export const SessionConfiguredPayload = Schema.Struct({
  config: UnknownRecordSchema,
});

export type SessionConfiguredPayload = typeof SessionConfiguredPayload.Type;

export const SessionStateChangedPayload = Schema.Struct({
  state: RuntimeSessionState,
  reason: Schema.optional(TrimmedNonEmptyStringSchema),
  detail: Schema.optional(Schema.Unknown),
});

export type SessionStateChangedPayload = typeof SessionStateChangedPayload.Type;

export const SessionExitedPayload = Schema.Struct({
  reason: Schema.optional(TrimmedNonEmptyStringSchema),
  recoverable: Schema.optional(Schema.Boolean),
  exitKind: Schema.optional(RuntimeSessionExitKind),
});

export type SessionExitedPayload = typeof SessionExitedPayload.Type;

export const ThreadStartedPayload = Schema.Struct({
  providerThreadId: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type ThreadStartedPayload = typeof ThreadStartedPayload.Type;

export const ThreadStateChangedPayload = Schema.Struct({
  state: RuntimeThreadState,
  detail: Schema.optional(Schema.Unknown),
});

export type ThreadStateChangedPayload = typeof ThreadStateChangedPayload.Type;

export const ThreadMetadataUpdatedPayload = Schema.Struct({
  modelSelection: Schema.optional(ModelSelection),
  name: Schema.optional(TrimmedNonEmptyStringSchema),
  metadata: Schema.optional(UnknownRecordSchema),
});

export type ThreadMetadataUpdatedPayload = typeof ThreadMetadataUpdatedPayload.Type;

export const ThreadTokenUsageSnapshot = Schema.Struct({
  cumulativeUsage: Schema.optional(
    Schema.Struct({
      inputTokens: NonNegativeInt,
      outputTokens: NonNegativeInt,
      cachedInputTokens: Schema.optional(NonNegativeInt),
      cacheCreationInputTokens: Schema.optional(NonNegativeInt),
    }),
  ),
  usedTokens: NonNegativeInt,
  usedPercent: Schema.optional(
    Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(100)),
  ),
  totalProcessedTokens: Schema.optional(NonNegativeInt),

  tokenAccountingVersion: Schema.optional(Schema.Literal(1)),
  maxTokens: Schema.optional(PositiveInt),
  inputTokens: Schema.optional(NonNegativeInt),
  cachedInputTokens: Schema.optional(NonNegativeInt),
  outputTokens: Schema.optional(NonNegativeInt),
  reasoningOutputTokens: Schema.optional(NonNegativeInt),
  lastUsedTokens: Schema.optional(NonNegativeInt),
  lastInputTokens: Schema.optional(NonNegativeInt),
  lastCachedInputTokens: Schema.optional(NonNegativeInt),
  lastOutputTokens: Schema.optional(NonNegativeInt),
  lastReasoningOutputTokens: Schema.optional(NonNegativeInt),
  toolUses: Schema.optional(NonNegativeInt),
  durationMs: Schema.optional(NonNegativeInt),
  compactsAutomatically: Schema.optional(Schema.Boolean),
});

export type ThreadTokenUsageSnapshot = typeof ThreadTokenUsageSnapshot.Type;

export const ThreadTokenUsageUpdatedPayload = Schema.Struct({
  usage: ThreadTokenUsageSnapshot,
});

export type ThreadTokenUsageUpdatedPayload = typeof ThreadTokenUsageUpdatedPayload.Type;

export const ThreadRealtimeStartedPayload = Schema.Struct({
  realtimeSessionId: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type ThreadRealtimeStartedPayload = typeof ThreadRealtimeStartedPayload.Type;

export const ThreadRealtimeItemAddedPayload = Schema.Struct({
  item: Schema.Unknown,
});

export type ThreadRealtimeItemAddedPayload = typeof ThreadRealtimeItemAddedPayload.Type;

export const ThreadRealtimeAudioDeltaPayload = Schema.Struct({
  audio: Schema.Unknown,
});

export type ThreadRealtimeAudioDeltaPayload = typeof ThreadRealtimeAudioDeltaPayload.Type;

export const ThreadRealtimeErrorPayload = Schema.Struct({
  message: TrimmedNonEmptyStringSchema,
});

export type ThreadRealtimeErrorPayload = typeof ThreadRealtimeErrorPayload.Type;

export const ThreadRealtimeClosedPayload = Schema.Struct({
  reason: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type ThreadRealtimeClosedPayload = typeof ThreadRealtimeClosedPayload.Type;

export const TurnStartedPayload = Schema.Struct({
  backgroundParentTurnId: Schema.optional(TurnId),
  model: Schema.optional(TrimmedNonEmptyStringSchema),
  effort: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type TurnStartedPayload = typeof TurnStartedPayload.Type;

export const TurnCompletedPayload = Schema.Struct({
  sessionState: Schema.optional(RuntimeSessionState),
  state: RuntimeTurnState,

  contextCompacted: Schema.optional(Schema.Boolean),
  stopReason: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
  usage: Schema.optional(Schema.Unknown),
  modelUsage: Schema.optional(UnknownRecordSchema),
  tokenAccountingVersion: Schema.optional(Schema.Literal(1)),

  mainLoopTokens: Schema.optional(NonNegativeInt),
  totalCostUsd: Schema.optional(Schema.Number),
  cumulativeCostUsd: Schema.optional(Schema.Number),
  errorMessage: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type TurnCompletedPayload = typeof TurnCompletedPayload.Type;

export const TurnAbortedPayload = Schema.Struct({
  reason: TrimmedNonEmptyStringSchema,
});

export type TurnAbortedPayload = typeof TurnAbortedPayload.Type;

const RuntimeTaskListItem = Schema.Struct({
  task: TrimmedNonEmptyStringSchema,
  status: RuntimeTaskStatus,
});

export type RuntimeTaskListItem = typeof RuntimeTaskListItem.Type;

export const TurnTasksUpdatedPayload = Schema.Struct({
  explanation: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
  tasks: Schema.Array(RuntimeTaskListItem),
});

export type TurnTasksUpdatedPayload = typeof TurnTasksUpdatedPayload.Type;

export const TurnProposedDeltaPayload = Schema.Struct({
  delta: Schema.String,
});

export type TurnProposedDeltaPayload = typeof TurnProposedDeltaPayload.Type;

export const TurnProposedCompletedPayload = Schema.Struct({
  planMarkdown: TrimmedNonEmptyStringSchema,
});

export type TurnProposedCompletedPayload = typeof TurnProposedCompletedPayload.Type;

export const TurnDiffUpdatedPayload = Schema.Struct({
  unifiedDiff: Schema.String,
});

export type TurnDiffUpdatedPayload = typeof TurnDiffUpdatedPayload.Type;

export const ItemLifecyclePayload = Schema.Struct({
  asyncQuestions: Schema.optional(AsyncUserInputQuestions),
  itemType: CanonicalItemType,
  status: Schema.optional(RuntimeItemStatus),
  title: Schema.optional(TrimmedNonEmptyStringSchema),

  detail: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Unknown),
});

export type ItemLifecyclePayload = typeof ItemLifecyclePayload.Type;

export const CODEX_GENERATED_IMAGE_ARTIFACT_KIND = "codex.generated_image" as const;

export const CodexGeneratedImageArtifact = Schema.Struct({
  kind: Schema.Literal(CODEX_GENERATED_IMAGE_ARTIFACT_KIND),
  path: TrimmedNonEmptyStringSchema,
  callId: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type CodexGeneratedImageArtifact = typeof CodexGeneratedImageArtifact.Type;

export const ContentDeltaPayload = Schema.Struct({
  streamKind: RuntimeContentStreamKind,
  delta: Schema.String,
  contentIndex: Schema.optional(Schema.Int),
  summaryIndex: Schema.optional(Schema.Int),
});

export type ContentDeltaPayload = typeof ContentDeltaPayload.Type;

export const RequestOpenedPayload = Schema.Struct({
  requestType: CanonicalRequestType,
  detail: Schema.optional(TrimmedNonEmptyStringSchema),
  args: Schema.optional(Schema.Unknown),
});

export type RequestOpenedPayload = typeof RequestOpenedPayload.Type;

export const RequestResolvedPayload = Schema.Struct({
  requestType: CanonicalRequestType,
  decision: Schema.optional(TrimmedNonEmptyStringSchema),
  resolution: Schema.optional(Schema.Unknown),
});

export type RequestResolvedPayload = typeof RequestResolvedPayload.Type;

const UserInputQuestionOption = Schema.Struct({
  label: TrimmedNonEmptyStringSchema,
  description: TrimmedNonEmptyStringSchema,
});

export type UserInputQuestionOption = typeof UserInputQuestionOption.Type;

export const UserInputQuestion = Schema.Struct({
  required: Schema.optional(Schema.Boolean),
  elicitation: Schema.optional(Schema.Struct({ url: Schema.optional(Schema.String) })),
  id: TrimmedNonEmptyStringSchema,
  header: TrimmedNonEmptyStringSchema,
  question: TrimmedNonEmptyStringSchema,
  options: Schema.Array(UserInputQuestionOption),
  multiSelect: Schema.optional(Schema.Boolean).pipe(
    Schema.withConstructorDefault(() => Option.some(false)),
  ),
});

export type UserInputQuestion = typeof UserInputQuestion.Type;

export const UserInputRequestedPayload = Schema.Struct({
  questions: Schema.Array(UserInputQuestion),
});

export type UserInputRequestedPayload = typeof UserInputRequestedPayload.Type;

export const UserInputResolvedPayload = Schema.Struct({
  answers: UnknownRecordSchema,
});

export type UserInputResolvedPayload = typeof UserInputResolvedPayload.Type;

const WorkflowPhase = Schema.Struct({
  title: TrimmedNonEmptyStringSchema,
  detail: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type WorkflowPhase = typeof WorkflowPhase.Type;

const WorkflowAgentSnapshot = Schema.Struct({
  label: TrimmedNonEmptyStringSchema,
  phaseIndex: Schema.optional(Schema.Int),

  phaseTitle: Schema.optional(TrimmedNonEmptyStringSchema),
  agentId: Schema.optional(TrimmedNonEmptyStringSchema),
  model: Schema.optional(TrimmedNonEmptyStringSchema),

  effort: Schema.optional(TrimmedNonEmptyStringSchema),
  state: Schema.optional(TrimmedNonEmptyStringSchema),
  tokens: Schema.optional(Schema.Int),
  toolCalls: Schema.optional(Schema.Int),
  durationMs: Schema.optional(Schema.Int),
  lastToolName: Schema.optional(TrimmedNonEmptyStringSchema),
  promptPreview: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type WorkflowAgentSnapshot = typeof WorkflowAgentSnapshot.Type;

const WorkflowAgentRuntimeSnapshot = Schema.Struct({
  agentId: TrimmedNonEmptyStringSchema,
  label: Schema.optional(TrimmedNonEmptyStringSchema),
  model: Schema.optional(TrimmedNonEmptyStringSchema),

  effort: Schema.optional(TrimmedNonEmptyStringSchema),
  state: Schema.optional(Schema.Literals(["running", "completed"])),
  tokens: Schema.optional(Schema.Int),
  toolCalls: Schema.optional(Schema.Int),
  recentToolNames: Schema.optional(Schema.Array(TrimmedNonEmptyStringSchema)),
  promptPreview: Schema.optional(TrimmedNonEmptyStringSchema),
  startedAt: Schema.optional(TrimmedNonEmptyStringSchema),
  lastActivityAt: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type WorkflowAgentRuntimeSnapshot = typeof WorkflowAgentRuntimeSnapshot.Type;

const WorkflowAgentPlan = Schema.Struct({
  phase: Schema.optional(TrimmedNonEmptyStringSchema),
  model: Schema.optional(TrimmedNonEmptyStringSchema),
  effort: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type WorkflowAgentPlan = typeof WorkflowAgentPlan.Type;

export const TaskStartedPayload = Schema.Struct({
  taskId: RuntimeTaskId,
  description: Schema.optional(TrimmedNonEmptyStringSchema),
  taskType: Schema.optional(TrimmedNonEmptyStringSchema),
  subagentType: Schema.optional(TrimmedNonEmptyStringSchema),
  workflowName: Schema.optional(TrimmedNonEmptyStringSchema),
  workflowTaskId: Schema.optional(RuntimeTaskId),

  workflowPhases: Schema.optional(Schema.Array(WorkflowPhase)),

  workflowAgentPhases: Schema.optional(Schema.Record(Schema.String, Schema.String)),

  workflowAgentPlans: Schema.optional(Schema.Record(Schema.String, WorkflowAgentPlan)),
  toolUseId: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type TaskStartedPayload = typeof TaskStartedPayload.Type;

export const TaskProgressPayload = Schema.Struct({
  taskId: RuntimeTaskId,
  description: TrimmedNonEmptyStringSchema,
  summary: Schema.optional(TrimmedNonEmptyStringSchema),
  usage: Schema.optional(Schema.Unknown),
  lastToolName: Schema.optional(TrimmedNonEmptyStringSchema),
  workflowTaskId: Schema.optional(RuntimeTaskId),

  workflowAgents: Schema.optional(Schema.Array(WorkflowAgentRuntimeSnapshot)),
});

export type TaskProgressPayload = typeof TaskProgressPayload.Type;

export const TaskUpdatedPayload = Schema.Struct({
  taskId: RuntimeTaskId,
  status: Schema.optional(
    Schema.Literals(["pending", "running", "completed", "failed", "killed", "paused"]),
  ),
  error: Schema.optional(TrimmedNonEmptyStringSchema),

  isBackgrounded: Schema.optional(Schema.Boolean),
  toolUseId: Schema.optional(TrimmedNonEmptyStringSchema),
  workflowTaskId: Schema.optional(RuntimeTaskId),

  workflowRunId: Schema.optional(TrimmedNonEmptyStringSchema),
  workflowScriptPath: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type TaskUpdatedPayload = typeof TaskUpdatedPayload.Type;

export const TaskCompletedPayload = Schema.Struct({
  taskId: RuntimeTaskId,
  status: Schema.Literals(["completed", "failed", "stopped"]),
  summary: Schema.optional(TrimmedNonEmptyStringSchema),
  usage: Schema.optional(Schema.Unknown),
  workflowTaskId: Schema.optional(RuntimeTaskId),
  workflowAgents: Schema.optional(Schema.Array(WorkflowAgentSnapshot)),
});

export type TaskCompletedPayload = typeof TaskCompletedPayload.Type;

export // A user message was injected into running work without interrupting it. `target` says where it
// landed, which decides whether the message needs its own transcript marker: a `"subagent"` steer
// is delivered on the child thread where nothing else shows it, while a `"turn"` steer is already
// rendered as the sent user message on the thread it steers. Absent means `"subagent"` (the only
// producer before turn steering existed).
const TurnSteeredPayload = Schema.Struct({
  message: TrimmedNonEmptyStringSchema,
  target: Schema.optional(Schema.Literals(["turn", "subagent"])),
});

export type TurnSteeredPayload = typeof TurnSteeredPayload.Type;

export const HookStartedPayload = Schema.Struct({
  hookId: TrimmedNonEmptyStringSchema,
  hookName: TrimmedNonEmptyStringSchema,
  hookEvent: TrimmedNonEmptyStringSchema,
  statusMessage: Schema.optional(TrimmedNonEmptyStringSchema),
  data: Schema.optional(Schema.Unknown),
});

export type HookStartedPayload = typeof HookStartedPayload.Type;

export const HookProgressPayload = Schema.Struct({
  hookId: TrimmedNonEmptyStringSchema,
  output: Schema.optional(Schema.String),
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
});

export type HookProgressPayload = typeof HookProgressPayload.Type;

export const HookCompletedPayload = Schema.Struct({
  hookId: TrimmedNonEmptyStringSchema,
  hookName: Schema.optional(TrimmedNonEmptyStringSchema),
  hookEvent: Schema.optional(TrimmedNonEmptyStringSchema),
  outcome: Schema.Literals(["success", "error", "cancelled"]),
  status: Schema.optional(Schema.Literals(["completed", "failed", "blocked", "stopped"])),
  statusMessage: Schema.optional(TrimmedNonEmptyStringSchema),
  durationMs: Schema.optional(NonNegativeInt),
  output: Schema.optional(Schema.String),
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Int),
  data: Schema.optional(Schema.Unknown),
});

export type HookCompletedPayload = typeof HookCompletedPayload.Type;

export const ToolProgressPayload = Schema.Struct({
  toolUseId: Schema.optional(TrimmedNonEmptyStringSchema),
  toolName: Schema.optional(TrimmedNonEmptyStringSchema),
  summary: Schema.optional(TrimmedNonEmptyStringSchema),
  elapsedSeconds: Schema.optional(Schema.Number),
});

export type ToolProgressPayload = typeof ToolProgressPayload.Type;

export const ToolSummaryPayload = Schema.Struct({
  summary: TrimmedNonEmptyStringSchema,
  precedingToolUseIds: Schema.optional(Schema.Array(TrimmedNonEmptyStringSchema)),
});

export type ToolSummaryPayload = typeof ToolSummaryPayload.Type;

export const AuthStatusPayload = Schema.Struct({
  isAuthenticating: Schema.optional(Schema.Boolean),
  output: Schema.optional(Schema.Array(Schema.String)),
  error: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type AuthStatusPayload = typeof AuthStatusPayload.Type;

export const AccountUpdatedPayload = Schema.Struct({
  account: Schema.Unknown,
});

export type AccountUpdatedPayload = typeof AccountUpdatedPayload.Type;

export const AccountRateLimitsUpdatedPayload = Schema.Struct({
  rateLimits: Schema.Unknown,
});

export type AccountRateLimitsUpdatedPayload = typeof AccountRateLimitsUpdatedPayload.Type;

export const McpStatusUpdatedPayload = Schema.Struct({
  status: Schema.Unknown,
});

export type McpStatusUpdatedPayload = typeof McpStatusUpdatedPayload.Type;

export const McpOauthCompletedPayload = Schema.Struct({
  success: Schema.Boolean,
  name: Schema.optional(TrimmedNonEmptyStringSchema),
  error: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type McpOauthCompletedPayload = typeof McpOauthCompletedPayload.Type;

export const ModelReroutedPayload = Schema.Struct({
  fromModel: TrimmedNonEmptyStringSchema,
  toModel: TrimmedNonEmptyStringSchema,
  reason: TrimmedNonEmptyStringSchema,
});

export type ModelReroutedPayload = typeof ModelReroutedPayload.Type;

export const ConfigWarningPayload = Schema.Struct({
  summary: TrimmedNonEmptyStringSchema,
  details: Schema.optional(TrimmedNonEmptyStringSchema),
  path: Schema.optional(TrimmedNonEmptyStringSchema),
  range: Schema.optional(Schema.Unknown),
});

export type ConfigWarningPayload = typeof ConfigWarningPayload.Type;

export const DeprecationNoticePayload = Schema.Struct({
  summary: TrimmedNonEmptyStringSchema,
  details: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type DeprecationNoticePayload = typeof DeprecationNoticePayload.Type;

export const FilesPersistedPayload = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      filename: TrimmedNonEmptyStringSchema,
      fileId: TrimmedNonEmptyStringSchema,
    }),
  ),
  failed: Schema.optional(
    Schema.Array(
      Schema.Struct({
        filename: TrimmedNonEmptyStringSchema,
        error: TrimmedNonEmptyStringSchema,
      }),
    ),
  ),
});

export type FilesPersistedPayload = typeof FilesPersistedPayload.Type;

export const VcsStateChangedPayload = Schema.Struct({
  kind: Schema.optional(TrimmedNonEmptyStringSchema),
  cwd: Schema.optional(TrimmedNonEmptyStringSchema),
});

export type VcsStateChangedPayload = typeof VcsStateChangedPayload.Type;

export const RuntimeWarningPayload = Schema.Struct({
  message: TrimmedNonEmptyStringSchema,
  failure: Schema.optional(ProviderFailure),
  detail: Schema.optional(Schema.Unknown),
});

export type RuntimeWarningPayload = typeof RuntimeWarningPayload.Type;

export const RuntimeErrorPayload = Schema.Struct({
  message: TrimmedNonEmptyStringSchema,
  failure: Schema.optional(ProviderFailure),
  class: Schema.optional(RuntimeErrorClass),
  detail: Schema.optional(Schema.Unknown),
});

export type RuntimeErrorPayload = typeof RuntimeErrorPayload.Type;

export const EventUnmappedPayload = Schema.Struct({
  nativeType: TrimmedNonEmptyStringSchema,
  detail: Schema.optional(TrimmedNonEmptyStringSchema),
  data: Schema.optional(Schema.Unknown),
});

export type EventUnmappedPayload = typeof EventUnmappedPayload.Type;
