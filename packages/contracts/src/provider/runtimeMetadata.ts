import {
  TrimmedNonEmptyString,
  ProviderItemId,
  EventId,
  ThreadId,
  IsoDateTime,
  TurnId,
  RuntimeItemId,
  RuntimeRequestId,
} from "../core/baseSchemas";
import { Schema } from "effect";
import { ProviderKind } from "../core/baseSchemas";

export const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;

export const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);

const RuntimeEventRawSource = Schema.Literals([
  "codex.app-server.notification",
  "codex.app-server.request",
  "codex.eventmsg",
  "claude.sdk.message",
  "claude.sdk.permission",
  "claude.sdk.hook",
  "codex.sdk.thread-event",
]);

export type RuntimeEventRawSource = typeof RuntimeEventRawSource.Type;

export const RuntimeEventRaw = Schema.Struct({
  source: RuntimeEventRawSource,
  method: Schema.optional(TrimmedNonEmptyStringSchema),
  messageType: Schema.optional(TrimmedNonEmptyStringSchema),
  payload: Schema.Unknown,
});

export type RuntimeEventRaw = typeof RuntimeEventRaw.Type;

const ProviderRequestId = TrimmedNonEmptyStringSchema;

export type ProviderRequestId = typeof ProviderRequestId.Type;

const ProviderRefs = Schema.Struct({
  providerThreadId: Schema.optional(TrimmedNonEmptyStringSchema),
  providerParentThreadId: Schema.optional(TrimmedNonEmptyStringSchema),
  providerTurnId: Schema.optional(TrimmedNonEmptyStringSchema),
  parentProviderTurnId: Schema.optional(TrimmedNonEmptyStringSchema),
  providerItemId: Schema.optional(ProviderItemId),
  providerRequestId: Schema.optional(ProviderRequestId),
});

export type ProviderRefs = typeof ProviderRefs.Type;

export const RuntimeSessionState = Schema.Literals([
  "starting",
  "ready",
  "running",
  "waiting",
  "stopped",
  "error",
]);

export type RuntimeSessionState = typeof RuntimeSessionState.Type;

export const RuntimeThreadState = Schema.Literals([
  "active",
  "idle",
  "archived",
  "closed",
  "compacted",
  "error",
]);

export type RuntimeThreadState = typeof RuntimeThreadState.Type;

export const RuntimeTurnState = Schema.Literals([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);

export type RuntimeTurnState = typeof RuntimeTurnState.Type;

export const RuntimeTaskStatus = Schema.Literals(["pending", "inProgress", "completed"]);

export type RuntimeTaskStatus = typeof RuntimeTaskStatus.Type;

export const RuntimeItemStatus = Schema.Literals(["inProgress", "completed", "failed", "declined"]);

export type RuntimeItemStatus = typeof RuntimeItemStatus.Type;

export const RuntimeContentStreamKind = Schema.Literals([
  "assistant_text",
  "reasoning_text",
  "reasoning_summary_text",
  "plan_text",
  "command_output",
  "file_change_output",
  "unknown",
]);

export type RuntimeContentStreamKind = typeof RuntimeContentStreamKind.Type;

export const RuntimeSessionExitKind = Schema.Literals(["graceful", "error"]);

export type RuntimeSessionExitKind = typeof RuntimeSessionExitKind.Type;

export const RuntimeErrorClass = Schema.Literals([
  "provider_error",
  "transport_error",
  "permission_error",
  "validation_error",
  "unknown",
]);

export type RuntimeErrorClass = typeof RuntimeErrorClass.Type;

export const TOOL_LIFECYCLE_ITEM_TYPES = [
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "dynamic_tool_call",
  "collab_agent_tool_call",
  "web_search",
  "image_view",
  "image_generation",
] as const;

export const ToolLifecycleItemType = Schema.Literals(TOOL_LIFECYCLE_ITEM_TYPES);

export type ToolLifecycleItemType = typeof ToolLifecycleItemType.Type;

export function isToolLifecycleItemType(value: string): value is ToolLifecycleItemType {
  return TOOL_LIFECYCLE_ITEM_TYPES.includes(value as ToolLifecycleItemType);
}

export const CanonicalItemType = Schema.Literals([
  "user_message",
  "assistant_message",
  "reasoning",
  "plan",
  ...TOOL_LIFECYCLE_ITEM_TYPES,
  "review_entered",
  "review_exited",
  "context_compaction",
  "error",
  "unknown",
]);

export type CanonicalItemType = typeof CanonicalItemType.Type;

export const CanonicalRequestType = Schema.Literals([
  "command_execution_approval",
  "file_read_approval",
  "file_change_approval",
  "permissions_approval",
  "apply_patch_approval",
  "exec_command_approval",
  "tool_user_input",
  "tool_approval",
  "dynamic_tool_call",
  "auth_tokens_refresh",
  "unknown",
]);

export type CanonicalRequestType = typeof CanonicalRequestType.Type;

const ProviderRuntimeEventType = Schema.Literals([
  "session.started",
  "session.configured",
  "session.state.changed",
  "session.exited",
  "thread.started",
  "thread.state.changed",
  "thread.metadata.updated",
  "thread.token-usage.updated",
  "thread.realtime.started",
  "thread.realtime.item-added",
  "thread.realtime.audio.delta",
  "thread.realtime.error",
  "thread.realtime.closed",
  "turn.started",
  "turn.completed",
  "turn.aborted",
  "turn.tasks.updated",
  "turn.proposed.delta",
  "turn.proposed.completed",
  "turn.diff.updated",
  "turn.steered",
  "item.started",
  "item.updated",
  "item.completed",
  "content.delta",
  "request.opened",
  "request.resolved",
  "user-input.requested",
  "user-input.resolved",
  "task.started",
  "task.progress",
  "task.updated",
  "task.completed",
  "hook.started",
  "hook.progress",
  "hook.completed",
  "tool.progress",
  "tool.summary",
  "auth.status",
  "account.updated",
  "account.rate-limits.updated",
  "mcp.status.updated",
  "mcp.oauth.completed",
  "model.rerouted",
  "config.warning",
  "deprecation.notice",
  "files.persisted",
  "vcs.state.changed",
  "runtime.warning",
  "runtime.error",
  "event.unmapped",
]);

export type ProviderRuntimeEventType = typeof ProviderRuntimeEventType.Type;

export const ProviderRuntimeEventBase = Schema.Struct({
  eventId: EventId,
  provider: ProviderKind,
  threadId: ThreadId,
  createdAt: IsoDateTime,
  turnId: Schema.optional(TurnId),
  parentTurnId: Schema.optional(TurnId),
  itemId: Schema.optional(RuntimeItemId),
  requestId: Schema.optional(RuntimeRequestId),
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyStringSchema),
  providerRefs: Schema.optional(ProviderRefs),
  raw: Schema.optional(RuntimeEventRaw),
});

export type ProviderRuntimeEventBase = typeof ProviderRuntimeEventBase.Type;
