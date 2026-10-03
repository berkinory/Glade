import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type { OrchestrationPendingInteraction } from "@glade/contracts/orchestration/threadEntities";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { mergeAsyncUserInput } from "@glade/shared/threads/asyncUserInput";
import { resolveHumanMessageAt } from "@glade/shared/threads/threadSummary";
import { isPendingInteractionResponseClaimable } from "@glade/shared/threads/pendingInteractions";
import { isSessionRunningTurn } from "./session-logic";
import { arraysShallowEqual, providerReferenceArraysEqual } from "./storeNormalization.shared";
import { normalizeChatMessage, retainChatMessageWindow } from "./storeNormalization.messages";
import { normalizeTurnDiffFiles } from "./storeNormalization.activity";
import type { ChatMessage, Thread } from "./types";

type ThreadMessageSentEvent = Extract<OrchestrationEvent, { type: "thread.message-sent" }>;

export type ThreadActivityAppendedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.activity-appended" }
>;

type ThreadApprovalResponseRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.approval-response-requested" }
>;

type ThreadUserInputResponseRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.user-input-response-requested" }
>;

export type ApplyOrchestrationEventOptions = {
  updateSidebarSummary?: boolean;
};

type ReadModelThread =
  import("@glade/contracts/orchestration/snapshots").OrchestrationReadModel["threads"][number];

const THREAD_SUMMARY_ACTIVITY_KINDS = new Set([
  "approval.requested",
  "approval.resolved",
  "provider.approval.respond.failed",
  "user-input.requested",
  "user-input.resolved",
  "provider.user-input.respond.failed",
]);

export function resolveEventUpdatedAt(thread: Thread, updatedAt: string): string {
  const currentUpdatedAt = thread.updatedAt ?? thread.createdAt;
  return currentUpdatedAt > updatedAt ? currentUpdatedAt : updatedAt;
}

export function threadMessageUpdatesSummary(event: ThreadMessageSentEvent): boolean {
  return event.payload.role === "user";
}

export function threadActivityUpdatesSummary(event: ThreadActivityAppendedEvent): boolean {
  return THREAD_SUMMARY_ACTIVITY_KINDS.has(event.payload.activity.kind);
}

export function threadMessageUpdatesSidebarSummary(event: ThreadMessageSentEvent): boolean {
  return event.payload.role === "user" || !event.payload.streaming;
}

export function markInteractionResponding(
  thread: Thread,
  event: ThreadUserInputResponseRequestedEvent | ThreadApprovalResponseRequestedEvent,
): Thread["pendingInteractions"] {
  if (thread.pendingInteractions === undefined || event.commandId === null) {
    return thread.pendingInteractions;
  }
  const interactionKind =
    event.type === "thread.approval-response-requested" ? "approval" : "userInput";
  const lifecycleGeneration = event.payload.lifecycleGeneration ?? null;
  let changed = false;
  const next = thread.pendingInteractions.map((interaction) => {
    if (
      interaction.interactionKind !== interactionKind ||
      interaction.requestId !== event.payload.requestId ||
      interaction.lifecycleGeneration !== lifecycleGeneration ||
      !isPendingInteractionResponseClaimable({
        status: interaction.status,
        responseRequestedAt: interaction.responseRequestedAt,
        requestedAt: event.payload.createdAt,
      })
    ) {
      return interaction;
    }
    changed = true;
    return {
      ...interaction,
      status: "responding" as const,
      decision: event.type === "thread.approval-response-requested" ? event.payload.decision : null,
      responseCommandId: event.commandId,
      responseRequestedAt: event.payload.createdAt,
      resolvedAt: null,
    };
  });
  return changed ? next : thread.pendingInteractions;
}

