import { decideForkCreate } from "./forkDecisions";
import { decideHandoffCancel, decideHandoffStart } from "./handoffDecisions";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { Effect } from "effect";
import {
  requireProject,
  requireThreadAbsent,
  requireThread,
  threadHasCheckpointRevertInProgress,
  checkpointRevertDeleteInProgressDetail,
  requireThreadNotArchived,
  requireThreadArchived,
} from "../commandInvariants.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { collectSubagentDescendants } from "@glade/shared/threads/threadHierarchy";
import { PINNED_MESSAGES_MAX_COUNT } from "@glade/contracts/orchestration/threadEntities";
import {
  CommandDecisionInput,
  CommandDecisionEffect,
  withEventBase,
  nowIso,
} from "./commandEvents";
import {
  validateAutoRuntimeMode,
  resolveCreatedThreadWorkspaceMetadata,
  resolveThreadWorkspaceMetadataPatch,
} from "./threadConfiguration";

export function decideThreadLifecycleCommand({
  command,
  readModel,
}: CommandDecisionInput<
  Extract<
    OrchestrationCommand,
    {
      type:
        | "thread.create"
        | "thread.handoff.start"
        | "thread.handoff.cancel"
        | "thread.fork.create"
        | "thread.delete"
        | "thread.archive"
        | "thread.unarchive"
        | "thread.meta.update"
        | "thread.pinned-message.add"
        | "thread.pinned-message.remove"
        | "thread.pinned-message.label.set"
        | "thread.runtime-mode.set"
        | "thread.session.stop"
        | "thread.session.set";
    }
  >
>): CommandDecisionEffect {
  return Effect.gen(function* () {
    switch (command.type) {
      case "thread.create": {
        yield* requireProject({
          readModel,
          command,
          projectId: command.projectId,
        });
        yield* requireThreadAbsent({
          readModel,
          command,
          threadId: command.threadId,
        });
        // Provider-native threads mirror subagents the provider already runs; Glade never starts a session
        // for them, so the Auto-mode capability check can only reject the projection (and durably poison
        // the runtime journal replaying it), never prevent an unverified Auto session.
        if (command.creationSource !== "provider_native") {
          yield* validateAutoRuntimeMode(command, command.modelSelection, command.runtimeMode);
        }
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.created",
          payload: {
            threadId: command.threadId,
            projectId: command.projectId,
            title: command.title,
            modelSelection: command.modelSelection,
            runtimeMode: command.runtimeMode,

            ...resolveCreatedThreadWorkspaceMetadata(command),
            createBranchFlowCompleted: command.createBranchFlowCompleted,
            isPinned: command.isPinned,
            parentThreadId: command.parentThreadId,
            ...(command.creationSource !== undefined
              ? {
                  creationSource: command.creationSource,
                  sourceThreadId: command.sourceThreadId ?? null,
                  sourceTurnId: command.sourceTurnId ?? null,
                  gatewayOperationId: command.gatewayOperationId ?? null,
                  gatewayOperationIndex: command.gatewayOperationIndex ?? null,
                }
              : {}),
            subagentAgentId: command.subagentAgentId,
            subagentNickname: command.subagentNickname,
            subagentRole: command.subagentRole,
            forkSourceThreadId: null,
            lastKnownPr: command.lastKnownPr,
            handoff: null,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      }
      case "thread.handoff.start":
        return yield* decideHandoffStart({ command, readModel });
      case "thread.handoff.cancel":
        return yield* decideHandoffCancel({ command, readModel });
      case "thread.fork.create":
        return yield* decideForkCreate({ command, readModel });
      case "thread.delete": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        if (threadHasCheckpointRevertInProgress(thread)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: checkpointRevertDeleteInProgressDetail(command.threadId),
          });
        }
        const occurredAt = nowIso();
        const deleteEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "thread.deleted",
          payload: {
            threadId: command.threadId,
            deletedAt: occurredAt,
          },
        };
        return deleteEvent;
      }
      case "thread.archive": {
        yield* requireThreadNotArchived({
          readModel,
          command,
          threadId: command.threadId,
        });
        const occurredAt = nowIso();

        const subagentThreadIds = collectSubagentDescendants(readModel.threads, command.threadId)
          .filter((thread) => thread.deletedAt === null && (thread.archivedAt ?? null) === null)
          .map((thread) => thread.id);
        return [...subagentThreadIds, command.threadId].flatMap(
          (threadId): Array<Omit<OrchestrationEvent, "sequence">> => {
            const events: Array<Omit<OrchestrationEvent, "sequence">> = [];
            events.push({
              ...withEventBase({
                aggregateKind: "thread",
                aggregateId: threadId,
                occurredAt,
                commandId: command.commandId,
              }),
              type: "thread.archived",
              payload: {
                threadId,
                archivedAt: occurredAt,
                updatedAt: occurredAt,
              },
            });
            return events;
          },
        );
      }
      case "thread.unarchive": {
        yield* requireThreadArchived({
          readModel,
          command,
          threadId: command.threadId,
        });
        const occurredAt = nowIso();

        const subagentThreadIds = collectSubagentDescendants(readModel.threads, command.threadId)
          .filter((thread) => thread.deletedAt === null && (thread.archivedAt ?? null) !== null)
          .map((thread) => thread.id);
        return [...subagentThreadIds, command.threadId].map(
          (threadId): Omit<OrchestrationEvent, "sequence"> => ({
            ...withEventBase({
              aggregateKind: "thread",
              aggregateId: threadId,
              occurredAt,
              commandId: command.commandId,
            }),
            type: "thread.unarchived",
            payload: {
              threadId,
              updatedAt: occurredAt,
            },
          }),
        );
      }
      case "thread.meta.update": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });

        if (
          command.expectedHandoffOperationId !== undefined &&
          command.expectedHandoffOperationId !== thread.handoff?.operationId
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "The provider transition was replaced or cancelled.",
          });
        }
        if (
          command.modelSelection !== undefined &&
          command.modelSelection.provider !== thread.modelSelection.provider &&
          thread.messages.some(
            (message) => message.source === "native" || message.source === "async-user-input",
          ) &&
          command.expectedHandoffOperationId === undefined
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Change providers through an explicit chat handoff.",
          });
        }
        if (command.modelSelection !== undefined && thread.creationSource !== "provider_native") {
          yield* validateAutoRuntimeMode(command, command.modelSelection, thread.runtimeMode);
        }
        const occurredAt = nowIso();
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "thread.meta-updated",
          payload: {
            threadId: command.threadId,
            ...(command.title !== undefined ? { title: command.title } : {}),
            ...(command.titleSource !== undefined ? { titleSource: command.titleSource } : {}),
            ...(command.modelSelection !== undefined
              ? { modelSelection: command.modelSelection }
              : {}),
            ...resolveThreadWorkspaceMetadataPatch(command),
            ...(command.isPinned !== undefined ? { isPinned: command.isPinned } : {}),
            ...(command.isSettled !== undefined
              ? { settledAt: command.isSettled ? occurredAt : null }
              : {}),
            ...(command.parentThreadId !== undefined
              ? { parentThreadId: command.parentThreadId }
              : {}),
            ...(command.subagentAgentId !== undefined
              ? { subagentAgentId: command.subagentAgentId }
              : {}),
            ...(command.subagentNickname !== undefined
              ? { subagentNickname: command.subagentNickname }
              : {}),
            ...(command.subagentRole !== undefined ? { subagentRole: command.subagentRole } : {}),
            ...(command.handoff !== undefined ? { handoff: command.handoff } : {}),
            ...(command.lastKnownPr !== undefined ? { lastKnownPr: command.lastKnownPr } : {}),
            ...(command.pinnedMessages !== undefined
              ? { pinnedMessages: command.pinnedMessages }
              : {}),
            ...(command.notes !== undefined ? { notes: command.notes } : {}),

            updatedAt: occurredAt,
          },
        };
      }
      case "thread.pinned-message.add": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const existingPin = thread.pinnedMessages?.find(
          (pin) => pin.messageId === command.messageId,
        );
        if (!existingPin && (thread.pinnedMessages?.length ?? 0) >= PINNED_MESSAGES_MAX_COUNT) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Thread '${command.threadId}' already has the maximum of ${PINNED_MESSAGES_MAX_COUNT} pinned messages.`,
          });
        }
        const occurredAt = nowIso();
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "thread.pinned-message-added",
          payload: {
            threadId: command.threadId,
            pin: existingPin ?? {
              messageId: command.messageId,
              label: null,
              done: false,
              pinnedAt: occurredAt,
            },
            updatedAt: occurredAt,
          },
        };
      }
      case "thread.pinned-message.remove": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const occurredAt = nowIso();
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "thread.pinned-message-removed",
          payload: {
            threadId: command.threadId,
            messageId: command.messageId,
            updatedAt: occurredAt,
          },
        };
      }
      case "thread.pinned-message.label.set": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const occurredAt = nowIso();
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "thread.pinned-message-label-set",
          payload: {
            threadId: command.threadId,
            messageId: command.messageId,
            label: command.label,
            updatedAt: occurredAt,
          },
        };
      }
      case "thread.runtime-mode.set": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        yield* validateAutoRuntimeMode(command, thread.modelSelection, command.runtimeMode);
        const occurredAt = nowIso();
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "thread.runtime-mode-set",
          payload: {
            threadId: command.threadId,
            runtimeMode: command.runtimeMode,
            updatedAt: occurredAt,
          },
        };
      }
      case "thread.session.stop": {
        yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const stopEvent: Omit<OrchestrationEvent, "sequence"> = {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "thread.session-stop-requested",
          payload: {
            threadId: command.threadId,
            createdAt: command.createdAt,
          },
        };
        return stopEvent;
      }

      case "thread.session.set": {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.threadId,
        });
        const sessionChanged =
          (command.expectedSessionStatus !== undefined &&
            thread.session?.status !== command.expectedSessionStatus) ||
          (command.expectedSessionUpdatedAt !== undefined &&
            thread.session?.updatedAt !== command.expectedSessionUpdatedAt);
        if (sessionChanged) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Thread '${command.threadId}' session changed before the conditional update.`,
          });
        }
        return {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            metadata: {},
          }),
          type: "thread.session-set",
          payload: {
            threadId: command.threadId,
            session: command.session,
          },
        };
      }
    }
  });
}
