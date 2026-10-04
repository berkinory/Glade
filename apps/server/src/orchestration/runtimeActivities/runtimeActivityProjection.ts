import { TurnId, EventId, ApprovalRequestId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { asString } from "@glade/shared/text/text";
import { type OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { isToolLifecycleItemType } from "@glade/contracts/provider/runtimeMetadata";
import {
  sanitizeUnmappedProviderDetail,
  sanitizeUnmappedProviderData,
} from "../../provider/core/unmappedProviderEvents.ts";
import {
  runtimePayloadRecord,
  toActivityPayload,
  truncateDetail,
  MAX_ACTIVITY_DATA_STRING_CHARS,
  activityDataField,
  stringifyJsonLike,
} from "./activityPayloads";
import {
  buildConfiguredContextWindowPayload,
  buildContextWindowActivityPayload,
  compactTurnModelUsage,
} from "./contextWindowPayloads";
import {
  requestKindFromCanonicalRequestType,
  requestedPermissionProfile,
  sessionApprovalAvailable,
  requestedMcpToolCallPresentation,
  buildToolProgressActivityPayload,
} from "./toolActivityPayloads";

function toTurnId(value: TurnId | string | undefined): TurnId | undefined {
  const trimmed = value === undefined ? undefined : nonEmptyTrimmed(String(value));
  return trimmed === undefined ? undefined : TurnId.makeUnsafe(trimmed);
}

export function readableReasoningDetail(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed?.replace(/<!--[\s\S]*?-->/gu, "").trim() ? trimmed : undefined;
}

export function runtimeTurnState(
  event: ProviderRuntimeEvent,
): "completed" | "failed" | "interrupted" | "cancelled" {
  const state = asString(runtimePayloadRecord(event)?.state);
  return state === "failed" || state === "interrupted" || state === "cancelled"
    ? state
    : "completed";
}

export function projectProviderRuntimeActivities(
  event: ProviderRuntimeEvent,
  sessionSequence?: number,
): ReadonlyArray<OrchestrationThreadActivity> {
  const maybeSequence =
    typeof sessionSequence === "number" && Number.isInteger(sessionSequence) && sessionSequence >= 0
      ? { sequence: sessionSequence }
      : {};

  if (
    ((event.provider === "codex" && event.type === "item.completed") ||
      (event.provider === "claudeAgent" &&
        (event.type === "item.updated" || event.type === "item.completed"))) &&
    event.payload.itemType === "reasoning" &&
    event.itemId !== undefined &&
    readableReasoningDetail(event.payload.detail) !== undefined
  ) {
    const reasoningItemId = String(event.itemId);
    const reasoningDetail = readableReasoningDetail(event.payload.detail)!;
    return [
      {
        id: EventId.makeUnsafe(`provider-reasoning:${event.threadId}:${reasoningItemId}`),
        createdAt: event.createdAt,
        tone: "tool",
        kind: "task.progress",
        summary: "Reasoning trace",
        payload: toActivityPayload({
          ...(event.payload.status ? { status: event.payload.status } : {}),
          detail: truncateDetail(reasoningDetail, MAX_ACTIVITY_DATA_STRING_CHARS),
          data: { toolCallId: reasoningItemId },
        }),
        turnId: toTurnId(event.turnId) ?? null,
        ...maybeSequence,
      },
    ];
  }
  switch (event.type) {
    case "turn.started":
      return event.payload.backgroundParentTurnId && event.turnId
        ? [
            {
              id: event.eventId,
              createdAt: event.createdAt,
              tone: "info",
              kind: "response.started",
              summary: "Background reply",
              payload: { backgroundParentTurnId: event.payload.backgroundParentTurnId },
              turnId: toTurnId(event.turnId) ?? null,
              ...maybeSequence,
            },
          ]
        : [];
    case "session.started":
    case "session.exited":
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "background-work.reset",
          summary: "Provider session changed",
          payload: {},
          turnId: null,
          ...maybeSequence,
        },
      ];
    case "session.configured": {
      const payload = buildConfiguredContextWindowPayload(event);
      if (!payload) {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-window.configured",
          summary: "Context window configured",
          payload,
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "request.opened":
    case "request.resolved": {
      if (event.payload.requestType === "tool_user_input") {
        return [];
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
      const permissionProfile =
        event.type === "request.opened" ? requestedPermissionProfile(event) : undefined;
      const canApproveForSession =
        event.type === "request.opened" ? sessionApprovalAvailable(event) : undefined;
      const toolCallPresentation =
        event.type === "request.opened" ? requestedMcpToolCallPresentation(event) : {};
      const requestId = nonEmptyTrimmed(event.requestId);
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "approval",
          kind: event.type === "request.opened" ? "approval.requested" : "approval.resolved",
          summary:
            event.type === "request.resolved"
              ? "Approval resolved"
              : requestKind === "command"
                ? "Command approval requested"
                : requestKind === "file-read"
                  ? "File-read approval requested"
                  : requestKind === "file-change"
                    ? "File-change approval requested"
                    : requestKind === "permissions"
                      ? "Permission approval requested"
                      : requestKind === "tool"
                        ? "Tool approval requested"
                        : "Approval requested",
          payload: toActivityPayload({
            ...(requestId ? { requestId: ApprovalRequestId.makeUnsafe(requestId) } : {}),
            ...(event.lifecycleGeneration !== undefined
              ? { lifecycleGeneration: event.lifecycleGeneration }
              : {}),
            ...(requestKind ? { requestKind } : {}),
            requestType: event.payload.requestType,
            ...(event.type === "request.opened" && event.payload.detail
              ? { detail: truncateDetail(event.payload.detail) }
              : {}),
            ...(permissionProfile ? { permissionProfile } : {}),
            ...toolCallPresentation,
            ...(canApproveForSession !== undefined
              ? { sessionApprovalAvailable: canApproveForSession }
              : {}),
            ...(event.type === "request.resolved" && event.payload.decision
              ? { decision: event.payload.decision }
              : {}),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.error": {
      const payload = runtimePayloadRecord(event);
      const message = asString(payload?.message);
      if (!message) {
        return [];
      }
      const errorClass = asString(payload?.class);
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "error",
          kind: "runtime.error",
          summary: "Provider runtime error",
          payload: toActivityPayload({
            message: truncateDetail(message, 500),
            ...(errorClass ? { class: errorClass } : {}),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.warning": {
      const raw = asRecord((event as { raw?: unknown }).raw) ?? undefined;
      const nativeType = asString((asRecord(raw?.payload) ?? undefined)?.type);

      const detailSubtype = asString((asRecord(event.payload.detail) ?? undefined)?.subtype);
      const isBackgroundMove = detailSubtype === "background_tasks_changed";
      const detail = truncateDetail(
        sanitizeUnmappedProviderDetail(event.payload.message, MAX_ACTIVITY_DATA_STRING_CHARS)!,
        MAX_ACTIVITY_DATA_STRING_CHARS,
      );
      const message = truncateDetail(detail);
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "runtime.warning",
          summary:
            detailSubtype === "api_retry"
              ? "Claude retrying"
              : isBackgroundMove
                ? "Moved to background"
                : detailSubtype === "informational" || detailSubtype === "notification"
                  ? "Claude notice"
                  : "Runtime warning",

          payload: toActivityPayload({
            message,
            detail,
            ...(isBackgroundMove
              ? { nativeEventType: detailSubtype }
              : nativeType
                ? { nativeEventType: nativeType }
                : {}),
            ...activityDataField(sanitizeUnmappedProviderData(event.payload.detail)),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "model.rerouted": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "model.rerouted",
          summary: `Model switched: ${event.payload.fromModel} -> ${event.payload.toModel}`,
          payload: toActivityPayload({
            fromModel: event.payload.fromModel,
            toModel: event.payload.toModel,
            detail: truncateDetail(event.payload.reason, 500),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "turn.tasks.updated": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "turn.tasks.updated",
          summary: "Tasks updated",
          payload: toActivityPayload({
            tasks: event.payload.tasks,
            ...(event.payload.explanation !== undefined
              ? { explanation: event.payload.explanation }
              : {}),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "user-input.requested":
    case "user-input.resolved": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: event.type,
          summary:
            event.type === "user-input.requested" ? "User input requested" : "User input submitted",
          payload: toActivityPayload({
            ...(event.requestId ? { requestId: event.requestId } : {}),
            ...(event.lifecycleGeneration !== undefined
              ? { lifecycleGeneration: event.lifecycleGeneration }
              : {}),
            ...(event.type === "user-input.requested"
              ? { questions: event.payload.questions }
              : { answers: event.payload.answers }),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.started": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "task.started",
          summary:
            event.payload.taskType === "plan"
              ? "Plan task started"
              : event.payload.taskType
                ? `${event.payload.taskType} task started`
                : "Task started",
          payload: toActivityPayload({
            taskId: event.payload.taskId,
            ...(event.payload.taskType ? { taskType: event.payload.taskType } : {}),
            ...(event.payload.subagentType ? { subagentType: event.payload.subagentType } : {}),
            ...(event.payload.workflowName ? { workflowName: event.payload.workflowName } : {}),
            ...(event.payload.workflowTaskId
              ? { workflowTaskId: event.payload.workflowTaskId }
              : {}),
            ...(event.payload.workflowPhases
              ? { workflowPhases: event.payload.workflowPhases }
              : {}),
            ...(event.payload.workflowAgentPhases
              ? { workflowAgentPhases: event.payload.workflowAgentPhases }
              : {}),
            ...(event.payload.workflowAgentPlans
              ? { workflowAgentPlans: event.payload.workflowAgentPlans }
              : {}),
            ...(event.payload.toolUseId ? { toolUseId: event.payload.toolUseId } : {}),
            ...(event.payload.description
              ? { detail: truncateDetail(event.payload.description) }
              : {}),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.progress": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "task.progress",
          summary: "Reasoning update",
          payload: toActivityPayload({
            taskId: event.payload.taskId,
            detail: truncateDetail(event.payload.summary ?? event.payload.description),

            description: truncateDetail(event.payload.description),
            ...(event.payload.summary ? { summary: truncateDetail(event.payload.summary) } : {}),
            ...(event.payload.lastToolName ? { lastToolName: event.payload.lastToolName } : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
            ...(event.payload.workflowTaskId
              ? { workflowTaskId: event.payload.workflowTaskId }
              : {}),
            ...(event.payload.workflowAgents
              ? { workflowAgents: event.payload.workflowAgents }
              : {}),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.completed": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: event.payload.status === "failed" ? "error" : "info",
          kind: "task.completed",
          summary:
            event.payload.status === "failed"
              ? "Task failed"
              : event.payload.status === "stopped"
                ? "Task stopped"
                : "Task completed",
          payload: toActivityPayload({
            taskId: event.payload.taskId,
            status: event.payload.status,
            ...(event.payload.summary ? { detail: truncateDetail(event.payload.summary) } : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
            ...(event.payload.workflowTaskId
              ? { workflowTaskId: event.payload.workflowTaskId }
              : {}),
            ...(event.payload.workflowAgents
              ? { workflowAgents: event.payload.workflowAgents }
              : {}),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.updated": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: event.payload.status === "failed" ? "error" : "info",
          kind: "task.updated",
          summary:
            event.payload.status === "paused"
              ? "Task paused"
              : event.payload.status === "killed"
                ? "Task killed"
                : event.payload.isBackgrounded === true
                  ? "Task moved to background"
                  : "Task updated",
          payload: toActivityPayload({
            taskId: event.payload.taskId,
            ...(event.payload.status ? { status: event.payload.status } : {}),
            ...(event.payload.isBackgrounded !== undefined
              ? { isBackgrounded: event.payload.isBackgrounded }
              : {}),
            ...(event.payload.toolUseId ? { toolUseId: event.payload.toolUseId } : {}),
            ...(event.payload.error ? { detail: truncateDetail(event.payload.error) } : {}),
            ...(event.payload.workflowTaskId
              ? { workflowTaskId: event.payload.workflowTaskId }
              : {}),
            ...(event.payload.workflowRunId ? { workflowRunId: event.payload.workflowRunId } : {}),
            ...(event.payload.workflowScriptPath
              ? { workflowScriptPath: event.payload.workflowScriptPath }
              : {}),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "turn.steered": {
      // A steer of the thread's own turn is already visible as the sent user message that produced it, so
      // an activity row would just repeat the text under the bubble. Only a subagent delivery needs its
      // own marker: it lands on the child thread, which never renders the message otherwise.
      if (event.payload.target === "turn") {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "turn.steered",
          summary: "User message delivered",
          payload: toActivityPayload({
            detail: truncateDetail(event.payload.message),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "thread.state.changed": {
      if (event.payload.state !== "compacted") {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-compaction",
          summary: "Context compacted manually",
          payload: toActivityPayload({
            state: event.payload.state,
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "thread.token-usage.updated": {
      const payload = buildContextWindowActivityPayload(event);
      if (!payload) {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-window.updated",
          summary: "Context window updated",
          payload,
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.updated":
    case "item.completed":
    case "item.started": {
      if (event.payload.itemType === "context_compaction") {
        const failed = event.type === "item.completed" && event.payload.status === "failed";
        return [
          {
            id: event.eventId,
            createdAt: event.createdAt,
            tone: failed ? "error" : "info",
            kind: "context-compaction",
            summary:
              event.type !== "item.completed"
                ? "Compacting context"
                : failed
                  ? "Context compaction failed"
                  : "Context compacted",
            payload: toActivityPayload({
              itemType: event.payload.itemType,
              status: event.payload.status,
              ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
              ...activityDataField(event.payload.data),
            }),
            turnId: toTurnId(event.turnId) ?? null,
            ...maybeSequence,
          },
        ];
      }
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      // A provider that sends a blank title must not turn into a blank summary: `??` falls back on
      // undefined only, so normalize before choosing.
      const itemTitle = nonEmptyTrimmed(event.payload.title);
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind:
            event.type === "item.started"
              ? "tool.started"
              : event.type === "item.completed"
                ? "tool.completed"
                : "tool.updated",
          summary:
            event.type === "item.started"
              ? `${itemTitle ?? "Tool"} started`
              : (itemTitle ?? (event.type === "item.completed" ? "Tool" : "Tool updated")),
          payload: toActivityPayload({
            itemType: event.payload.itemType,
            ...(event.payload.status ? { status: event.payload.status } : {}),
            ...(itemTitle ? { title: itemTitle } : {}),
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
            ...activityDataField(event.payload.data),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "tool.summary": {
      const summary = nonEmptyTrimmed(event.payload.summary);
      const toolIds = event.payload.precedingToolUseIds;
      if (!summary || !toolIds?.length || !event.turnId) return [];
      return [
        {
          id: EventId.makeUnsafe(
            `provider-tool-summary:${event.threadId}:${event.lifecycleGeneration ?? "legacy"}:${event.turnId}:${toolIds.at(-1)}`,
          ),
          createdAt: event.createdAt,
          tone: "info",
          kind: "tool.summary",
          summary: "Tool summary",
          payload: toActivityPayload({
            detail: truncateDetail(
              sanitizeUnmappedProviderDetail(summary, MAX_ACTIVITY_DATA_STRING_CHARS)!,
              MAX_ACTIVITY_DATA_STRING_CHARS,
            ),
            ...activityDataField({ precedingToolUseIds: toolIds }),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }
    case "auth.status": {
      const failed = Boolean(nonEmptyTrimmed(event.payload.error));
      if (!failed && event.payload.isAuthenticating === undefined) return [];
      return [
        {
          id: EventId.makeUnsafe(
            `provider-auth:${event.threadId}:${event.lifecycleGeneration ?? "legacy"}`,
          ),
          createdAt: event.createdAt,
          tone: failed ? "error" : "info",
          kind: "auth.status",
          summary: failed
            ? "Claude sign-in needs attention"
            : event.payload.isAuthenticating
              ? "Claude signing in"
              : "Claude sign-in finished",
          payload: {
            status: failed ? "failed" : event.payload.isAuthenticating ? "inProgress" : "completed",
            ...(failed ? { detail: "Check your Claude account in Settings." } : {}),
          },
          turnId: null,
          ...maybeSequence,
        },
      ];
    }
    case "tool.progress": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.updated",
          summary:
            nonEmptyTrimmed(event.payload.toolName) ??
            nonEmptyTrimmed(event.payload.summary) ??
            "MCP tool call",
          payload: buildToolProgressActivityPayload(event),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "turn.completed": {
      const state = runtimeTurnState(event);
      const modelUsage = compactTurnModelUsage(event.payload.modelUsage);
      const errorMessage = asString(runtimePayloadRecord(event)?.errorMessage);
      const interrupted = state === "interrupted" || state === "cancelled";
      let summary = "Turn completed";
      if (state === "failed") {
        summary = "Turn failed";
      } else if (interrupted) {
        summary = "Turn interrupted";
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: state === "failed" ? "error" : "info",
          kind: "turn.completed",
          summary,
          payload: toActivityPayload({
            state,
            ...(event.provider === "claudeAgent" ? { provider: event.provider } : {}),
            ...(event.payload.tokenAccountingVersion === 1
              ? { tokenAccountingVersion: 1, mainLoopTokens: event.payload.mainLoopTokens }
              : {}),
            ...(modelUsage ? { modelUsage } : {}),
            ...(typeof event.payload.totalCostUsd === "number"
              ? { totalCostUsd: event.payload.totalCostUsd }
              : {}),
            ...(typeof event.payload.cumulativeCostUsd === "number"
              ? { cumulativeCostUsd: event.payload.cumulativeCostUsd }
              : {}),
            ...(errorMessage ? { errorMessage } : {}),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "hook.started":
    case "hook.progress":
      return [];

    case "hook.completed": {
      const status = event.payload.status;

      if (
        event.payload.outcome === "success" ||
        (event.payload.outcome === "cancelled" && !status)
      ) {
        return [];
      }
      const hookLabel = event.payload.hookEvent ?? "Lifecycle";
      const summary =
        status === "blocked"
          ? `${hookLabel} hook blocked an action`
          : status === "stopped"
            ? `${hookLabel} hook stopped execution`
            : `${hookLabel} hook failed`;
      const message = truncateDetail(
        event.payload.statusMessage ??
          event.payload.stderr ??
          event.payload.output ??
          event.payload.stdout ??
          summary,
        500,
      );
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: status === "failed" || event.payload.outcome === "error" ? "error" : "info",
          kind: "runtime.warning",
          summary,
          payload: toActivityPayload({
            message,
            detail: message,
            hookId: event.payload.hookId,
            ...(event.payload.hookName ? { hookName: event.payload.hookName } : {}),
            ...(event.payload.hookEvent ? { hookEvent: event.payload.hookEvent } : {}),
            outcome: event.payload.outcome,
            ...(status ? { status } : {}),
            ...(event.payload.durationMs !== undefined
              ? { durationMs: event.payload.durationMs }
              : {}),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "account.rate-limits.updated": {
      const rawRateLimits = event.payload.rateLimits;
      if (!rawRateLimits || typeof rawRateLimits !== "object") {
        return [];
      }
      const rl = rawRateLimits as Record<string, unknown>;
      if (Object.keys(rl).length === 0) {
        return [];
      }
      const status = rl.status;

      const resetsAtRaw = rl.resetsAt;
      const resetsAt =
        typeof resetsAtRaw === "number"
          ? new Date(resetsAtRaw * 1000).toISOString()
          : typeof resetsAtRaw === "string"
            ? resetsAtRaw
            : undefined;

      const rawLimits = Array.isArray(rl.limits) ? rl.limits : undefined;
      const limits = rawLimits
        ?.filter(
          (l): l is Record<string, unknown> =>
            l !== null &&
            typeof l === "object" &&
            typeof (l as Record<string, unknown>).window === "string",
        )
        .map((l) => {
          const lResetsAtRaw = l.resetsAt;
          const lResetsAt =
            typeof lResetsAtRaw === "number"
              ? new Date(lResetsAtRaw * 1000).toISOString()
              : typeof lResetsAtRaw === "string"
                ? lResetsAtRaw
                : undefined;
          const limit = { window: l.window as string } as {
            window: string;
            utilization?: number;
            resetsAt?: string;
          };
          if (typeof l.utilization === "number") {
            limit.utilization = l.utilization;
          }
          if (lResetsAt) {
            limit.resetsAt = lResetsAt;
          }
          return limit;
        });
      const normalizedPayload = {
        provider: event.provider,
        ...rl,
        ...(resetsAt ? { resetsAt } : {}),
        ...(typeof rl.utilization === "number" ? { utilization: rl.utilization } : {}),
        ...(limits && limits.length > 0 ? { limits } : {}),
      };
      const activities: OrchestrationThreadActivity[] = [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "account.rate-limits.updated",
          summary: "Rate limits updated",
          payload: toActivityPayload(normalizedPayload),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
      if (status !== "rejected" && status !== "allowed_warning") {
        return activities;
      }
      return [
        ...activities,
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: (status === "rejected" ? "error" : "info") as "error" | "info",
          kind: "account.rate-limited",
          summary: status === "rejected" ? "Rate limited" : "Approaching rate limit",
          payload: toActivityPayload({
            ...normalizedPayload,
            status,
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "event.unmapped": {
      const payload = runtimePayloadRecord(event);
      const nativeType = asString(payload?.nativeType);
      if (!nativeType) {
        return [];
      }
      const detail = asString(payload?.detail);
      const rawData = payload?.data;
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "provider.event.unmapped",
          summary: nativeType,
          payload: toActivityPayload({
            nativeEventType: nativeType,
            ...(detail ? { detail: sanitizeUnmappedProviderDetail(detail) } : {}),
            ...(rawData !== undefined ? { data: sanitizeUnmappedProviderData(rawData) } : {}),
          }),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    default:
      break;
  }

  return [];
}

export function providerActivityUpdateDedupeKey(
  event: ProviderRuntimeEvent,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
): string | undefined {
  const prefix = `${threadId}:${event.provider}:${activity.kind}`;
  if (
    activity.kind === "context-window.updated" ||
    activity.kind === "account.rate-limits.updated"
  ) {
    return prefix;
  }

  const payload = asRecord(activity.payload) ?? undefined;
  if (activity.kind === "auth.status" || activity.kind === "tool.summary")
    return `${prefix}:${activity.id}`;
  if (activity.kind === "task.progress") {
    if (
      event.itemId &&
      (event.type === "item.updated" || event.type === "item.completed") &&
      event.payload.itemType === "reasoning"
    )
      return `${prefix}:reasoning:${event.itemId}`;
    const taskId = asString(payload?.taskId);
    return taskId ? `${prefix}:${taskId}` : undefined;
  }
  if (activity.kind !== "tool.updated") {
    return undefined;
  }

  const data = asRecord(payload?.data) ?? undefined;
  const toolUpdateId =
    event.itemId ??
    asString(data?.toolUseId) ??
    asString(data?.toolCallId) ??
    asString(data?.callId) ??
    asString(data?.callID);
  return toolUpdateId ? `${prefix}:${toolUpdateId}` : undefined;
}

export function providerActivityUpdateFingerprint(activity: OrchestrationThreadActivity): string {
  return stringifyJsonLike({
    kind: activity.kind,
    summary: activity.summary,
    payload: activity.payload,
    turnId: activity.turnId,
  });
}
