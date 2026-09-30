import { compactionBlockedReason } from "../compactionPolicy.ts";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { Effect } from "effect";
import {
  requireThread,
  threadResumePreconditionViolation,
  threadResumePreconditionDetail,
  threadHasCheckpointRevertInProgress,
  checkpointRevertInProgressDetail,
  requireApprovalNotResponded,
} from "../commandInvariants.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import {
  ASYNC_USER_INPUT_ALREADY_ANSWERED,
  formatAsyncUserInputResponse,
} from "@glade/shared/threads/asyncUserInput";
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@glade/contracts/orchestration/threadEntities";
import { providerSupportsNativeTurnSteering } from "@glade/shared/provider/providerMetadata";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { computerActivationMetadata } from "../../computer/computerActivation.ts";
import {
  CommandDecisionInput,
  CommandDecisionEffect,
  withEventBase,
  DEFAULT_ASSISTANT_DELIVERY_MODE,
} from "./commandEvents";
import { validateAutoRuntimeMode } from "./threadConfiguration";

function omitNullUserInputAnswers(
  command: Extract<OrchestrationCommand, { type: "thread.user-input.respond" }>,
) {
  return Object.fromEntries(
    Object.entries(command.answers).filter(([, answer]) => answer !== null && answer !== undefined),
  );
}

