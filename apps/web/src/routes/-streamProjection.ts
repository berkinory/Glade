import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { hasPendingTurnDispatch } from "../pendingTurnDispatch";
import { getThreadFromState } from "../threadDerivation";
import { advanceThreadDetailResumeCursor } from "../threadDetailResumeCursors";
import {
  isPendingInteractionDetailMissing,
  isThreadDetailEventForThread,
  reconcilePromotedDraftFromThreadDetail,
  shouldReconcileThreadProjection,
} from "./-rootStreamPolicy";
import type { createStreamBatching } from "./-streamBatching";
import type { StreamContext } from "./-streamContracts";
import type { createStreamPolicy } from "./-streamPolicy";
import type { StreamState } from "./-streamState";
import { doesThreadDetailHeadMatch } from "./-threadDetailHead";
import { canApplyThreadSnapshot } from "./-threadDetailOwnership";
import { doesSnapshotSatisfyTerminalFence } from "./-threadTerminalFence";

type HeadVerdict =
  | {
      readonly kind: "in-sync";
      readonly snapshotSequence: number;
      readonly fenceSatisfied: boolean;
    }
  | { readonly kind: "superseded" }
  | { readonly kind: "needs-detail" };

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

  const terminalFenceSatisfied = (
    threadId: ThreadId,
    evidence: Pick<
      Parameters<typeof doesSnapshotSatisfyTerminalFence>[0],
      "snapshotSequence" | "sessionStatus" | "latestTurn" | "assistantMessageStored"
    >,
  ): boolean =>
    state.threadProjectionTerminalFencePending.has(threadId) &&
    doesSnapshotSatisfyTerminalFence({
      ...evidence,
      fenceSequence: state.threadProjectionTerminalFenceSequenceById.get(threadId) ?? -1,
      armedAtMs: state.threadProjectionTerminalFenceArmedAtById.get(threadId) ?? Date.now(),
      nowMs: Date.now(),
    });

  // The head answers whether the live projection is current without shipping the transcript. Repairs
  // the head cannot judge (a draft awaiting its thread, an unconfirmed send, interaction detail the
  // shell says is missing) and any failure fall back to the full detail.
  const verifyWithHead = async (
    threadId: ThreadId,
    subscriptionGeneration: number,
  ): Promise<HeadVerdict> => {
    const appliedSequence = state.threadSnapshotSequenceById.get(threadId);
    if (
      appliedSequence === undefined ||
      policy.isDraftThreadAwaitingProjection(threadId) ||
      hasPendingTurnDispatch(threadId) ||
      isPendingInteractionDetailMissing(threadId)
    ) {
      return { kind: "needs-detail" };
    }
    const head = await context.api.orchestration
      .getThreadDetailHead({ threadId })
      .catch(() => null);
    if (
      state.disposed ||
      state.threadSubscriptionGenerationById.get(threadId) !== subscriptionGeneration ||
      !canApplyThreadSnapshot({ threadId, leasedThreadIds: state.subscribedThreadIds })
    ) {
      return { kind: "superseded" };
    }
    const thread = getThreadFromState(context.store.getState(), threadId);
    if (head === null || thread === undefined) {
      return { kind: "needs-detail" };
    }
    const currentSequence = state.threadSnapshotSequenceById.get(threadId) ?? -1;
    // Like a full read, a head older than the live cursor says nothing about what has been applied.
    if (head.snapshotSequence < currentSequence) {
      return { kind: "superseded" };
    }
    if (!doesThreadDetailHeadMatch({ head, appliedSequence: currentSequence, thread })) {
      return { kind: "needs-detail" };
    }
    return {
      kind: "in-sync",
      snapshotSequence: head.snapshotSequence,
      fenceSatisfied: terminalFenceSatisfied(threadId, {
        snapshotSequence: head.snapshotSequence,
        sessionStatus: head.session?.status,
        latestTurn: head.latestTurn,
        assistantMessageStored: head.latestTurnAssistantMessageStored,
      }),
    };
  };

  const noteTurnSettledRepair = (threadId: ThreadId): void => {
    state.pendingCheckpointDiffThreadIds.add(threadId);
    state.pendingGitInvalidationThreadIds.add(threadId);
    batching.domainEventFlushThrottler.maybeExecute();
  };

  const reconcileThreadProjection = async (
    threadId: ThreadId,
    options?: { readonly queueIfInFlight?: boolean; readonly verifyWithHead?: boolean },
  ): Promise<void> => {
    const subscriptionGeneration = state.threadSubscriptionGenerationById.get(threadId);
    if (
      state.disposed ||
      !state.subscribedThreadIds.has(threadId) ||
      subscriptionGeneration === undefined ||
      policy.isAwaitingStreamSnapshot(threadId)
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
      const projectionRepairsTerminalFence =
        state.threadProjectionTerminalFencePending.has(threadId);
      if (options?.verifyWithHead === true) {
        const verdict = await verifyWithHead(threadId, subscriptionGeneration);
        if (verdict.kind === "superseded") {
          return;
        }
        if (verdict.kind === "in-sync") {
          // The head proved no detail event of this thread lies between the cursor and its sequence.
          const currentSequence = state.threadSnapshotSequenceById.get(threadId) ?? -1;
          state.threadSnapshotSequenceById.set(
            threadId,
            Math.max(currentSequence, verdict.snapshotSequence),
          );
          advanceThreadDetailResumeCursor(threadId, verdict.snapshotSequence);
          projectionConfirmed = true;
          projectionSatisfiesTerminalFence = verdict.fenceSatisfied;
          policy.resolveThreadCatchupBackoff(threadId).lastProjectionReconciledAt = Date.now();
          policy.noteThreadReconcileResult(threadId, true);
          if (projectionRepairsTerminalFence) {
            noteTurnSettledRepair(threadId);
          }
          return;
        }
      }

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
      const currentThread = getThreadFromState(context.store.getState(), threadId);
      const projectionSettlesCurrentTurn =
        currentThread?.latestTurn?.state === "running" &&
        snapshot.thread.latestTurn !== null &&
        snapshot.thread.latestTurn.turnId === currentThread.latestTurn.turnId &&
        snapshot.thread.latestTurn.state !== "running" &&
        snapshot.thread.latestTurn.completedAt !== null;
      const assistantMessageId = snapshot.thread.latestTurn?.assistantMessageId ?? null;
      projectionSatisfiesTerminalFence = terminalFenceSatisfied(threadId, {
        snapshotSequence: snapshot.snapshotSequence,
        sessionStatus: snapshot.thread.session?.status,
        latestTurn: snapshot.thread.latestTurn,
        assistantMessageStored:
          assistantMessageId !== null &&
          snapshot.thread.messages.some((message) => message.id === assistantMessageId),
      });
      state.threadSnapshotSequenceById.set(
        threadId,
        Math.max(currentSequence, snapshot.snapshotSequence),
      );
      advanceThreadDetailResumeCursor(threadId, snapshot.snapshotSequence);

      const catchupEntryBeforeApply = policy.resolveThreadCatchupBackoff(threadId);
      batching.flushQueuedDomainEventsNow();
      const stateBeforeProjectionApply = context.store.getState();
      context.syncServerThreadDetailHotPath(snapshot.thread, snapshot.snapshotSequence);
      state.threadResumeSeedSequenceById.delete(threadId);
      reconcilePromotedDraftFromThreadDetail(snapshot.thread);
      policy.flushThreadBuffer(threadId, snapshot.snapshotSequence);
      projectionConfirmed = true;
      catchupEntryBeforeApply.lastProjectionReconciledAt = Date.now();

      policy.noteThreadReconcileResult(
        threadId,
        snapshot.snapshotSequence <= currentSequence &&
          context.store.getState() === stateBeforeProjectionApply,
      );
      if (projectionSettlesCurrentTurn || projectionRepairsTerminalFence) {
        noteTurnSettledRepair(threadId);
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
