import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { type OrchestrationShellSnapshot } from "@glade/contracts/orchestration/snapshots";
import { type OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import { isThreadDetailEventFor } from "@glade/shared/threads/threadDetailEvents";
import { finalizePromotedDraftThreads, markPromotedDraftThreads } from "../composerDraftStore";
import { derivePendingApprovals, derivePendingUserInputs } from "../pendingInteractionDerivation";
import { hasPendingTurnDispatch } from "../pendingTurnDispatch";
import { useStore } from "../store";
import { getThreadFromState } from "../threadDerivation";
import { isThreadDetailRetained } from "../threadDetailSubscriptionRetention";
import { selectOrphanedThreadDetailIds } from "./-threadDetailOwnership";

export const SHELL_SNAPSHOT_BOOTSTRAP_FALLBACK_DELAY_MS = 1_500;
export const THREAD_DETAIL_CATCHUP_INTERVAL_MS = 1_500;
export const THREAD_DETAIL_PROJECTION_RECONCILE_INTERVAL_MS = 4_500;
export const THREAD_DETAIL_TERMINAL_FENCE_RECONCILE_DELAY_MS = 500;
export const THREAD_DETAIL_PROJECTION_RECONCILE_MAX_CONCURRENCY = 2;
export const THREAD_DETAIL_REPLAY_MAX_NOOP_STREAK = 2;
export const THREAD_DETAIL_PROJECTION_RECONCILE_MAX_NOOP_STREAK = 4;
export const THREAD_DETAIL_PROJECTION_RECONCILE_MAX_INTERVAL_MS = 72_000;
export const PENDING_SHELL_EVENT_BUFFER_LIMIT = 1_024;
export const PENDING_THREAD_EVENT_BUFFER_LIMIT = 512;
const IMMEDIATE_ASSISTANT_FLUSH_ID_LIMIT = 512;
function shellThreadHasStarted(thread: OrchestrationShellSnapshot["threads"][number]): boolean {
  return thread.latestTurn !== null || thread.session !== null;
}
function detailThreadHasStarted(thread: OrchestrationThread): boolean {
  return shellThreadHasStarted(thread) || thread.messages.length > 0;
}
export function reconcilePromotedDraftsFromShellThreads(
  threads: ReadonlyArray<OrchestrationShellSnapshot["threads"][number]>,
): void {
  markPromotedDraftThreads(new Set(threads.map((thread) => thread.id)));
  finalizePromotedDraftThreads(
    new Set(threads.filter((thread) => shellThreadHasStarted(thread)).map((thread) => thread.id)),
  );
}
export function reconcilePromotedDraftFromThreadDetail(thread: OrchestrationThread): void {
  markPromotedDraftThreads(new Set([thread.id]));
  if (detailThreadHasStarted(thread)) {
    finalizePromotedDraftThreads(new Set([thread.id]));
  }
}
export function appendBounded<T>(items: T[], item: T, limit: number): void {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (items.length >= normalizedLimit) {
    items.splice(0, items.length - normalizedLimit + 1);
  }
  items.push(item);
}
function addBoundedSetValue<T>(set: Set<T>, value: T, limit: number): void {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (set.has(value)) {
    set.delete(value);
  }
  while (set.size >= normalizedLimit) {
    const oldestValue = set.values().next().value as T | undefined;
    if (oldestValue === undefined) {
      break;
    }
    set.delete(oldestValue);
  }
  set.add(value);
}
export function shouldFlushDomainEventImmediately(
  event: OrchestrationEvent,
  immediatelyFlushedAssistantMessageIds: Set<string>,
): boolean {
  if (event.type !== "thread.message-sent" || event.payload.role !== "assistant") {
    return false;
  }

  if (!event.payload.streaming) {
    immediatelyFlushedAssistantMessageIds.delete(event.payload.messageId);
    return false;
  }

  if (immediatelyFlushedAssistantMessageIds.has(event.payload.messageId)) {
    return false;
  }

  addBoundedSetValue(
    immediatelyFlushedAssistantMessageIds,
    event.payload.messageId,
    IMMEDIATE_ASSISTANT_FLUSH_ID_LIMIT,
  );
  return true;
}
export function isThreadDetailEventForThread(
  event: OrchestrationEvent,
  threadId: ThreadId,
): boolean {
  return isThreadDetailEventFor(event, threadId);
}
export function shouldPollThreadDetailCatchup(threadId: ThreadId): boolean {
  const thread = getThreadFromState(useStore.getState(), threadId);
  return (
    thread?.session?.orchestrationStatus === "running" ||
    thread?.latestTurn?.state === "running" ||
    hasPendingTurnDispatch(threadId)
  );
}
export function isPendingInteractionDetailMissing(threadId: ThreadId): boolean {
  const thread = getThreadFromState(useStore.getState(), threadId);
  if (!thread) {
    return false;
  }
  const options = {
    latestTurnId: thread.latestTurn?.turnId,
  };
  const hasMatchingSettlement = (
    interactionKind: "approval" | "userInput",
    request: { readonly requestId: string; readonly lifecycleGeneration?: string },
  ) =>
    thread.pendingInteractions?.some(
      (interaction) =>
        interaction.interactionKind === interactionKind &&
        interaction.requestId === request.requestId &&
        (interaction.lifecycleGeneration ?? undefined) === request.lifecycleGeneration,
    ) === true;

  if (thread.hasPendingApprovals === true) {
    const actionableApprovals = derivePendingApprovals(
      thread.activities,
      thread.pendingInteractions,
      {
        ...options,
        authoritativeHasPending: true,
      },
    );
    if (actionableApprovals.length === 0) {
      const replayedApprovals = derivePendingApprovals(thread.activities, undefined, {
        ...options,
        authoritativeHasPending: true,
      });
      if (
        replayedApprovals.length === 0 ||
        replayedApprovals.some((request) => !hasMatchingSettlement("approval", request))
      ) {
        return true;
      }
    }
  }

  if (thread.hasPendingUserInput === true) {
    const actionableUserInputs = derivePendingUserInputs(
      thread.activities,
      thread.pendingInteractions,
      {
        ...options,
        authoritativeHasPending: true,
      },
    );
    if (actionableUserInputs.length === 0) {
      const replayedUserInputs = derivePendingUserInputs(thread.activities, undefined, {
        ...options,
        authoritativeHasPending: true,
      });
      if (
        replayedUserInputs.length === 0 ||
        replayedUserInputs.some((request) => !hasMatchingSettlement("userInput", request))
      ) {
        return true;
      }
    }
  }

  return false;
}
export function shouldReconcileThreadProjection(threadId: ThreadId): boolean {
  const thread = getThreadFromState(useStore.getState(), threadId);
  return (
    thread?.session?.orchestrationStatus === "starting" ||
    thread?.session?.orchestrationStatus === "running" ||
    thread?.latestTurn?.state === "running" ||
    thread?.messages.some((message) => message.role === "assistant" && message.streaming) ===
      true ||
    isPendingInteractionDetailMissing(threadId) ||
    hasPendingTurnDispatch(threadId)
  );
}
export function releaseOrphanedThreadDetail(input: {
  readonly releasedThreadIds: readonly ThreadId[];
  readonly keptThreadIds?: ReadonlySet<ThreadId> | undefined;
}): void {
  const orphanedThreadIds = selectOrphanedThreadDetailIds({
    releasedThreadIds: input.releasedThreadIds,
    isRetained: isThreadDetailRetained,
    keptThreadIds: input.keptThreadIds,
  });
  if (orphanedThreadIds.length === 0) {
    return;
  }

  useStore.getState().evictThreadDetails(orphanedThreadIds);
}
