import { Effect } from "effect";
import { EventId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, PROVIDER } from "./sessionTypes";
import { exitPlanCaptureKey, nativeProviderRefs, asCanonicalTurnId } from "./messageContent";
import { normalizeClaudeTodoTasks, claudeTrackedTasksPayload } from "../claudeTaskTracker.ts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { subagentRunForTask, sdkNativeMethod } from "./sdkMetadata";
import { normalizeClaudeTokenUsage } from "../claudeTokenUsage.ts";
import { claudeEffectiveContextBudget } from "./modelCapabilities";
import { makeClaudeRuntimeEvents } from "./runtimeEvents";

export function makeClaudeTaskPresentation(input: {
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ReturnType<typeof makeClaudeRuntimeEvents>["offerRuntimeEvent"];
}) {
  const { makeEventStamp, offerRuntimeEvent } = input;
  const emitProposedPlanCompleted = (
    context: ClaudeSessionContext,
    input: {
      readonly planMarkdown: string;
      readonly toolUseId?: string | undefined;
      readonly rawSource: "claude.sdk.message" | "claude.sdk.permission";
      readonly rawMethod: string;
      readonly rawPayload: unknown;
    },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const turnState = context.turnState;
      const planMarkdown = input.planMarkdown.trim();
      if (!turnState || planMarkdown.length === 0) {
        return;
      }

      const captureKey = exitPlanCaptureKey({
        toolUseId: input.toolUseId,
        planMarkdown,
      });
      if (turnState.capturedProposedPlanKeys.has(captureKey)) {
        return;
      }
      turnState.capturedProposedPlanKeys.add(captureKey);

      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(context, {
        type: "turn.proposed.completed",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        turnId: turnState.turnId,
        payload: {
          planMarkdown,
        },
        providerRefs: nativeProviderRefs(context, {
          providerItemId: input.toolUseId,
        }),
        raw: {
          source: input.rawSource,
          method: input.rawMethod,
          payload: input.rawPayload,
        },
      });
    });

  const emitTodoTasksUpdated = (
    context: ClaudeSessionContext,
    input: {
      readonly toolInput: Record<string, unknown>;
      readonly toolUseId?: string | undefined;
      readonly rawMethod: string;
      readonly rawPayload: unknown;
    },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const turnState = context.turnState;
      if (!turnState) {
        return;
      }

      const tasksPayload = normalizeClaudeTodoTasks(input.toolInput);
      if (!tasksPayload) {
        return;
      }

      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(context, {
        type: "turn.tasks.updated",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        turnId: turnState.turnId,
        payload: tasksPayload,
        providerRefs: nativeProviderRefs(context, {
          providerItemId: input.toolUseId,
        }),
        raw: {
          source: "claude.sdk.message",
          method: input.rawMethod,
          payload: input.rawPayload,
        },
      });
    });

  const emitTrackedTasksUpdated = (
    context: ClaudeSessionContext,
    input: {
      readonly toolUseId?: string | undefined;
      readonly rawPayload: unknown;
    },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const turnState = context.turnState;
      if (!turnState) {
        return;
      }

      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(context, {
        type: "turn.tasks.updated",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        turnId: turnState.turnId,
        payload: claudeTrackedTasksPayload(context.trackedTasks),
        providerRefs: nativeProviderRefs(context, {
          providerItemId: input.toolUseId,
        }),
        raw: {
          source: "claude.sdk.message",
          method: "claude/user/task-result",
          payload: input.rawPayload,
        },
      });
    });

  const emitTaskUsageSnapshot = (
    context: ClaudeSessionContext,
    message: Extract<SDKMessage, { subtype: "task_progress" | "task_notification" }>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (!message.usage) {
        return;
      }
      const run = subagentRunForTask(context, message.tool_use_id, message.task_id);
      const target = run?.context ?? context;
      if (target.tokenUsageState !== "current") {
        return;
      }
      const normalizedUsage = normalizeClaudeTokenUsage(
        message.usage,
        claudeEffectiveContextBudget(target),
      );
      if (!normalizedUsage) {
        return;
      }
      target.lastKnownTokenUsage = normalizedUsage;
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent(target, {
        type: "thread.token-usage.updated",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: target.session.threadId,
        ...(target.turnState ? { turnId: asCanonicalTurnId(target.turnState.turnId) } : {}),
        payload: {
          usage: normalizedUsage,
        },
        providerRefs: nativeProviderRefs(target),
        raw: {
          source: "claude.sdk.message",
          method: sdkNativeMethod(message),
          messageType: `${message.type}:${message.subtype}`,
          payload: message,
        },
      });
    });
  return {
    emitTodoTasksUpdated,
    emitTrackedTasksUpdated,
    emitProposedPlanCompleted,
    emitTaskUsageSnapshot,
  };
}
