import { VISUAL_REPLY_ACTIVITY_KIND } from "@glade/contracts/orchestration/visualReply";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { Effect } from "effect";
import { requireThread, requireThreadNotArchived } from "../commandInvariants.ts";
import { resolveStableMessageTurnId } from "../messageTurnId.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import {
  CommandDecisionInput,
  CommandDecisionEffect,
  withEventBase,
  userMessageUpsertEvent,
  checkpointRevertSucceededEvent,
} from "./commandEvents";

export function decideTranscriptCommand({
  command,
  readModel,
}: CommandDecisionInput<
  Extract<
    OrchestrationCommand,
    {
      type:
        | "thread.message.assistant.delta"
        | "thread.message.assistant.complete"
        | "thread.message.user.bind-turn"
        | "thread.message.user.set-turn-boundary"
        | "thread.turn.diff.complete"
        | "thread.activity.append";
    }
  >
>): CommandDecisionEffect {
  return Effect.gen(function* () {
    switch (command.type) {
      case "thread.message.assistant.delta": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const existingMessage = thread.messages.find((message) => message.id === command.messageId);
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.message-sent",
          payload: {
            threadId: command.threadId,
            messageId: command.messageId,
            modelSelection: existingMessage?.modelSelection ?? thread.modelSelection,
            role: "assistant",
            text: command.delta,
            ...(command.segmentStartedAt ? { segmentStartedAt: command.segmentStartedAt } : {}),
            ...(command.segmentSequence !== undefined
              ? { segmentSequence: command.segmentSequence }
              : {}),
            turnId: resolveStableMessageTurnId({
              existingTurnId: existingMessage?.turnId,
              incomingTurnId: command.turnId,
            }),
            streaming: true,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      }
      case "thread.message.assistant.complete": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const existingMessage = thread.messages.find((message) => message.id === command.messageId);
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.message-sent",
          payload: {
            threadId: command.threadId,
            messageId: command.messageId,
            modelSelection: existingMessage?.modelSelection ?? thread.modelSelection,
            ...((command.providerMessageId ?? existingMessage?.providerMessageId)
              ? {
                  providerMessageId:
                    command.providerMessageId ?? existingMessage?.providerMessageId,
                }
              : {}),
            role: "assistant",
            text: existingMessage?.text ?? "",
            ...(command.asyncQuestions
              ? {
                  asyncUserInput: existingMessage?.asyncUserInput ?? {
                    questions: command.asyncQuestions,
                  },
                }
              : {}),
            turnId: resolveStableMessageTurnId({
              existingTurnId: existingMessage?.turnId,
              incomingTurnId: command.turnId,
            }),
            streaming: false,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      }
      case "thread.message.user.bind-turn": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const message = thread.messages.find((entry) => entry.id === command.messageId);
        if (!message || message.role !== "user") {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `User message '${command.messageId}' does not exist on thread '${command.threadId}'.`,
          });
        }
        if (
          message.turnId !== null &&
          message.turnId !== undefined &&
          message.turnId !== command.turnId
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `User message '${command.messageId}' is already bound to turn '${message.turnId}'.`,
          });
        }

        return userMessageUpsertEvent({
          commandId: command.commandId,
          threadId: command.threadId,
          message,
          turnId: command.turnId,
          occurredAt: command.createdAt,
        });
      }
      case "thread.message.user.set-turn-boundary": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const message = thread.messages.find((entry) => entry.id === command.messageId);
        if (!message || message.role !== "user") {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `User message '${command.messageId}' does not exist on thread '${command.threadId}'.`,
          });
        }
        return userMessageUpsertEvent({
          commandId: command.commandId,
          threadId: command.threadId,
          message,
          turnId: message.turnId,
          startsNewTurn: command.startsNewTurn,
          occurredAt: command.createdAt,
        });
      }

      case "thread.turn.diff.complete": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const diffCompletedEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.turn-diff-completed",
          payload: {
            threadId: command.threadId,
            turnId: command.turnId,
            checkpointTurnCount: command.checkpointTurnCount,
            checkpointRef: command.checkpointRef,
            status: command.status,
            files: command.files,
            assistantMessageId: command.assistantMessageId ?? null,
            completedAt: command.completedAt,
            ...(command.preserveLatestTurn ? { preserveLatestTurn: true } : {}),
          },
        };
        return command.checkpointRevertTurnCount === undefined
          ? diffCompletedEvent
          : [
              diffCompletedEvent,
              checkpointRevertSucceededEvent({
                commandId: command.commandId,
                threadId: command.threadId,
                turnCount: command.checkpointRevertTurnCount,
                createdAt: command.createdAt,
                causationEventId: diffCompletedEvent.eventId,
              }),
            ];
      }
      case "thread.activity.append": {
        const thread = yield* (
          command.requireUnarchived ? requireThreadNotArchived : requireThread
        )({
          readModel,
          command,
          threadId: command.threadId,
        });
        const activity = command.activity;
        if (
          activity.kind === VISUAL_REPLY_ACTIVITY_KIND &&
          (thread.archivedAt !== null ||
            activity.turnId === null ||
            thread.session?.activeTurnId !== activity.turnId ||
            thread.session.status !== "running")
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Visual replies require the caller's active turn in an unarchived thread.",
          });
        }
        const requestId =
          typeof activity.payload === "object" &&
          activity.payload !== null &&
          "requestId" in activity.payload &&
          typeof (activity.payload as { requestId?: unknown }).requestId === "string"
            ? ((activity.payload as { requestId: string })
                .requestId as OrchestrationEvent["metadata"]["requestId"])
            : undefined;
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            ...(requestId !== undefined ? { metadata: { requestId } } : {}),
          }),
          type: "thread.activity-appended",
          payload: {
            threadId: command.threadId,
            activity,
          },
        };
      }
    }
  });
}
