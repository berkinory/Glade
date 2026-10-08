import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { useComposerDraftStore } from "../composerDraftStore";
import { hasPendingTurnDispatch } from "../pendingTurnDispatch";
import { useStore } from "../store";
import { getThreadFromState } from "../threadDerivation";
import {
  advanceThreadDetailResumeCursor,
  clearThreadDetailResumeCursor,
  getThreadDetailResumeCursor,
} from "../threadDetailResumeCursors";
import {
  THREAD_DETAIL_CATCHUP_INTERVAL_MS,
  THREAD_DETAIL_PROJECTION_RECONCILE_INTERVAL_MS,
  THREAD_DETAIL_PROJECTION_RECONCILE_MAX_NOOP_STREAK,
  THREAD_DETAIL_REPLAY_MAX_NOOP_STREAK,
  THREAD_DETAIL_TERMINAL_FENCE_RECONCILE_DELAY_MS,
} from "./-rootStreamPolicy";
import type { StreamOperations } from "./-streamContracts";
import type { StreamState, ThreadCatchupBackoff } from "./-streamState";

export function createStreamPolicy(state: StreamState, operations: StreamOperations) {
  const armThreadProjectionTerminalFence = (threadId: ThreadId, sequence: number): void => {
    state.threadProjectionTerminalFencePending.add(threadId);
    // Keep the earliest arming sequence / clock: a later ready upsert must not raise the bar past
    // finals that already landed after the first settle.
    const previousSequence = state.threadProjectionTerminalFenceSequenceById.get(threadId);
    if (previousSequence === undefined || sequence < previousSequence) {
      state.threadProjectionTerminalFenceSequenceById.set(threadId, sequence);
    }
    if (!state.threadProjectionTerminalFenceArmedAtById.has(threadId)) {
      state.threadProjectionTerminalFenceArmedAtById.set(threadId, Date.now());
    }
    state.nextThreadProjectionReconcileAtById.set(
      threadId,
      Date.now() + THREAD_DETAIL_TERMINAL_FENCE_RECONCILE_DELAY_MS,
    );
  };

  const clearThreadProjectionTerminalFence = (threadId: ThreadId): void => {
    state.threadProjectionTerminalFencePending.delete(threadId);
    state.threadProjectionTerminalFenceSequenceById.delete(threadId);
    state.threadProjectionTerminalFenceArmedAtById.delete(threadId);
  };

  const isDraftThreadAwaitingProjection = (threadId: ThreadId): boolean => {
    if (useComposerDraftStore.getState().draftThreadsByThreadId[threadId] === undefined) {
      return false;
    }
    return (
      !state.threadSnapshotSequenceById.has(threadId) ||
      getThreadFromState(useStore.getState(), threadId) === undefined
    );
  };

  const resolveThreadCatchupBackoff = (threadId: ThreadId): ThreadCatchupBackoff => {
    const turnId = getThreadFromState(useStore.getState(), threadId)?.latestTurn?.turnId ?? null;
    let entry = state.threadCatchupBackoffById.get(threadId);
    if (entry === undefined || entry.turnId !== turnId) {
      entry = {
        turnId,
        replayNoopStreak: 0,
        nextReplayAt: 0,
        reconcileNoopStreak: 0,
        appliedEventSerial: 0,
        emptyReplayAtEventSerial: null,
        lastProjectionReconciledAt: null,
      };
      state.threadCatchupBackoffById.set(threadId, entry);
    }
    return entry;
  };

  const noteThreadReplayResult = (threadId: ThreadId, appliedEventCount: number): void => {
    const entry = resolveThreadCatchupBackoff(threadId);
    if (appliedEventCount > 0) {
      entry.replayNoopStreak = 0;
      entry.nextReplayAt = 0;
      return;
    }

    entry.emptyReplayAtEventSerial = entry.appliedEventSerial;
    entry.replayNoopStreak = Math.min(
      entry.replayNoopStreak + 1,
      THREAD_DETAIL_REPLAY_MAX_NOOP_STREAK,
    );
    entry.nextReplayAt =
      Date.now() + THREAD_DETAIL_CATCHUP_INTERVAL_MS * 2 ** entry.replayNoopStreak;
  };

  const noteThreadReconcileResult = (threadId: ThreadId, wasNoop: boolean): void => {
    const entry = resolveThreadCatchupBackoff(threadId);
    entry.reconcileNoopStreak = wasNoop
      ? Math.min(entry.reconcileNoopStreak + 1, THREAD_DETAIL_PROJECTION_RECONCILE_MAX_NOOP_STREAK)
      : 0;
  };

  const hasThreadProjectionRepairPending = (threadId: ThreadId): boolean =>
    state.threadProjectionTerminalFencePending.has(threadId) ||
    isDraftThreadAwaitingProjection(threadId) ||
    hasPendingTurnDispatch(threadId);

  const nextThreadProjectionReconcileDelayMs = (threadId: ThreadId): number => {
    if (hasThreadProjectionRepairPending(threadId)) {
      const entry = resolveThreadCatchupBackoff(threadId);
      entry.reconcileNoopStreak = 0;
      return THREAD_DETAIL_PROJECTION_RECONCILE_INTERVAL_MS;
    }
    const entry = resolveThreadCatchupBackoff(threadId);
    return THREAD_DETAIL_PROJECTION_RECONCILE_INTERVAL_MS * 2 ** entry.reconcileNoopStreak;
  };

  const beginThreadSubscription = (threadId: ThreadId) => {
    // Seed the live cursor so gap/live events apply immediately instead of buffering while waiting for
    // a snapshot — which is also what previously triggered the unsubscribe-resubscribe race that
    // re-shipped full history.
    const resumeCursor = getThreadDetailResumeCursor(threadId);
    if (resumeCursor === undefined) {
      state.threadSnapshotSequenceById.delete(threadId);
    } else {
      state.threadSnapshotSequenceById.set(threadId, resumeCursor);
    }
    state.pendingThreadEventsById.set(threadId, []);
    state.threadSnapshotRequestInFlight.delete(threadId);
    state.threadSnapshotRefreshPending.delete(threadId);
    state.threadSnapshotNotFoundRetryAttempted.delete(threadId);
    state.threadsAwaitingCreation.delete(threadId);
    state.threadProjectionReconcileInFlight.delete(threadId);
    state.threadProjectionReconcilePendingById.delete(threadId);
    clearThreadProjectionTerminalFence(threadId);
    state.threadCatchupBackoffById.delete(threadId);
    state.nextThreadSubscriptionGeneration += 1;
    state.threadSubscriptionGenerationById.set(threadId, state.nextThreadSubscriptionGeneration);
    state.nextThreadProjectionReconcileAtById.set(
      threadId,
      Date.now() + THREAD_DETAIL_PROJECTION_RECONCILE_INTERVAL_MS,
    );
  };

  // The reducer silently ignores detail events for a thread the store no longer holds (pruned by a
  // shell full sync, evicted, deleted), and domain events never create thread records, so advancing
  // the fence and resume cursor first would vouch for events that never landed — a later cursor
  // resume would then skip them forever.
  const applyFencedThreadEvent = (threadId: ThreadId, event: OrchestrationEvent): boolean => {
    if (!getThreadFromState(useStore.getState(), threadId)) {
      state.threadSnapshotSequenceById.delete(threadId);
      state.pendingThreadEventsById.delete(threadId);
      clearThreadDetailResumeCursor(threadId);
      if (state.subscribedThreadIds.has(threadId)) {
        void operations.reconcileThreadProjection(threadId).catch(() => undefined);
      }
      return false;
    }
    state.threadSnapshotSequenceById.set(threadId, event.sequence);
    advanceThreadDetailResumeCursor(threadId, event.sequence);
    operations.queueDomainEvent(event);

    const backoff = state.threadCatchupBackoffById.get(threadId);
    if (backoff !== undefined) {
      backoff.replayNoopStreak = 0;
      backoff.nextReplayAt = 0;
      backoff.appliedEventSerial += 1;
    }
    return true;
  };

  const flushThreadBuffer = (threadId: ThreadId, snapshotSequence: number) => {
    const pendingEvents = state.pendingThreadEventsById.get(threadId) ?? [];
    state.pendingThreadEventsById.delete(threadId);
    let latestThreadSequence = state.threadSnapshotSequenceById.get(threadId) ?? snapshotSequence;
    for (const event of pendingEvents.toSorted((left, right) => left.sequence - right.sequence)) {
      if (event.sequence > latestThreadSequence) {
        latestThreadSequence = event.sequence;
        if (!applyFencedThreadEvent(threadId, event)) {
          return;
        }
      }
    }
  };
  return {
    armThreadProjectionTerminalFence,
    clearThreadProjectionTerminalFence,
    isDraftThreadAwaitingProjection,
    resolveThreadCatchupBackoff,
    noteThreadReplayResult,
    noteThreadReconcileResult,
    hasThreadProjectionRepairPending,
    nextThreadProjectionReconcileDelayMs,
    beginThreadSubscription,
    applyFencedThreadEvent,
    flushThreadBuffer,
  };
}