export function reconcilePendingInteractionsFromActivity(
  threadId: ThreadId,
  pendingInteractions: Thread["pendingInteractions"],
  event: ThreadActivityAppendedEvent,
): Thread["pendingInteractions"] {
  const activity = event.payload.activity;
  const interactionKind =
    activity.kind === "approval.requested" ||
    activity.kind === "approval.resolved" ||
    activity.kind === "provider.approval.respond.failed"
      ? ("approval" as const)
      : activity.kind === "user-input.requested" ||
          activity.kind === "user-input.resolved" ||
          activity.kind === "provider.user-input.respond.failed"
        ? ("userInput" as const)
        : null;
  if (interactionKind === null) {
    return pendingInteractions;
  }
  const payload = asObjectRecord(activity.payload);
  const requestId = payload?.requestId;
  if (typeof requestId !== "string" || requestId.length === 0) {
    return pendingInteractions;
  }
  const lifecycleGeneration =
    typeof payload?.lifecycleGeneration === "string" && payload.lifecycleGeneration.length > 0
      ? payload.lifecycleGeneration
      : null;
  const existing = pendingInteractions ?? [];
  const matchesIdentity = (interaction: OrchestrationPendingInteraction) =>
    interaction.interactionKind === interactionKind &&
    interaction.requestId === requestId &&
    (lifecycleGeneration === null || interaction.lifecycleGeneration === lifecycleGeneration);

  if (activity.kind === "approval.resolved" || activity.kind === "user-input.resolved") {
    const next = existing.filter((interaction) => !matchesIdentity(interaction));
    return next.length === existing.length ? pendingInteractions : next;
  }

  if (
    activity.kind === "provider.approval.respond.failed" ||
    activity.kind === "provider.user-input.respond.failed"
  ) {
    const responseCommandId = payload?.responseCommandId;
    if (typeof responseCommandId !== "string" || responseCommandId.length === 0) {
      return pendingInteractions;
    }
    const settlementStatus: OrchestrationPendingInteraction["status"] =
      payload?.settlementStatus === "retryable" ? "retryable" : "uncertain";
    let changed = false;
    const next = existing.map((interaction) => {
      if (
        !matchesIdentity(interaction) ||
        interaction.status !== "responding" ||
        interaction.responseCommandId !== responseCommandId
      ) {
        return interaction;
      }
      changed = true;
      return { ...interaction, status: settlementStatus, resolvedAt: null };
    });
    return changed ? next : pendingInteractions;
  }

  const exactIndex = existing.findIndex(
    (interaction) =>
      interaction.interactionKind === interactionKind && interaction.requestId === requestId,
  );
  const current = exactIndex >= 0 ? existing[exactIndex] : undefined;
  if (
    current &&
    current.lifecycleGeneration === lifecycleGeneration &&
    (current.status === "responding" ||
      current.status === "confirmed" ||
      current.status === "uncertain")
  ) {
    return pendingInteractions;
  }
  const pending: OrchestrationPendingInteraction = {
    interactionKind,
    requestId: requestId as OrchestrationPendingInteraction["requestId"],
    threadId,
    turnId: activity.turnId,
    lifecycleGeneration,
    status: "pending",
    decision: null,
    responseCommandId: null,
    responseRequestedAt: null,
    createdAt:
      current?.lifecycleGeneration === lifecycleGeneration ? current.createdAt : activity.createdAt,
    resolvedAt: null,
  };
  if (exactIndex < 0) {
    return [...existing, pending];
  }
  const next = [...existing];
  next[exactIndex] = pending;
  return next;
}

function normalizeSingleTurnDiffSummary(
  incoming: Thread["turnDiffSummaries"][number],
  previous: Thread["turnDiffSummaries"][number] | undefined,
): Thread["turnDiffSummaries"][number] {
  const files = normalizeTurnDiffFiles(incoming.files, previous?.files);
  if (
    previous &&
    previous.turnId === incoming.turnId &&
    previous.completedAt === incoming.completedAt &&
    previous.status === incoming.status &&
    previous.assistantMessageId === incoming.assistantMessageId &&
    previous.checkpointTurnCount === incoming.checkpointTurnCount &&
    previous.checkpointRef === incoming.checkpointRef &&
    previous.files === files
  ) {
    return previous;
  }
  return {
    ...incoming,
    files,
  };
}

