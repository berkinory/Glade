import { Schema } from "effect";

import { ProjectId, ThreadId, TurnId } from "../core/baseSchemas";
import { ModelSelection } from "../orchestration/orchestration";
import { ProviderKind } from "../core/baseSchemas";
import { ProviderModelDescriptor } from "./providerDiscovery";
import { ServerProviderAuthStatus } from "../server/server";

export const GLADE_GATEWAY_MAX_THREADS_PER_OPERATION = 20;
export const GLADE_GATEWAY_MAX_REQUEST_ID_LENGTH = 256;
export const GLADE_GATEWAY_MAX_WAIT_MS = 60_000;

export const GladeGatewayErrorCode = Schema.Literals([
  "caller_session_inactive",
  "caller_turn_inactive",
  "capability_denied",
  "provider_unavailable",
  "model_unavailable",
  "model_option_unavailable",
  "idempotency_conflict",
  "creation_plan_locked",
  "creation_limit_exceeded",
  "thread_not_found",
  "wait_timed_out",
  "operation_failed",
]);
export type GladeGatewayErrorCode = typeof GladeGatewayErrorCode.Type;

export const GladeGatewayError = Schema.Struct({
  code: GladeGatewayErrorCode,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
});
export type GladeGatewayError = typeof GladeGatewayError.Type;

export const GladeGatewayErrorResult = Schema.Struct({
  error: GladeGatewayError,
});
export type GladeGatewayErrorResult = typeof GladeGatewayErrorResult.Type;

export const GladeContextResult = Schema.Struct({
  harness: Schema.Struct({
    name: Schema.Literal("Glade"),
    policyVersion: Schema.String,
  }),
  caller: Schema.Struct({
    threadId: ThreadId,
    turnId: Schema.NullOr(TurnId),
    provider: ProviderKind,
    projectId: ProjectId,
  }),
  capabilities: Schema.Struct({
    threadRead: Schema.Boolean,
    threadCreate: Schema.Boolean,
    threadWait: Schema.Boolean,
    automations: Schema.Boolean,
  }),
});
export type GladeContextResult = typeof GladeContextResult.Type;

export const GladeCreateThreadSpec = Schema.Struct({
  prompt: Schema.String.check(Schema.isNonEmpty()),
  notifyCreatorOnComplete: Schema.optional(Schema.Boolean),
  title: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  target: ModelSelection,
  projectId: Schema.optional(ProjectId),
  environment: Schema.optional(Schema.Literals(["local", "worktree"])),
  baseRef: Schema.optional(Schema.String.check(Schema.isNonEmpty())),

  baseBranch: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  branchName: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  runtimeMode: Schema.optional(Schema.Literals(["approval-required", "full-access"])),
  // External integrations need the "computer:control" scope; provider sessions cannot delegate
  // computer control to created threads.
  enableComputerControl: Schema.optional(Schema.Boolean),
});
export type GladeCreateThreadSpec = typeof GladeCreateThreadSpec.Type;

const GladeGatewayRequestId = Schema.String.check(Schema.isNonEmpty()).check(
  Schema.isMaxLength(GLADE_GATEWAY_MAX_REQUEST_ID_LENGTH),
);

export const GladeCreateThreadsInput = Schema.Struct({
  requestId: GladeGatewayRequestId,
  threads: Schema.Array(GladeCreateThreadSpec)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(GLADE_GATEWAY_MAX_THREADS_PER_OPERATION)),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type GladeCreateThreadsInput = typeof GladeCreateThreadsInput.Type;

export const GladeProviderCatalog = Schema.Struct({
  provider: ProviderKind,
  defaultModel: Schema.NullOr(Schema.String),
  models: Schema.Array(ProviderModelDescriptor),
  enabled: Schema.Boolean,
  available: Schema.Boolean,
  authStatus: Schema.optional(ServerProviderAuthStatus),
  source: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});
export type GladeProviderCatalog = typeof GladeProviderCatalog.Type;

export const GladeGatewayTargetOptionValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
]);
export type GladeGatewayTargetOptionValue = typeof GladeGatewayTargetOptionValue.Type;

