import { Effect } from "effect";
import type { ProviderForkPoint } from "@glade/contracts/provider/provider";
import { providerCapabilities } from "@glade/shared/provider/providerMetadata";
import { EventId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import {
  listThreadsByProjectId,
  requireProject,
  requireThread,
  requireThreadAbsent,
} from "../commandInvariants.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import {
  forkMessageAttachment,
  forkMessageId,
  forkVisualReplyPayload,
  selectForkImport,
} from "../forkImport.ts";
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
  // A turn still running is not settled in the provider's history yet: forking inside it would copy a
  // half-written turn, such as a tool call without its result. Earlier turns are settled and safe.
  const runningTurnId =
    sourceThread.session?.activeTurnId ??
    (sourceThread.latestTurn?.state === "running" ? sourceThread.latestTurn.turnId : null);
  if (forkMessage.turnId !== null && forkMessage.turnId === runningTurnId) {
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: "This reply is still running. Fork from it once its turn finishes.",
    });
  }
  const provider = sourceThread.modelSelection.provider;
  const forkBoundary = providerCapabilities(provider).forkBoundary;
  const forkPoint: ProviderForkPoint | undefined =
    forkBoundary === "turn" && forkMessage.turnId
      ? { provider, turnId: forkMessage.turnId }
      : forkBoundary === "message" && forkMessage.providerMessageId
        ? { provider, messageId: forkMessage.providerMessageId }
        : undefined;
  // A transcript fork has no native boundary: the fork's first session starts fresh and carries the
  // copied conversation as transcript context.
  if (!forkPoint && forkBoundary !== "transcript")
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: "This message has no recorded native fork identifier.",
    });
  const laterNativeMessage =
    forkPoint !== undefined &&
    sourceThread.messages
      .slice(forkIndex + 1)
      .some((message) =>
        "turnId" in forkPoint
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
      ...(forkPoint ? { forkPoint } : {}),
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
        messageId: forkMessageId(command.threadId, message.id),
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

  const importedPinEvents = forkImport.pins.map(
    (pin): Omit<OrchestrationEvent, "sequence"> => ({
      ...base(),
      type: "thread.pinned-message-added",
      payload: {
        threadId: command.threadId,
        pin: { ...pin, messageId: forkMessageId(command.threadId, pin.messageId) },
        updatedAt: command.createdAt,
      },
    }),
  );

  return [
    createdEvent,
    ...importedMessageEvents,
    ...importedVisualReplyEvents,
    ...importedPinEvents,
  ];
});
