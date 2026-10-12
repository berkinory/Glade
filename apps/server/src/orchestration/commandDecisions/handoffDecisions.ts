import { Effect } from "effect";
import type {
  OrchestrationThread,
  ThreadHandoff,
} from "@glade/contracts/orchestration/threadEntities";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import {
  requireThreadNotArchived,
  threadHasCheckpointRevertInProgress,
} from "../commandInvariants";
import { OrchestrationCommandInvariantError } from "../Errors";
import { handoffTransitionActivity } from "../handoff/transitionActivity";
import { type CommandDecisionInput, withEventBase } from "./commandEvents";
import { validateAutoRuntimeMode } from "./threadConfiguration";

type HandoffCommand = Extract<
  OrchestrationCommand,
  { type: "thread.handoff.start" | "thread.handoff.cancel" }
>;

// The selection changes immediately; the continuation context is built and delivered with the next
// message, so nothing is retired until the user actually sends.
function transitionEvents(
  command: HandoffCommand,
  thread: OrchestrationThread,
  modelSelection: ModelSelection,
  handoff: ThreadHandoff,
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
      type: "thread.meta-updated",
      payload: { threadId: thread.id, modelSelection, handoff, updatedAt: command.createdAt },
    },
    {
      ...base(),
      type: "thread.activity-appended",
      payload: { threadId: thread.id, activity: handoffTransitionActivity(handoff) },
    },
  ] satisfies ReadonlyArray<Omit<OrchestrationEvent, "sequence">>;
}

// A chat whose sends never reached a provider has no provider conversation to hand off: no provider
// turn ever started, nothing came back, and no fork seeded a native session. Switching such
// a chat changes the model directly and resends its latest message. Anything else stays a handoff.
function resolveDirectProviderSwitchMessage(
  thread: OrchestrationThread,
): OrchestrationThread["messages"][number] | null {
  if (
    thread.latestTurn != null ||
    thread.parentThreadId != null ||
    thread.forkSourceThreadId != null
  ) {
    return null;
  }
  const undelivered = thread.messages.every(
    (message) =>
      message.role === "user" &&
      message.source === "native" &&
      !message.turnId &&
      !message.streaming,
  );
  const latest = thread.messages.at(-1);
  // The resend path carries text; an attachment-only message keeps the handoff.
  return undelivered && latest && latest.text.trim().length > 0 ? latest : null;
}

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
  const pending = thread.handoff?.stage === "pending" ? thread.handoff : undefined;
  if (
    thread.parentThreadId !== null ||
    (!pending && thread.modelSelection.provider === command.modelSelection.provider) ||
    threadHasCheckpointRevertInProgress(thread) ||
    thread.session?.status === "running" ||
    thread.session?.status === "starting" ||
    thread.latestTurn?.state === "running" ||
    thread.pendingInteractions?.some((entry) => entry.status !== "confirmed") ||
    thread.handoff?.stage === "uncertain"
  )
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: "Finish or stop active work and resolve pending requests before changing providers.",
    });
  if (pending) {
    // Choosing the source provider again before anything was sent simply undoes the switch. Once a
    // delivery attempt parked the source, going back is itself a switch that resumes it.
    const returning =
      command.modelSelection.provider === pending.sourceModelSelection.provider &&
      pending.deliveryMessageId === undefined;
    return transitionEvents(command, thread, command.modelSelection, {
      ...pending,
      ...(returning
        ? { stage: "cancelled" as const }
        : { destinationModelSelection: command.modelSelection }),
    });
  }
  const resend = resolveDirectProviderSwitchMessage(thread);
  if (resend) return decideDirectProviderSwitch(command, thread, resend);
  return transitionEvents(command, thread, command.modelSelection, {
    operationId: command.commandId,
    stage: "pending",
    sourceModelSelection: thread.modelSelection,
    destinationModelSelection: command.modelSelection,
    createdAt: command.createdAt,
  });
});

export const decideHandoffCancel = Effect.fnUntraced(function* ({
  command,
  readModel,
}: CommandDecisionInput<Extract<OrchestrationCommand, { type: "thread.handoff.cancel" }>>) {
  const thread = yield* requireThreadNotArchived({
    readModel,
    command,
    threadId: command.threadId,
  });
  const handoff = thread.handoff;
  const deliveryInFlight =
    handoff?.deliveryMessageId !== undefined &&
    (thread.session?.status === "starting" ||
      thread.session?.status === "running" ||
      thread.latestTurn?.state === "running");
  if (
    handoff?.operationId !== command.operationId ||
    (handoff.stage !== "pending" && handoff.stage !== "uncertain") ||
    deliveryInFlight
  )
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: "The provider transition is delivering, already finished, or was replaced.",
    });
  if (handoff.stage === "pending")
    return transitionEvents(
      command,
      thread,
      handoff.sourceModelSelection,
      handoff.deliveryMessageId === undefined
        ? { ...handoff, stage: "cancelled" }
        : { ...handoff, destinationModelSelection: handoff.sourceModelSelection },
    );
  // An uncertain delivery may already run on the destination, so dismissing keeps its selection.
  return transitionEvents(command, thread, thread.modelSelection, {
    ...handoff,
    stage: "cancelled",
    detail:
      "Dismissed after uncertain delivery. The destination may have run; inspect the session and workspace before repeating actions.",
  });
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
