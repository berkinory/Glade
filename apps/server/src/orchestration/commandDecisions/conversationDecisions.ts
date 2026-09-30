import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import {
  collectTailTurnIds,
  resolveTailUserMessageEditTarget,
} from "@glade/shared/threads/conversationEdit";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { Effect } from "effect";
import {
  requireThread,
  threadHasInFlightTurn,
  checkpointRevertActiveTurnDetail,
  threadHasCheckpointRevertInProgress,
  checkpointRevertInProgressDetail,
  CHECKPOINT_REVERT_STARTED_ACTIVITY_KIND,
} from "../commandInvariants.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { EventId, TurnId } from "@glade/contracts/core/baseSchemas";
import { computerActivationMetadata } from "../../computer/computerActivation.ts";
import {
  CommandDecisionInput,
  CommandDecisionEffect,
  withEventBase,
  checkpointRevertSucceededEvent,
} from "./commandEvents";
import { validateAutoRuntimeMode } from "./threadConfiguration";

function deriveConversationRollbackTarget(
  messages: OrchestrationReadModel["threads"][number]["messages"],
  messageId: string,
): {
  readonly role: OrchestrationReadModel["threads"][number]["messages"][number]["role"];
  readonly removedTurnIds: ReadonlySet<string>;
} | null {
  const targetIndex = messages.findIndex((message) => message.id === messageId);
  if (targetIndex < 0) {
    return null;
  }

  return {
    role: messages[targetIndex]!.role,
    removedTurnIds: new Set(collectTailTurnIds({ messages, messageId })),
  };
}

export function decideConversationCommand({
  command,
  readModel,
}: CommandDecisionInput<
  Extract<
    OrchestrationCommand,
    {
      type:
        | "thread.checkpoint.revert"
        | "thread.conversation.rollback"
        | "thread.message.edit-and-resend"
        | "thread.revert.complete"
        | "thread.conversation.rollback.complete";
    }
  >
>): CommandDecisionEffect {
  return Effect.gen(function* () {
    switch (command.type) {
      case "thread.checkpoint.revert": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        if (threadHasInFlightTurn(thread)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: checkpointRevertActiveTurnDetail(command.threadId),
          });
        }
        if (threadHasCheckpointRevertInProgress(thread)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: checkpointRevertInProgressDetail(command.threadId),
          });
        }
        const startedEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.activity-appended",
          payload: {
            threadId: command.threadId,
            activity: {
              id: EventId.makeUnsafe(crypto.randomUUID()),
              tone: "info",
              kind: CHECKPOINT_REVERT_STARTED_ACTIVITY_KIND,
              summary: "Checkpoint revert started",
              payload: {
                turnCount: command.turnCount,
                scope: command.scope ?? "thread",
              },
              turnId: null,
              createdAt: command.createdAt,
            },
          },
        };
        const requestedEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.checkpoint-revert-requested",
          payload: {
            threadId: command.threadId,
            turnCount: command.turnCount,
            scope: command.scope ?? "thread",
            createdAt: command.createdAt,
          },
        };
        return [startedEvent, requestedEvent];
      }
      case "thread.conversation.rollback": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        if (threadHasCheckpointRevertInProgress(thread)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: checkpointRevertInProgressDetail(command.threadId),
          });
        }
        const rollbackTarget = deriveConversationRollbackTarget(thread.messages, command.messageId);
        if (!rollbackTarget || rollbackTarget.role !== "user") {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Conversation rollback must target an existing user message.",
          });
        }
        if (command.numTurns <= 0 || rollbackTarget.removedTurnIds.size !== command.numTurns) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Conversation rollback requested ${command.numTurns} turn(s), but target message '${command.messageId}' would remove ${rollbackTarget.removedTurnIds.size} turn(s).`,
          });
        }
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.conversation-rollback-requested",
          payload: {
            threadId: command.threadId,
            messageId: command.messageId,
            numTurns: command.numTurns,
            createdAt: command.createdAt,
          },
        };
      }
      case "thread.message.edit-and-resend": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        if (threadHasCheckpointRevertInProgress(thread)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: checkpointRevertInProgressDetail(command.threadId),
          });
        }
        yield* validateAutoRuntimeMode(
          command,
          command.modelSelection ?? thread.modelSelection,
          command.runtimeMode,
        );
        const editTarget = resolveTailUserMessageEditTarget({
          messages: thread.messages,
          messageId: command.messageId,
          activeTurnId:
            thread.session?.status === "running" ? (thread.session.activeTurnId ?? null) : null,
        });
        if (!editTarget.editable) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Only the latest rollbackable user message can be edited and resent (${editTarget.reason}).`,
          });
        }
        const requestedEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.message-edit-resend-requested",
          payload: {
            threadId: command.threadId,
            messageId: command.messageId,
            text: command.text,
            rollbackTurnCount: editTarget.rollbackTurnCount,
            removedTurnIds: editTarget.removedTurnIds.map((turnId) => TurnId.makeUnsafe(turnId)),
            ...(command.modelSelection !== undefined
              ? { modelSelection: command.modelSelection }
              : {}),
            ...(command.providerOptions !== undefined
              ? { providerOptions: command.providerOptions }
              : {}),
            ...computerActivationMetadata({ ...command, userMessageText: command.text }),
            ...(command.assistantDeliveryMode !== undefined
              ? { assistantDeliveryMode: command.assistantDeliveryMode }
              : {}),
            runtimeMode: command.runtimeMode,

            createdAt: command.createdAt,
          },
        };
        if (thread.session?.status === "starting" || thread.session?.status === "running") {
          return requestedEvent;
        }
        const startingSessionEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.session-set",
          payload: {
            threadId: command.threadId,
            session: {
              threadId: command.threadId,
              status: "starting",
              providerName: thread.session?.providerName ?? thread.modelSelection.provider,
              runtimeMode: command.runtimeMode,
              activeTurnId: null,
              lastError: null,
              updatedAt: command.createdAt,
            },
          },
        };
        return [
          startingSessionEvent,
          { ...requestedEvent, causationEventId: startingSessionEvent.eventId },
        ];
      }
      case "thread.revert.complete": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const revertedEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.reverted",
          payload: {
            threadId: command.threadId,
            turnCount: command.turnCount,
          },
        };
        return [
          revertedEvent,
          checkpointRevertSucceededEvent({
            commandId: command.commandId,
            threadId: command.threadId,
            turnCount: command.turnCount,
            createdAt: command.createdAt,
            causationEventId: revertedEvent.eventId,
          }),
        ];
      }
      case "thread.conversation.rollback.complete": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.conversation-rolled-back",
          payload: {
            threadId: command.threadId,
            messageId: command.messageId,
            numTurns: command.numTurns,
            ...(command.removedTurnIds !== undefined
              ? { removedTurnIds: command.removedTurnIds }
              : {}),
            ...(command.skipAttachmentPrune !== undefined
              ? { skipAttachmentPrune: command.skipAttachmentPrune }
              : {}),
            ...(command.replacementText !== undefined
              ? { replacementText: command.replacementText }
              : {}),
          },
        };
      }
    }
  });
}