export const GladeGatewayTargetOptionRule = Schema.Struct({
  key: Schema.String,
  valueType: Schema.Literals(["string", "number", "boolean"]),
  allowedValues: Schema.Array(GladeGatewayTargetOptionValue),
  allowedValuesSource: Schema.Literals(["provider-contract", "model-discovery"]),
});
export type GladeGatewayTargetOptionRule = typeof GladeGatewayTargetOptionRule.Type;

export const GladeGatewayTargetConstruction = Schema.Struct({
  modelValueSource: Schema.Literal("providers[].models[].slug"),
  primaryOptionKey: Schema.String,
  alternativeOptionKeys: Schema.Array(Schema.String),
  optionSelectionRule: Schema.String,
  providerOptions: Schema.Array(GladeGatewayTargetOptionRule),
  optionsByModel: Schema.Record(Schema.String, Schema.Array(GladeGatewayTargetOptionRule)),
  exampleTarget: Schema.NullOr(ModelSelection),
});
export type GladeGatewayTargetConstruction = typeof GladeGatewayTargetConstruction.Type;

export const GladeCapabilitiesResult = Schema.Struct({
  targetConstruction: Schema.Record(Schema.String, GladeGatewayTargetConstruction),
  providers: Schema.Array(GladeProviderCatalog),
  limits: Schema.Struct({
    maxThreadsPerOperation: Schema.Int,
    maxWaitMs: Schema.Int,
    oneCreationPlanPerActiveTurn: Schema.Boolean,
  }),
});
export type GladeCapabilitiesResult = typeof GladeCapabilitiesResult.Type;

export const GladeCreatedThreadResult = Schema.Struct({
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  target: ModelSelection,
  provider: ProviderKind,
  model: Schema.String,
  runtimeMode: Schema.Literals(["approval-required", "full-access"]),
  environment: Schema.Literals(["local", "worktree"]),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  status: Schema.Literal("task_dispatched"),
});
export type GladeCreatedThreadResult = typeof GladeCreatedThreadResult.Type;

export const GladeCreateThreadsResult = Schema.Struct({
  operationId: Schema.String,
  requestId: GladeGatewayRequestId,
  requestedCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  createdCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  threadIds: Schema.Array(ThreadId),
  threads: Schema.Array(GladeCreatedThreadResult),
});
export type GladeCreateThreadsResult = typeof GladeCreateThreadsResult.Type;

export const GladeWaitForThreadsInput = Schema.Struct({
  threadIds: Schema.Array(ThreadId)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(GLADE_GATEWAY_MAX_THREADS_PER_OPERATION)),
  runIds: Schema.optional(
    Schema.Array(Schema.NullOr(TurnId)).check(
      Schema.isMaxLength(GLADE_GATEWAY_MAX_THREADS_PER_OPERATION),
    ),
  ),
  timeoutMs: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).check(
      Schema.isLessThanOrEqualTo(GLADE_GATEWAY_MAX_WAIT_MS),
    ),
  ),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type GladeWaitForThreadsInput = typeof GladeWaitForThreadsInput.Type;

export const GladeWaitedThreadResult = Schema.Struct({
  threadId: ThreadId,
  runId: Schema.NullOr(TurnId),
  state: Schema.Literals(["idle", "pending", "running", "completed", "error", "interrupted"]),
  terminal: Schema.Boolean,
  timedOut: Schema.Boolean,
  summary: Schema.NullOr(Schema.String),
  summaryTruncated: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  readThread: Schema.Struct({
    tool: Schema.Literal("glade_read_thread"),
    arguments: Schema.Struct({ threadId: ThreadId }),
  }),
});
export type GladeWaitedThreadResult = typeof GladeWaitedThreadResult.Type;

export const GladeWaitForThreadsResult = Schema.Struct({
  callerThreadId: ThreadId,
  runIds: Schema.Array(Schema.NullOr(TurnId)),
  allTerminal: Schema.Boolean,
  timedOut: Schema.Boolean,
  threads: Schema.Array(GladeWaitedThreadResult),
});
export type GladeWaitForThreadsResult = typeof GladeWaitForThreadsResult.Type;
