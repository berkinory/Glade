import {
  OrchestrationMessage,
  OrchestrationThread,
  OrchestrationCheckpointSummary,
} from "@glade/contracts/orchestration/threadEntities";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { Effect } from "effect";
import {
  ThreadTurnDiffCompletedPayload,
  ThreadRevertedPayload,
  ThreadConversationRolledBackPayload,
} from "../Schemas.ts";
import { maxIso } from "../turnLifecycle.ts";
import { clearRemovedAsyncUserInputResponses } from "@glade/shared/threads/asyncUserInput";
import {
  ProjectionEffect,
  decodeForEvent,
  updateThread,
  MAX_THREAD_MESSAGES,
} from "./projectionState";

const MAX_THREAD_CHECKPOINTS = 500;

function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") return "error" as const;
  if (status === "missing") return "interrupted" as const;
  return "completed" as const;
}

function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<OrchestrationMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ReadonlyArray<OrchestrationMessage> {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationThread["activities"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["activities"][number]> {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function rollbackThreadMessagesFromMessage(
  messages: ReadonlyArray<OrchestrationMessage>,
  messageId: string,
): {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly removedTurnIds: ReadonlySet<string>;
} {
  const targetIndex = messages.findIndex((message) => message.id === messageId);
  if (targetIndex < 0) {
    return { messages, removedTurnIds: new Set() };
  }

  const removedMessages = messages.slice(targetIndex);
  return {
    messages: messages.slice(0, targetIndex),
    removedTurnIds: new Set(
      removedMessages.flatMap((message) =>
        message.role === "system" || message.turnId === null ? [] : [message.turnId],
      ),
    ),
  };
}

export function projectHistoryEvent(
  nextBase: OrchestrationReadModel,
  event: Extract<
    OrchestrationEvent,
    { type: "thread.turn-diff-completed" | "thread.reverted" | "thread.conversation-rolled-back" }
  >,
  historyLimit?: number,
): ProjectionEffect {
  switch (event.type) {
    case "thread.turn-diff-completed":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadTurnDiffCompletedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const checkpoint = yield* decodeForEvent(
          OrchestrationCheckpointSummary,
          {
            turnId: payload.turnId,
            checkpointTurnCount: payload.checkpointTurnCount,
            checkpointRef: payload.checkpointRef,
            status: payload.status,
            files: payload.files,
            assistantMessageId: payload.assistantMessageId,
            completedAt: payload.completedAt,
          },
          event.type,
          "checkpoint",
        );

        const existing = thread.checkpoints.find((entry) => entry.turnId === checkpoint.turnId);
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return nextBase;
        }

        const checkpoints = [
          ...thread.checkpoints.filter((entry) => entry.turnId !== checkpoint.turnId),
          checkpoint,
        ]
          .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
          .slice(-(historyLimit ?? MAX_THREAD_CHECKPOINTS));

        // Turn-diff placeholders can fire before the assistant message is finalized — they must not erase a
        // real id that thread.message-sent has already recorded.
        const preservedAssistantMessageId =
          payload.assistantMessageId ??
          (thread.latestTurn?.turnId === payload.turnId
            ? thread.latestTurn.assistantMessageId
            : null);
        const previousLatestCheckpointTurnCount = thread.checkpoints.find(
          (entry) => entry.turnId === thread.latestTurn?.turnId,
        )?.checkpointTurnCount;
        const preservesNewerLatestTurn =
          payload.preserveLatestTurn === true ||
          (previousLatestCheckpointTurnCount !== undefined &&
            previousLatestCheckpointTurnCount > payload.checkpointTurnCount);
        const matchingLatestTurn =
          thread.latestTurn?.turnId === payload.turnId ? thread.latestTurn : null;
        const latestTurn = preservesNewerLatestTurn
          ? thread.latestTurn
          : matchingLatestTurn !== null
            ? {
                // Checkpoints describe filesystem state; the provider session is the lifecycle authority. In
                // particular, a successful empty git capture must not turn an interrupted, answer-less turn into a
                // completed one merely because both checkpoint commands and runtime ingestion subscribe to the same
                // terminal event.
                ...matchingLatestTurn,
                assistantMessageId: preservedAssistantMessageId,
              }
            : {
                turnId: payload.turnId,
                state: checkpointStatusToLatestTurnState(payload.status),
                requestedAt: payload.completedAt,
                startedAt: payload.completedAt,
                completedAt: payload.completedAt,
                assistantMessageId: preservedAssistantMessageId,
              };

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            checkpoints,
            latestTurn,
            updatedAt: maxIso(thread.updatedAt, event.occurredAt),
          }),
        };
      });
    case "thread.reverted":
      return decodeForEvent(ThreadRevertedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const checkpoints = thread.checkpoints
            .filter((entry) => entry.checkpointTurnCount <= payload.turnCount)
            .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
            .slice(-(historyLimit ?? MAX_THREAD_CHECKPOINTS));
          const retainedTurnIds = new Set(checkpoints.map((checkpoint) => checkpoint.turnId));
          const retainedMessages = retainThreadMessagesAfterRevert(
            thread.messages,
            retainedTurnIds,
            payload.turnCount,
          );
          const messages = clearRemovedAsyncUserInputResponses(
            retainedMessages,
            new Set(retainedMessages.map((message) => message.id)),
            event.sequence,
          ).slice(-(historyLimit ?? MAX_THREAD_MESSAGES));

          const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);

          const latestCheckpoint = checkpoints.at(-1) ?? null;
          const latestTurn =
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId,
                };

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              checkpoints,
              messages,

              activities,
              latestTurn,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );
    case "thread.conversation-rolled-back":
      return decodeForEvent(
        ThreadConversationRolledBackPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          if (payload.numTurns === 0 && payload.replacementText === undefined) {
            return nextBase;
          }
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const rollback = rollbackThreadMessagesFromMessage(thread.messages, payload.messageId);
          if (rollback.messages === thread.messages) {
            return nextBase;
          }

          let messages = rollback.messages;
          const editedMessage = thread.messages.find((message) => message.id === payload.messageId);
          if (payload.replacementText !== undefined && editedMessage) {
            messages = [
              ...messages,
              {
                ...editedMessage,
                text: payload.replacementText,
                turnId: null,
                streaming: false,
                startsNewTurn: true,
                updatedAt: event.occurredAt,
              },
            ];
          }
          const checkpoints = thread.checkpoints
            .filter((checkpoint) => !rollback.removedTurnIds.has(checkpoint.turnId))
            .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
            .slice(-(historyLimit ?? MAX_THREAD_CHECKPOINTS));

          const activities = thread.activities.filter(
            (activity) => activity.turnId === null || !rollback.removedTurnIds.has(activity.turnId),
          );
          const latestCheckpoint = checkpoints.at(-1) ?? null;

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              checkpoints,
              messages: clearRemovedAsyncUserInputResponses(
                messages,
                new Set(messages.map((message) => message.id)),
                event.sequence,
              ).slice(-(historyLimit ?? MAX_THREAD_MESSAGES)),

              activities,
              latestTurn:
                latestCheckpoint === null
                  ? null
                  : {
                      turnId: latestCheckpoint.turnId,
                      state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                      requestedAt: latestCheckpoint.completedAt,
                      startedAt: latestCheckpoint.completedAt,
                      completedAt: latestCheckpoint.completedAt,
                      assistantMessageId: latestCheckpoint.assistantMessageId,
                    },
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );
  }
}
