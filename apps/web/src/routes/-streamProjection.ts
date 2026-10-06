import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useStore } from "../store";
import { getThreadFromState } from "../threadDerivation";
import { advanceThreadDetailResumeCursor } from "../threadDetailResumeCursors";
import {
  isThreadDetailEventForThread,
  reconcilePromotedDraftFromThreadDetail,
  shouldReconcileThreadProjection,
} from "./-rootStreamPolicy";
import type { createStreamBatching } from "./-streamBatching";
import type { StreamContext } from "./-streamContracts";
import type { createStreamPolicy } from "./-streamPolicy";
import type { StreamState } from "./-streamState";
import { canApplyThreadSnapshot } from "./-threadDetailOwnership";
import { doesSnapshotSatisfyTerminalFence } from "./-threadTerminalFence";
export function createStreamProjection(
  context: StreamContext,
  state: StreamState,
  policy: ReturnType<typeof createStreamPolicy>,
  batching: ReturnType<typeof createStreamBatching>,
) {
  // Resolves the number of events actually applied, or null when the replay was skipped (already in
  // flight, no cursor, or target already reached) — callers driving the poll backoff must not count a
  // skip as an empty poll.
  const replayThreadEvents = async (
    threadId: ThreadId,
    targetSequence?: number,
  ): Promise<number | null> => {
    if (state.disposed || state.threadReplayRequestInFlight.has(threadId)) {
      return null;
    }
    const fromSequence = state.threadSnapshotSequenceById.get(threadId);
    if (
      fromSequence === undefined ||
      (targetSequence !== undefined && fromSequence >= targetSequence)
    ) {
      return null;
    }
    state.threadReplayRequestInFlight.add(threadId);

    return await context.api.orchestration
      .replayEvents(fromSequence, threadId)
      .then((replayedEvents) => {
        let appliedEventCount = 0;
        for (const event of replayedEvents
          .filter((candidate) => isThreadDetailEventForThread(candidate, threadId))
          .filter(
            (candidate) => targetSequence === undefined || candidate.sequence <= targetSequence,
          )
          .toSorted((left, right) => left.sequence - right.sequence)) {
          const latestThreadSequence =
            state.threadSnapshotSequenceById.get(threadId) ?? fromSequence;
          if (event.sequence <= latestThreadSequence) {
            continue;
          }
          if (!policy.applyFencedThreadEvent(threadId, event)) {
            break;
          }
          appliedEventCount += 1;
        }
        if (appliedEventCount === 0) {
          // An empty replay is evidence of a quiet stream only if nothing else moved the cursor while it ran.
          // A replay raced by live events (they applied first, so every replayed event was skipped) must not
          // feed the no-op backoff.
          const cursorAdvancedDuringReplay =
            (state.threadSnapshotSequenceById.get(threadId) ?? fromSequence) > fromSequence;
          return cursorAdvancedDuringReplay ? null : 0;
        }
        return appliedEventCount;
      })
      .finally(() => {
        state.threadReplayRequestInFlight.delete(threadId);
      });
  };

  const reconcileThreadProjection = async (
    threadId: ThreadId,
    options?: { readonly queueIfInFlight?: boolean },
  ): Promise<void> => {
    const subscriptionGeneration = state.threadSubscriptionGenerationById.get(threadId);
    if (
      state.disposed ||
      !state.subscribedThreadIds.has(threadId) ||
      subscriptionGeneration === undefined
    ) {
      return;
    }
    if (state.threadProjectionReconcileInFlight.has(threadId)) {
      if (options?.queueIfInFlight === true) {
        state.threadProjectionReconcilePendingById.set(threadId, subscriptionGeneration);
      }
      return;
    }
    state.threadProjectionReconcileInFlight.set(threadId, subscriptionGeneration);
    let projectionConfirmed = false;
    let projectionSatisfiesTerminalFence = false;
    let projectionAttemptFailed = false;
    try {
      const snapshot = await context.api.orchestration.getThreadDetailSnapshot({ threadId });
      if (
        snapshot === null ||
        state.disposed ||
        state.threadSubscriptionGenerationById.get(threadId) !== subscriptionGeneration ||
        !canApplyThreadSnapshot({ threadId, leasedThreadIds: state.subscribedThreadIds })
      ) {
        return;
      }
      const currentSequence = state.threadSnapshotSequenceById.get(threadId) ?? -1;
      // The RPC response can race a newer stream event.
      if (snapshot.snapshotSequence < currentSequence) {
        return;
      }
      const currentThread = getThreadFromState(useStore.getState(), threadId);
      const projectionRepairsTerminalFence =
        state.threadProjectionTerminalFencePending.has(threadId);
      const projectionSettlesCurrentTurn =
        currentThread?.latestTurn?.state === "running" &&
        snapshot.thread.latestTurn !== null &&
        snapshot.thread.latestTurn.turnId === currentThread.latestTurn.turnId &&
        snapshot.thread.latestTurn.state !== "running" &&
        snapshot.thread.latestTurn.completedAt !== null;
      const fenceIsPending = state.threadProjectionTerminalFencePending.has(threadId);
      const fenceSequence = state.threadProjectionTerminalFenceSequenceById.get(threadId) ?? -1;
      const fenceArmedAtMs =
        state.threadProjectionTerminalFenceArmedAtById.get(threadId) ?? Date.now();
      projectionSatisfiesTerminalFence =
        fenceIsPending &&
        doesSnapshotSatisfyTerminalFence({
          snapshotSequence: snapshot.snapshotSequence,
          fenceSequence,
          sessionStatus: snapshot.thread.session?.status,
          latestTurn: snapshot.thread.latestTurn,
          messages: snapshot.thread.messages,
          armedAtMs: fenceArmedAtMs,
          nowMs: Date.now(),
        });
      state.threadSnapshotSequenceById.set(
        threadId,
        Math.max(currentSequence, snapshot.snapshotSequence),
      );
      advanceThreadDetailResumeCursor(threadId, snapshot.snapshotSequence);

      const stateBeforeProjectionApply = useStore.getState();

      const catchupEntryBeforeApply = policy.resolveThreadCatchupBackoff(threadId);
      context.syncServerThreadDetailHotPath(snapshot.thread, snapshot.snapshotSequence);
      reconcilePromotedDraftFromThreadDetail(snapshot.thread);
      policy.flushThreadBuffer(threadId, snapshot.snapshotSequence);
      projectionConfirmed = true;
      catchupEntryBeforeApply.lastProjectionReconciledAt = Date.now();

      policy.noteThreadReconcileResult(
        threadId,
        snapshot.snapshotSequence <= currentSequence &&
          useStore.getState() === stateBeforeProjectionApply,
      );
      if (projectionSettlesCurrentTurn || projectionRepairsTerminalFence) {
        state.pendingCheckpointDiffThreadIds.add(threadId);
        state.pendingGitInvalidationThreadIds.add(threadId);
        batching.domainEventFlushThrottler.maybeExecute();
      }
    } catch (error) {
      projectionAttemptFailed = true;
      throw error;
    } finally {
      if (state.threadProjectionReconcileInFlight.get(threadId) === subscriptionGeneration) {
        state.threadProjectionReconcileInFlight.delete(threadId);
      }
      if (state.threadSubscriptionGenerationById.get(threadId) === subscriptionGeneration) {
        if (state.threadProjectionReconcilePendingById.get(threadId) === subscriptionGeneration) {
          state.threadProjectionReconcilePendingById.delete(threadId);
          void reconcileThreadProjection(threadId).catch(() => undefined);
        } else {
          if (projectionAttemptFailed) {
            policy.resolveThreadCatchupBackoff(threadId).reconcileNoopStreak = 0;
          }

          if (projectionConfirmed && projectionSatisfiesTerminalFence) {
            policy.clearThreadProjectionTerminalFence(threadId);
          }
          if (
            state.threadProjectionTerminalFencePending.has(threadId) ||
            shouldReconcileThreadProjection(threadId) ||
            policy.isDraftThreadAwaitingProjection(threadId)
          ) {
            state.nextThreadProjectionReconcileAtById.set(
              threadId,
              Date.now() + policy.nextThreadProjectionReconcileDelayMs(threadId),
            );
          } else {
            state.nextThreadProjectionReconcileAtById.delete(threadId);
          }
        }
      }
    }
  };
  return { replayThreadEvents, reconcileThreadProjection };
}