export function decideTurnCommand({
  command,
  readModel,
}: CommandDecisionInput<
  Extract<
    OrchestrationCommand,
    {
      type:
        | "thread.turn.start"
        | "thread.legacy-cache.abandon"
        | "thread.turn.dispatch-queued"
        | "thread.compact"
        | "thread.turn.interrupt"
        | "thread.task.stop"
        | "thread.task.background"
        | "thread.approval.respond"
        | "thread.user-input.respond";
    }
  >
>): CommandDecisionEffect {
  return Effect.gen(function* () {
    switch (command.type) {
      case "thread.turn.start": {
        const targetThread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        if (command.resumePrecondition !== undefined) {
          const violation = threadResumePreconditionViolation(
            targetThread,
            command.resumePrecondition,
          );
          if (violation !== null) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: threadResumePreconditionDetail(command.threadId, violation),
            });
          }
        }
        if (threadHasCheckpointRevertInProgress(targetThread)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: checkpointRevertInProgressDetail(command.threadId),
          });
        }

        const questionResponse = command.asyncUserInputResponse;
        const questionMessage = questionResponse
          ? targetThread.messages.find((message) => message.id === questionResponse.messageId)
          : undefined;
        if (questionResponse) {
          if (
            !questionMessage?.asyncUserInput ||
            questionMessage.role !== "assistant" ||
            targetThread.modelSelection.provider !== "codex" ||
            (targetThread.session?.providerName != null &&
              targetThread.session.providerName !== "codex") ||
            (command.modelSelection && command.modelSelection.provider !== "codex") ||
            targetThread.parentThreadId !== null
          ) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "This asynchronous question is unavailable in this Codex thread.",
            });
          }

          if (questionMessage.asyncUserInput.response) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: ASYNC_USER_INPUT_ALREADY_ANSWERED,
            });
          }
          if (
            questionResponse.answers.length !== questionMessage.asyncUserInput.questions.length ||
            targetThread.messages.some((message) => message.id === command.message.messageId)
          ) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "Provide one answer per question and a new response message id.",
            });
          }
        }
        const messageText =
          questionResponse && questionMessage?.asyncUserInput
            ? formatAsyncUserInputResponse(
                questionMessage.asyncUserInput.questions,
                questionResponse.answers,
              )
            : command.message.text;
        if (messageText.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "The question response exceeds the maximum message length.",
          });
        }

        const runtimeMode =
          command.resumePrecondition === undefined && !questionResponse
            ? command.runtimeMode
            : targetThread.runtimeMode;

        yield* validateAutoRuntimeMode(
          command,
          command.modelSelection ?? targetThread.modelSelection,
          runtimeMode,
        );
        const dispatchMode = questionResponse ? "steer" : (command.dispatchMode ?? "queue");

        const activeProvider =
          targetThread.session?.providerName ?? targetThread.modelSelection.provider;
        const isThreadRunning =
          targetThread.session?.status === "running" && targetThread.session.activeTurnId !== null;
        // Subagent threads never queue: their messages steer the running child task through the parent
        // session, so deferring until the turn settles would deliver the message only after the subagent
        // already finished.
        const shouldQueue =
          targetThread.parentThreadId === null &&
          (targetThread.claudeCacheReview != null ||
            (isThreadRunning &&
              (dispatchMode === "queue" || !providerSupportsNativeTurnSteering(activeProvider))));
        const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.message-sent",
          payload: {
            threadId: command.threadId,
            messageId: command.message.messageId,
            role: "user",
            text: messageText,
            attachments: command.message.attachments,
            ...(command.message.skills !== undefined ? { skills: command.message.skills } : {}),
            ...(command.message.mentions !== undefined
              ? { mentions: command.message.mentions }
              : {}),
            dispatchMode,
            // Explicit "user" (not absent): edit-resends replay through a fresh server-side turn.start without
            // an origin, and the projection upsert coalesces absent origins — a human resend of a message
            // originally dispatched by an automation/agent must overwrite the stale origin instead of
            // inheriting it.
            dispatchOrigin: command.dispatchOrigin ?? "user",
            startsNewTurn: dispatchMode !== "steer" || !isThreadRunning || shouldQueue,
            turnId: null,
            streaming: false,
            source: questionResponse ? "async-user-input" : "native",
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
        const turnRequestPayload = {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.providerOptions !== undefined
            ? { providerOptions: command.providerOptions }
            : {}),
          ...(command.reviewTarget !== undefined ? { reviewTarget: command.reviewTarget } : {}),
          ...computerActivationMetadata({ ...command, userMessageText: command.message.text }),
          assistantDeliveryMode: command.assistantDeliveryMode ?? DEFAULT_ASSISTANT_DELIVERY_MODE,
          dispatchMode,
          dispatchOrigin: command.dispatchOrigin ?? "user",
          runtimeMode,

          createdAt: command.createdAt,
        } as const;
        const queuedEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          causationEventId: userMessageEvent.eventId,
          type: shouldQueue ? "thread.turn-queued" : "thread.turn-start-requested",
          payload: turnRequestPayload,
        };
        if (shouldQueue && dispatchMode === "steer" && targetThread.claudeCacheReview == null) {
          return [
            userMessageEvent,
            queuedEvent,
            {
              ...withEventBase({
                aggregateKind: "thread",
                aggregateId: command.threadId,
                occurredAt: command.createdAt,
                commandId: command.commandId,
              }),
              causationEventId: queuedEvent.eventId,
              type: "thread.turn-interrupt-requested",
              payload: {
                threadId: command.threadId,
                turnId: targetThread.session?.activeTurnId ?? undefined,
                createdAt: command.createdAt,
              },
            },
          ];
        }
        if (questionResponse && questionMessage?.asyncUserInput) {
          return [
            {
              ...withEventBase({
                aggregateKind: "thread",
                aggregateId: command.threadId,
                occurredAt: command.createdAt,
                commandId: command.commandId,
              }),
              type: "thread.async-user-input-answered",
              payload: {
                threadId: command.threadId,
                messageId: questionMessage.id,
                response: {
                  messageId: command.message.messageId,
                  answers: questionResponse.answers,
                },
              },
            },
            userMessageEvent,
            queuedEvent,
          ];
        }
        return [userMessageEvent, queuedEvent];
      }
      case "thread.legacy-cache.abandon": {
        const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
        if (thread.claudeCacheReview?.reviewId !== command.reviewId) return [];
        const base = {
          aggregateKind: "thread" as const,
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        };
        return [
          {
            ...withEventBase(base),
            type: "thread.claude-cache-set",
            payload: {
              threadId: command.threadId,
              review: null,
              updatedAt: command.createdAt,
            },
          },
          {
            ...withEventBase(base),
            type: "thread.legacy-cache-abandoned",
            payload: {
              threadId: command.threadId,
              reviewId: command.reviewId,
              createdAt: command.createdAt,
            },
          },
        ];
      }
      case "thread.turn.dispatch-queued": {
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
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.turn-start-requested",
          payload: {
            threadId: command.threadId,
            messageId: command.messageId,
            ...(command.modelSelection !== undefined
              ? { modelSelection: command.modelSelection }
              : {}),
            ...(command.providerOptions !== undefined
              ? { providerOptions: command.providerOptions }
              : {}),
            ...(command.reviewTarget !== undefined ? { reviewTarget: command.reviewTarget } : {}),
            ...computerActivationMetadata(command),
            assistantDeliveryMode: command.assistantDeliveryMode ?? DEFAULT_ASSISTANT_DELIVERY_MODE,
            dispatchMode: command.dispatchMode ?? "queue",
            dispatchOrigin: command.dispatchOrigin ?? "user",
            runtimeMode: command.runtimeMode,

            createdAt: command.createdAt,
          },
        };
      }
      case "thread.compact": {
        const thread = yield* requireThread({ readModel, command, threadId: command.threadId });
        const detail = compactionBlockedReason(thread);
        if (detail)
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail,
          });
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.compact-requested",
          payload: {
            threadId: command.threadId,
            instructions: command.instructions,
            createdAt: command.createdAt,
          },
        };
      }
      case "thread.turn.interrupt": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const interruptEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.turn-interrupt-requested",
          payload: {
            threadId: command.threadId,
            ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
            createdAt: command.createdAt,
          },
        };
        return interruptEvent;
      }
      case "thread.task.stop": {
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
          type: "thread.task-stop-requested",
          payload: {
            threadId: command.threadId,
            taskId: command.taskId,
            createdAt: command.createdAt,
          },
        };
      }
      case "thread.task.background": {
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
          type: "thread.task-background-requested",
          payload: {
            threadId: command.threadId,
            toolUseId: command.toolUseId,
            createdAt: command.createdAt,
          },
        };
      }
      case "thread.approval.respond": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        yield* requireApprovalNotResponded({
          readModel,
          command,
          threadId: command.threadId,
          requestId: command.requestId,
          ...(command.lifecycleGeneration !== undefined
            ? { lifecycleGeneration: command.lifecycleGeneration }
            : {}),
        });
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            metadata: {
              requestId: command.requestId,
            },
          }),
          type: "thread.approval-response-requested",
          payload: {
            threadId: command.threadId,
            requestId: command.requestId,
            ...(command.lifecycleGeneration !== undefined
              ? { lifecycleGeneration: command.lifecycleGeneration }
              : {}),
            decision: command.decision,
            createdAt: command.createdAt,
          },
        };
      }
      case "thread.user-input.respond": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const answers = omitNullUserInputAnswers(command);
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            metadata: {
              requestId: command.requestId,
            },
          }),
          type: "thread.user-input-response-requested",
          payload: {
            threadId: command.threadId,
            requestId: command.requestId,
            ...(command.lifecycleGeneration !== undefined
              ? { lifecycleGeneration: command.lifecycleGeneration }
              : {}),
            answers,
            createdAt: command.createdAt,
          },
        };
      }
    }
  });
}
