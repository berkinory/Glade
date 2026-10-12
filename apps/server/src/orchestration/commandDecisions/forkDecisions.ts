import { Effect } from "effect";
import { EventId, MessageId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import {
  listThreadsByProjectId,
  requireProject,
  requireThread,
  requireThreadAbsent,
} from "../commandInvariants.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { forkMessageAttachment, forkVisualReplyPayload, selectForkImport } from "../forkImport.ts";
import { buildForkThreadTitle } from "../forkThreadTitle.ts";
import { type CommandDecisionInput, withEventBase } from "./commandEvents";
import {
  resolveCreatedThreadWorkspaceMetadata,
  validateAutoRuntimeMode,
} from "./threadConfiguration";

export const decideForkCreate = Effect.fnUntraced(function* ({
  command,
  readModel,
}: CommandDecisionInput<Extract<OrchestrationCommand, { type: "thread.fork.create" }>>) {
  yield* requireProject({
    readModel,
    command,
    projectId: command.projectId,
  });
  const sourceThread = yield* requireThread({
    readModel,
    command,
    threadId: command.sourceThreadId,
  });
  yield* requireThreadAbsent({
    readModel,
    command,
    threadId: command.threadId,
  });
  yield* validateAutoRuntimeMode(command, command.modelSelection, command.runtimeMode);
  if (sourceThread.projectId !== command.projectId) {
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: `Source thread '${command.sourceThreadId}' belongs to a different project.`,
    });
  }

  const forkIndex = sourceThread.messages.findIndex(
    (message) => message.id === command.forkMessageId,
  );
  const forkMessage = sourceThread.messages[forkIndex];
  const forkImport = selectForkImport(sourceThread, command.forkMessageId);
  if (
    !forkMessage ||
    !forkImport ||
    forkMessage.streaming ||
    forkMessage.role !== "assistant" ||
    command.modelSelection.provider !== sourceThread.modelSelection.provider
  ) {
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: "Choose a completed native assistant message from the same provider.",
    });
  }
  const forkPoint =
    sourceThread.modelSelection.provider === "codex" && forkMessage.turnId
      ? { provider: "codex" as const, turnId: forkMessage.turnId }
      : sourceThread.modelSelection.provider === "claudeAgent" && forkMessage.providerMessageId
        ? { provider: "claudeAgent" as const, messageId: forkMessage.providerMessageId }
        : undefined;
  if (!forkPoint)
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: "This message has no recorded native fork identifier.",
    });
  const laterNativeMessage = sourceThread.messages
    .slice(forkIndex + 1)
    .some((message) =>
      forkPoint.provider === "codex"
        ? message.turnId === forkPoint.turnId
        : message.providerMessageId === forkPoint.messageId,
    );
  if (laterNativeMessage)
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: "Choose the final message at this native fork boundary.",
    });

  const base = () =>
    withEventBase({
      aggregateKind: "thread",
      aggregateId: command.threadId,
      occurredAt: command.createdAt,
      commandId: command.commandId,
    });
  const createdEvent: Omit<OrchestrationEvent, "sequence"> = {
    ...base(),
    type: "thread.created",
    payload: {
      threadId: command.threadId,
      projectId: command.projectId,
      title: buildForkThreadTitle(
        sourceThread,
        listThreadsByProjectId(readModel, command.projectId),
      ),
      modelSelection: command.modelSelection,
      runtimeMode: command.runtimeMode,

      ...resolveCreatedThreadWorkspaceMetadata(command),
      createBranchFlowCompleted: command.createBranchFlowCompleted,
      isPinned: false,
      parentThreadId: null,
      subagentAgentId: null,
      subagentNickname: null,
      subagentRole: null,
      forkSourceThreadId: command.sourceThreadId,
      forkPoint,
      handoff: null,
      createdAt: command.createdAt,
      updatedAt: command.createdAt,
    },
  };

  const importedMessageEvents = forkImport.messages.map(
    (message): Omit<OrchestrationEvent, "sequence"> => ({
      ...base(),
      type: "thread.message-sent",
      payload: {
        threadId: command.threadId,
        messageId: MessageId.makeUnsafe(`${command.threadId}:${message.id}`),
        ...(message.providerMessageId ? { providerMessageId: message.providerMessageId } : {}),
        role: message.role,
        ...(message.modelSelection ? { modelSelection: message.modelSelection } : {}),
        text: message.text,
        ...(message.attachments !== undefined
          ? {
              attachments: message.attachments.map((attachment) =>
                forkMessageAttachment(command.threadId, attachment),
              ),
            }
          : {}),
        turnId: message.turnId,
        streaming: false,
        source: "fork-import",
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      },
    }),
  );

  const importedVisualReplyEvents = forkImport.visualReplies.map(
    ({ activity, reply }): Omit<OrchestrationEvent, "sequence"> => ({
      ...base(),
      type: "thread.activity-appended",
      payload: {
        threadId: command.threadId,
        activity: {
          id: EventId.makeUnsafe(`${command.threadId}:${activity.id}`),
          tone: activity.tone,
          kind: activity.kind,
          summary: activity.summary,
          payload: forkVisualReplyPayload(command.threadId, reply),
          turnId: activity.turnId,
          createdAt: activity.createdAt,
        },
      },
    }),
  );

  return [createdEvent, ...importedMessageEvents, ...importedVisualReplyEvents];
});