function sortTurnDiffSummaries(
  summaries: ReadonlyArray<Thread["turnDiffSummaries"][number]>,
): Thread["turnDiffSummaries"] {
  return [...summaries].toSorted(
    (left, right) =>
      (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
        (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) ||
      left.completedAt.localeCompare(right.completedAt) ||
      left.turnId.localeCompare(right.turnId),
  );
}

export function checkpointStatusToLatestTurnState(
  status: Thread["turnDiffSummaries"][number]["status"],
): NonNullable<Thread["latestTurn"]>["state"] {
  if (status === "error") {
    return "error";
  }
  if (status === "missing") {
    return "interrupted";
  }
  return "completed";
}

function isProviderDiffPlaceholderRef(checkpointRef: string | null | undefined): boolean {
  return checkpointRef?.startsWith("provider-diff:") === true;
}

export function buildLatestTurn(params: {
  previous: Thread["latestTurn"];
  turnId: NonNullable<Thread["latestTurn"]>["turnId"];
  state: NonNullable<Thread["latestTurn"]>["state"];
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"];
}): NonNullable<Thread["latestTurn"]> {
  return {
    turnId: params.turnId,
    state: params.state,
    requestedAt: params.requestedAt,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    assistantMessageId: params.assistantMessageId,
  };
}

export function reconcileLatestTurnFromSession(
  thread: Thread,
  session: NonNullable<ReadModelThread["session"]>,
  error: string | null,
): Thread["latestTurn"] {
  if (isSessionRunningTurn(session)) {
    return buildLatestTurn({
      previous: thread.latestTurn,
      turnId: session.activeTurnId,
      state: "running",
      requestedAt:
        thread.latestTurn?.turnId === session.activeTurnId
          ? thread.latestTurn.requestedAt
          : session.updatedAt,
      startedAt:
        thread.latestTurn?.turnId === session.activeTurnId
          ? (thread.latestTurn.startedAt ?? session.updatedAt)
          : session.updatedAt,
      completedAt: null,
      assistantMessageId:
        thread.latestTurn?.turnId === session.activeTurnId
          ? thread.latestTurn.assistantMessageId
          : null,
    });
  }

  const settledState =
    session.status === "error"
      ? ("error" as const)
      : session.status === "interrupted" || session.status === "stopped"
        ? ("interrupted" as const)
        : session.status === "ready"
          ? ("completed" as const)
          : null;

  if (
    settledState !== null &&
    thread.latestTurn?.state === "running" &&
    (session.activeTurnId == null || settledState === "error") &&
    (settledState === "error" ||
      session.updatedAt >= (thread.latestTurn.startedAt ?? thread.latestTurn.requestedAt))
  ) {
    return buildLatestTurn({
      previous: thread.latestTurn,
      turnId: thread.latestTurn.turnId,
      state: settledState,
      requestedAt: thread.latestTurn.requestedAt,
      startedAt: thread.latestTurn.startedAt,
      completedAt: session.updatedAt,
      assistantMessageId: thread.latestTurn.assistantMessageId,
    });
  }

  void error;
  return thread.latestTurn;
}

function rebindTurnDiffSummariesForAssistantMessage(
  turnDiffSummaries: ReadonlyArray<Thread["turnDiffSummaries"][number]>,
  turnId: Thread["turnDiffSummaries"][number]["turnId"],
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"],
): Thread["turnDiffSummaries"] {
  let changed = false;
  const nextSummaries = turnDiffSummaries.map((summary) => {
    if (summary.turnId !== turnId || summary.assistantMessageId === assistantMessageId) {
      return summary;
    }
    changed = true;
    return {
      ...summary,
      assistantMessageId: assistantMessageId ?? undefined,
    };
  });
  return changed ? nextSummaries : [...turnDiffSummaries];
}

export function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<ChatMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ChatMessage[] {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (
      message.turnId !== undefined &&
      message.turnId !== null &&
      retainedTurnIds.has(message.turnId)
    ) {
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
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
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
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

export function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<Thread["activities"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): Thread["activities"] {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

export function rollbackThreadMessagesFromMessage(
  messages: ReadonlyArray<ChatMessage>,
  messageId: string,
): {
  readonly messages: ChatMessage[];
  readonly removedTurnIds: ReadonlySet<string>;
} {
  const targetIndex = messages.findIndex((message) => message.id === messageId);
  if (targetIndex < 0) {
    return { messages: [...messages], removedTurnIds: new Set() };
  }

  const removedMessages = messages.slice(targetIndex);
  return {
    messages: messages.slice(0, targetIndex),
    removedTurnIds: new Set(
      removedMessages.flatMap((message) =>
        message.role === "system" || message.turnId === undefined || message.turnId === null
          ? []
          : [message.turnId],
      ),
    ),
  };
}

export function applyTurnDiffSummaryToThread(
  thread: Thread,
  summary: Thread["turnDiffSummaries"][number],
): Thread {
  const previousSummary = thread.turnDiffSummaries.find(
    (existingSummary) => existingSummary.turnId === summary.turnId,
  );
  const nextSummary = normalizeSingleTurnDiffSummary(summary, previousSummary);
  if (previousSummary && previousSummary.status !== "missing" && nextSummary.status === "missing") {
    return thread;
  }
  const turnDiffSummaries = previousSummary
    ? thread.turnDiffSummaries.map((existingSummary) =>
        existingSummary.turnId === nextSummary.turnId ? nextSummary : existingSummary,
      )
    : sortTurnDiffSummaries([...thread.turnDiffSummaries, nextSummary]);

  // Mirror of the server projector's placeholder guard: a provider-diff placeholder only carries live
  // diff totals and must never change the turn lifecycle — neither close a running turn nor flip an
  // already-settled one to "interrupted" when it loses the race against session settlement.
  const isSameTurnPlaceholder =
    isProviderDiffPlaceholderRef(nextSummary.checkpointRef) &&
    nextSummary.status === "missing" &&
    thread.latestTurn?.turnId === nextSummary.turnId;
  const latestTurn =
    thread.latestTurn === null || thread.latestTurn.turnId === nextSummary.turnId
      ? isSameTurnPlaceholder
        ? thread.latestTurn
        : buildLatestTurn({
            previous: thread.latestTurn,
            turnId: nextSummary.turnId,
            state: checkpointStatusToLatestTurnState(nextSummary.status),
            requestedAt: thread.latestTurn?.requestedAt ?? nextSummary.completedAt,
            startedAt: thread.latestTurn?.startedAt ?? nextSummary.completedAt,
            completedAt: nextSummary.completedAt,
            // Prefer the incoming assistantMessageId when present; otherwise keep the previous one from the
            // same turn. Turn-diff events may arrive before the message has been finalized and carry a null id
            // — they must not erase a real id already recorded by thread.message-sent.
            assistantMessageId:
              nextSummary.assistantMessageId ??
              (thread.latestTurn?.turnId === nextSummary.turnId
                ? thread.latestTurn.assistantMessageId
                : null) ??
              null,
          })
      : thread.latestTurn;

  if (
    previousSummary === nextSummary &&
    turnDiffSummaries === thread.turnDiffSummaries &&
    latestTurn === thread.latestTurn &&
    (thread.updatedAt ?? thread.createdAt) >= nextSummary.completedAt
  ) {
    return thread;
  }

  return {
    ...thread,
    turnDiffSummaries:
      arraysShallowEqual(thread.turnDiffSummaries, turnDiffSummaries) &&
      thread.turnDiffSummaries.length === turnDiffSummaries.length
        ? thread.turnDiffSummaries
        : turnDiffSummaries,
    latestTurn,
    updatedAt:
      (thread.updatedAt ?? thread.createdAt) > nextSummary.completedAt
        ? thread.updatedAt
        : nextSummary.completedAt,
  };
}

const STREAM_TEXT_AFFIX_LENGTH = 48;

function describeStreamText(text: string): {
  length: number;
  prefix: string;
  suffix: string;
} {
  return {
    length: text.length,
    prefix: text.slice(0, STREAM_TEXT_AFFIX_LENGTH),
    suffix: text.slice(-STREAM_TEXT_AFFIX_LENGTH),
  };
}

function mergeStreamingMessage(
  existingMessage: ChatMessage,
  incomingMessage: ChatMessage,
): ChatMessage | null {
  let nextText: string;
  if (
    existingMessage.role === "user" &&
    incomingMessage.role === "user" &&
    !incomingMessage.streaming
  ) {
    nextText = incomingMessage.text;
  } else if (incomingMessage.streaming || incomingMessage.text.length === 0) {
    nextText = `${existingMessage.text}${incomingMessage.text}`;
  } else {
    // Non-streaming completions carry the server's authoritative accumulated text. Always prefer them
    // so a duplicated or divergent local stream cannot survive after the turn settles.
    if (
      import.meta.env.DEV &&
      incomingMessage.text !== existingMessage.text &&
      !incomingMessage.text.startsWith(existingMessage.text)
    ) {
      console.warn("[transcript] completion text diverged from local stream", {
        messageId: existingMessage.id,
        existing: describeStreamText(existingMessage.text),
        incoming: describeStreamText(incomingMessage.text),
      });
    }
    nextText = incomingMessage.text;
  }
  const nextAttachments = incomingMessage.attachments ?? existingMessage.attachments;
  const nextAsyncUserInput = mergeAsyncUserInput(
    existingMessage.asyncUserInput,
    incomingMessage.asyncUserInput,
  );
  const nextSkills =
    incomingMessage.skills && incomingMessage.skills.length > 0
      ? incomingMessage.skills
      : existingMessage.skills;
  const nextMentions =
    incomingMessage.mentions && incomingMessage.mentions.length > 0
      ? incomingMessage.mentions
      : existingMessage.mentions;
  const nextCompletedAt = incomingMessage.streaming
    ? existingMessage.completedAt
    : (incomingMessage.completedAt ?? existingMessage.completedAt);
  const nextUpdatedAt =
    incomingMessage.updatedAt ?? existingMessage.updatedAt ?? incomingMessage.createdAt;
  const nextTurnId =
    incomingMessage.turnId !== undefined ? incomingMessage.turnId : existingMessage.turnId;
  const nextDispatchMode =
    incomingMessage.dispatchMode !== undefined
      ? incomingMessage.dispatchMode
      : existingMessage.dispatchMode;
  const nextDispatchOrigin =
    incomingMessage.dispatchOrigin !== undefined
      ? incomingMessage.dispatchOrigin
      : existingMessage.dispatchOrigin;
  const nextStartsNewTurn =
    incomingMessage.startsNewTurn !== undefined
      ? incomingMessage.startsNewTurn
      : existingMessage.startsNewTurn;
  const nextSource = incomingMessage.source ?? existingMessage.source;

  if (
    existingMessage.text === nextText &&
    existingMessage.asyncUserInput === nextAsyncUserInput &&
    existingMessage.streaming === incomingMessage.streaming &&
    existingMessage.attachments === nextAttachments &&
    providerReferenceArraysEqual(existingMessage.skills, nextSkills) &&
    providerReferenceArraysEqual(existingMessage.mentions, nextMentions) &&
    existingMessage.completedAt === nextCompletedAt &&
    existingMessage.updatedAt === nextUpdatedAt &&
    existingMessage.turnId === nextTurnId &&
    existingMessage.dispatchMode === nextDispatchMode &&
    existingMessage.dispatchOrigin === nextDispatchOrigin &&
    existingMessage.startsNewTurn === nextStartsNewTurn &&
    existingMessage.source === nextSource
  ) {
    return null;
  }

  return {
    ...existingMessage,
    text: nextText,
    updatedAt: nextUpdatedAt,
    ...(nextAsyncUserInput ? { asyncUserInput: nextAsyncUserInput } : {}),
    streaming: incomingMessage.streaming,
    ...(nextAttachments ? { attachments: nextAttachments } : {}),
    ...(nextSkills && nextSkills.length > 0 ? { skills: [...nextSkills] } : {}),
    ...(nextMentions && nextMentions.length > 0 ? { mentions: [...nextMentions] } : {}),
    ...(nextTurnId !== undefined ? { turnId: nextTurnId } : {}),
    ...(nextDispatchMode !== undefined ? { dispatchMode: nextDispatchMode } : {}),
    ...(nextDispatchOrigin !== undefined ? { dispatchOrigin: nextDispatchOrigin } : {}),
    ...(nextStartsNewTurn !== undefined ? { startsNewTurn: nextStartsNewTurn } : {}),
    ...(nextSource !== undefined ? { source: nextSource } : {}),
    ...(nextCompletedAt !== undefined ? { completedAt: nextCompletedAt } : {}),
  };
}

export function applyThreadMessageSentEvent(thread: Thread, event: ThreadMessageSentEvent): Thread {
  const payload = event.payload;
  // Single backward scan: streaming deltas target the newest message, so walking from the tail finds
  // it in O(1) instead of scanning the (up to MAX_THREAD_MESSAGES) list front-to-back on every delta.
  // Message ids are unique per thread, so scan direction cannot change the match.
  let existingIndex = -1;
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    if (thread.messages[index]!.id === payload.messageId) {
      existingIndex = index;
      break;
    }
  }
  const existingMessage = existingIndex >= 0 ? thread.messages[existingIndex] : undefined;
  const incomingMessage = normalizeChatMessage(
    {
      id: payload.messageId,
      role: payload.role,
      text: payload.text,
      ...(payload.asyncUserInput ? { asyncUserInput: payload.asyncUserInput } : {}),
      dispatchMode: payload.dispatchMode,
      dispatchOrigin: payload.dispatchOrigin,
      startsNewTurn: payload.startsNewTurn,
      ...(payload.providerMessageId ? { providerMessageId: payload.providerMessageId } : {}),
      turnId: payload.turnId,
      attachments: payload.attachments ?? [],
      ...(payload.skills !== undefined ? { skills: payload.skills } : {}),
      ...(payload.mentions !== undefined ? { mentions: payload.mentions } : {}),
      streaming: payload.streaming,
      source: payload.source,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    },
    existingMessage,
  );
  let messages = thread.messages;

  if (existingMessage) {
    const mergedMessage = mergeStreamingMessage(existingMessage, incomingMessage);
    if (mergedMessage !== null) {
      messages = thread.messages.with(existingIndex, mergedMessage);
    }
  } else {
    messages = retainChatMessageWindow([...thread.messages, incomingMessage]);
  }

  const turnDiffSummaries =
    payload.role === "assistant" && payload.turnId !== null
      ? rebindTurnDiffSummariesForAssistantMessage(
          thread.turnDiffSummaries,
          payload.turnId,
          payload.messageId,
        )
      : thread.turnDiffSummaries;

  let latestTurn = thread.latestTurn;
  if (
    payload.role === "assistant" &&
    payload.turnId !== null &&
    (thread.latestTurn === null || thread.latestTurn.turnId === payload.turnId)
  ) {
    const previousTurn = thread.latestTurn;
    latestTurn = buildLatestTurn({
      previous: previousTurn,
      turnId: payload.turnId,
      state: payload.streaming
        ? "running"
        : previousTurn?.state === "interrupted"
          ? "interrupted"
          : previousTurn?.state === "error"
            ? "error"
            : "completed",
      requestedAt: previousTurn?.requestedAt ?? payload.createdAt,
      startedAt: previousTurn?.startedAt ?? payload.createdAt,
      completedAt: payload.streaming ? (previousTurn?.completedAt ?? null) : payload.updatedAt,
      assistantMessageId: payload.messageId,
    });
  }

  const humanMessageAt = resolveHumanMessageAt(incomingMessage);
  const latestHumanMessageAt =
    humanMessageAt !== null && humanMessageAt > (thread.latestHumanMessageAt ?? "")
      ? humanMessageAt
      : thread.latestHumanMessageAt;
  const updatedAt =
    thread.updatedAt && thread.updatedAt > payload.updatedAt ? thread.updatedAt : payload.updatedAt;
  if (
    messages === thread.messages &&
    turnDiffSummaries === thread.turnDiffSummaries &&
    latestTurn === thread.latestTurn &&
    latestHumanMessageAt === thread.latestHumanMessageAt &&
    updatedAt === thread.updatedAt
  ) {
    return thread;
  }

  return {
    ...thread,
    messages,
    turnDiffSummaries,
    latestTurn,
    ...(latestHumanMessageAt !== undefined ? { latestHumanMessageAt } : {}),
    updatedAt,
  };
}
