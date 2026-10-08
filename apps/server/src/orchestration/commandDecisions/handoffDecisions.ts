import { Effect } from "effect";
import { EventId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import { resolveDirectProviderSwitchMessage } from "@glade/shared/threads/directProviderSwitch";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import {
  requireThreadNotArchived,
  threadHasCheckpointRevertInProgress,
} from "../commandInvariants";
import { OrchestrationCommandInvariantError } from "../Errors";
import { HANDOFF_GOAL } from "../handoff/contextPolicy";
import { handoffMessageReference } from "../handoff/sourceReferences";
import { type CommandDecisionInput, withEventBase } from "./commandEvents";
import { validateAutoRuntimeMode } from "./threadConfiguration";

export const decideHandoffStart = Effect.fnUntraced(function* ({
  command,
  readModel,
}: CommandDecisionInput<Extract<OrchestrationCommand, { type: "thread.handoff.start" }>>) {
  const thread = yield* requireThreadNotArchived({
    readModel,
    command,
    threadId: command.threadId,
  });
  yield* validateAutoRuntimeMode(command, command.modelSelection, command.runtimeMode);
  if (
    thread.parentThreadId !== null ||
    thread.modelSelection.provider === command.modelSelection.provider ||
    threadHasCheckpointRevertInProgress(thread) ||
    thread.session?.status === "running" ||
    thread.session?.status === "starting" ||
    thread.latestTurn?.state === "running" ||
    thread.pendingInteractions?.some((entry) => entry.status !== "confirmed") ||
    ["preparing", "activating", "activated", "uncertain"].includes(thread.handoff?.stage ?? "")
  )
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: "Finish or stop active work and resolve pending requests before changing providers.",
    });
  const resend = resolveDirectProviderSwitchMessage(thread);
  if (resend) return decideDirectProviderSwitch(command, thread, resend);
  const messages = thread.messages.filter(
    (message) => !message.streaming && ["user", "assistant"].includes(message.role),
  );
  if (!messages.length)
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: "The chat has no completed conversation to transfer.",
    });
  const handoff = {
    operationId: command.commandId,
    ...(command.sourceGeneration !== undefined
      ? { sourceGeneration: command.sourceGeneration }
      : {}),
    stage: "preparing" as const,
    sourceThreadId: thread.id,
    sourceProvider: thread.modelSelection.provider,
    sourceModelSelection: thread.modelSelection,
    destinationModelSelection: command.modelSelection,
    destinationRuntimeMode: command.runtimeMode,
    importedAt: command.createdAt,
    bootstrapStatus: "pending" as const,
    sourceBoundarySequence: readModel.snapshotSequence,
    continuationGoal: command.continuationGoal ?? HANDOFF_GOAL,
    sourceMessages: messages.map((message) =>
      handoffMessageReference(thread, message, message.id, readModel.snapshotSequence),
    ),
  };
  const base = withEventBase({
    aggregateKind: "thread",
    aggregateId: thread.id,
    occurredAt: command.createdAt,
    commandId: command.commandId,
  });
  return [
    {
      ...base,
      type: "thread.meta-updated",
      payload: { threadId: thread.id, handoff, updatedAt: command.createdAt },
    },
    {
      ...withEventBase({
        aggregateKind: "thread",
        aggregateId: thread.id,
        occurredAt: command.createdAt,
        commandId: command.commandId,
      }),
      type: "thread.activity-appended",
      payload: {
        threadId: thread.id,
        activity: {
          id: EventId.makeUnsafe(`handoff-transition:${command.commandId}`),
          kind: "provider.transition",
          summary: `${handoff.sourceProvider === "codex" ? "Codex" : "Claude"} · ${handoff.sourceModelSelection.model} → ${command.modelSelection.provider === "codex" ? "Codex" : "Claude"} · ${command.modelSelection.model}: preparing`,
          tone: "info",
          turnId: null,
          createdAt: command.createdAt,
          payload: {
            operationId: command.commandId,
            source: { provider: thread.modelSelection.provider },
            destination: { provider: command.modelSelection.provider },
            stage: handoff.stage,
          },
        },
      },
    },
  ] satisfies ReadonlyArray<Omit<OrchestrationEvent, "sequence">>;
});

// The stopped, provider-less session row makes the reactor treat the old binding as dead, so the
// resend starts a fresh session on the new provider instead of resuming the old one.
function decideDirectProviderSwitch(
  command: Extract<OrchestrationCommand, { type: "thread.handoff.start" }>,
  thread: OrchestrationThread,
  resend: OrchestrationThread["messages"][number],
) {
  const base = () =>
    withEventBase({
      aggregateKind: "thread",
      aggregateId: thread.id,
      occurredAt: command.createdAt,
      commandId: command.commandId,
    });
  return [
    {
      ...base(),
      type: "thread.session-set",
      payload: {
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: "stopped",
          providerName: null,
          runtimeMode: command.runtimeMode,
          activeTurnId: null,
          lastError: null,
          updatedAt: command.createdAt,
        },
      },
    },
    {
      ...base(),
      type: "thread.meta-updated",
      payload: {
        threadId: thread.id,
        modelSelection: command.modelSelection,
        updatedAt: command.createdAt,
      },
    },
    {
      ...base(),
      type: "thread.message-edit-resend-requested",
      payload: {
        threadId: thread.id,
        messageId: resend.id,
        text: resend.text,
        rollbackTurnCount: 0,
        removedTurnIds: [],
        modelSelection: command.modelSelection,
        runtimeMode: command.runtimeMode,
        createdAt: command.createdAt,
      },
    },
  ] satisfies ReadonlyArray<Omit<OrchestrationEvent, "sequence">>;
}
