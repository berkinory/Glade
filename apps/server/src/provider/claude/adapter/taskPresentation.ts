import { Effect } from "effect";
import { EventId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, PROVIDER } from "./sessionTypes";
import { nativeProviderRefs } from "./messageContent";
import { normalizeClaudeTodoTasks, claudeTrackedTasksPayload } from "../claudeTaskTracker.ts";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";

export function makeClaudeTaskPresentation(input: {
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
}) {
  const { makeEventStamp, offerRuntimeEvent } = input;

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

  return {
    emitTodoTasksUpdated,
    emitTrackedTasksUpdated,
  };
}
