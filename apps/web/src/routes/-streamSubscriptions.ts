import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationShellSnapshot } from "@glade/contracts/orchestration/snapshots";
import { useComposerDraftStore } from "../composerDraftStore";
import { dockTerminalThreadId } from "../lib/dockTerminalScope";
import {
  collectActiveTerminalThreadIds,
  removeOrphanedTerminalRuntimes,
} from "../lib/terminalStateCleanup";
import {
  registerEmptyRouteRestoreRefresh,
  runEmptyRouteRestoreRefresh,
} from "../routeRestoreRefreshCoordinator";
import { useStore } from "../store";
import { getThreadsFromState } from "../threadDerivation";
import {
  buildThreadSubscribeInput,
  clearThreadDetailResumeCursor,
} from "../threadDetailResumeCursors";
import {
  SHELL_SNAPSHOT_BOOTSTRAP_FALLBACK_DELAY_MS,
  reconcilePromotedDraftsFromShellThreads,
  releaseOrphanedThreadDetail,
} from "./-rootStreamPolicy";
import type { StreamContext, StreamOperations } from "./-streamContracts";
import type { createStreamPolicy } from "./-streamPolicy";
import type { StreamState } from "./-streamState";
export function createStreamSubscriptions(
  context: StreamContext,
  state: StreamState,
  operations: StreamOperations,
  policy: ReturnType<typeof createStreamPolicy>,
) {
  const flushShellBuffer = (snapshotSequence: number) => {
    const nextPending = state.pendingShellEvents
      .filter((event) => event.sequence > snapshotSequence)
      .toSorted((left, right) => left.sequence - right.sequence);
    state.pendingShellEvents = [];
    for (const event of nextPending) {
      state.shellSnapshotSequence = Math.max(state.shellSnapshotSequence, event.sequence);
      context.applyShellEvent(event);
    }
  };

  const reconcileThreadSubscriptions = async (threadIds: readonly ThreadId[]) => {
    const nextThreadIds = new Set(threadIds);
    const removals = [...state.subscribedThreadIds].filter(
      (threadId) => !nextThreadIds.has(threadId),
    );
    const additions = [...nextThreadIds].filter(
      (threadId) => !state.subscribedThreadIds.has(threadId),
    );

    for (const threadId of removals) {
      state.threadSnapshotSequenceById.delete(threadId);
      state.pendingThreadEventsById.delete(threadId);
      state.threadSnapshotRequestInFlight.delete(threadId);
      state.threadSnapshotRefreshPending.delete(threadId);
      state.threadSnapshotNotFoundRetryAttempted.delete(threadId);
      state.threadReplayRequestInFlight.delete(threadId);
      state.threadProjectionReconcileInFlight.delete(threadId);
      state.threadProjectionReconcilePendingById.delete(threadId);
      policy.clearThreadProjectionTerminalFence(threadId);
      state.threadSubscriptionGenerationById.delete(threadId);
      state.nextThreadProjectionReconcileAtById.delete(threadId);
      state.threadCatchupBackoffById.delete(threadId);
      state.subscribedThreadIds.delete(threadId);
    }
    // A retention eviction can refresh a thread whose lease is dropping in the same tick, so the
    // refreshed snapshot may already have landed. Retention no longer owns the entry, and eviction only
    // runs from retention entries, so without this the restored slices stay in the store forever.
    releaseOrphanedThreadDetail({ releasedThreadIds: removals });
    await Promise.all(
      removals.map((threadId) =>
        context.api.orchestration.unsubscribeThread({ threadId }).catch(() => undefined),
      ),
    );

    for (const threadId of additions) {
      policy.beginThreadSubscription(threadId);
      state.subscribedThreadIds.add(threadId);
    }
    await Promise.all(
      additions.map((threadId) =>
        context.api.orchestration
          .subscribeThread(buildThreadSubscribeInput(threadId))
          .catch(() => undefined),
      ),
    );
  };

  const enqueueThreadSubscriptionOperation = (operation: () => Promise<void>) => {
    state.reconcileThreadSubscriptionsChain = state.reconcileThreadSubscriptionsChain
      .catch(() => undefined)
      .then(operation);
    return state.reconcileThreadSubscriptionsChain;
  };

  const enqueueThreadSubscriptionReconcile = (threadIds: readonly ThreadId[]) => {
    const nextThreadIds = [...threadIds];
    return enqueueThreadSubscriptionOperation(() => reconcileThreadSubscriptions(nextThreadIds));
  };

  const refreshThreadSnapshot = (threadId: ThreadId): Promise<void> => {
    if (state.threadSnapshotRequestInFlight.has(threadId)) {
      // The in-flight snapshot predates whatever triggered this call (a retention eviction wiped detail
      // the running request cannot know about), so re-arm instead of dropping it and leaving the thread
      // blank.
      state.threadSnapshotRefreshPending.add(threadId);
      return Promise.resolve();
    }
    state.threadSnapshotRequestInFlight.add(threadId);
    return enqueueThreadSubscriptionOperation(async () => {
      if (state.disposed || !state.subscribedThreadIds.has(threadId)) {
        return;
      }
      await context.api.orchestration.unsubscribeThread({ threadId }).catch(() => undefined);
      if (state.disposed || !state.subscribedThreadIds.has(threadId)) {
        return;
      }

      clearThreadDetailResumeCursor(threadId);
      await context.api.orchestration.subscribeThread({ threadId }).catch(() => undefined);
    }).finally(() => {
      state.threadSnapshotRequestInFlight.delete(threadId);
      if (!state.threadSnapshotRefreshPending.delete(threadId)) {
        return;
      }
      if (state.disposed || !state.subscribedThreadIds.has(threadId)) {
        return;
      }
      void refreshThreadSnapshot(threadId);
    });
  };

  const shouldApplyBootstrapShellSnapshot = (snapshot: OrchestrationShellSnapshot) => {
    if (state.disposed) {
      return false;
    }
    const currentState = useStore.getState();
    if (!currentState.threadsHydrated) {
      return true;
    }

    return (
      (currentState.spaces.length === 0 && snapshot.spaces.length > 0) ||
      (currentState.projects.length === 0 && snapshot.projects.length > 0) ||
      ((currentState.threadIds?.length ?? 0) === 0 && snapshot.threads.length > 0)
    );
  };

  function collectSubscribedDraftsInShell(
    threads: ReadonlyArray<OrchestrationShellSnapshot["threads"][number]>,
  ): ThreadId[] {
    const draftsByThreadId = useComposerDraftStore.getState().draftThreadsByThreadId;
    return threads
      .map((thread) => thread.id)
      .filter(
        (threadId) => state.subscribedThreadIds.has(threadId) && threadId in draftsByThreadId,
      );
  }

  function reconcileMissingSubscribedThreadProjections(threadIds: readonly ThreadId[]) {
    for (const threadId of threadIds) {
      if (!state.threadSnapshotSequenceById.has(threadId)) {
        void operations.reconcileThreadProjection(threadId).catch(() => undefined);
      }
    }
  }

  const applyAuthoritativeShellSnapshot = (snapshot: OrchestrationShellSnapshot) => {
    if (state.disposed) return false;

    if (
      state.shellSnapshotSequence >= 0 &&
      snapshot.snapshotSequence < state.shellSnapshotSequence
    ) {
      return false;
    }
    const promotedDraftThreadIds = collectSubscribedDraftsInShell(snapshot.threads);
    state.shellSnapshotSequence = snapshot.snapshotSequence;
    context.syncServerShellSnapshot(snapshot);
    reconcilePromotedDraftsFromShellThreads(snapshot.threads);
    flushShellBuffer(snapshot.snapshotSequence);
    removeOrphanedTerminalsForCurrentState();
    reconcileMissingSubscribedThreadProjections(promotedDraftThreadIds);
    return true;
  };

  const applyQueriedShellSnapshot = (snapshot: OrchestrationShellSnapshot) => {
    if (!shouldApplyBootstrapShellSnapshot(snapshot)) {
      return false;
    }
    return applyAuthoritativeShellSnapshot(snapshot);
  };

  // Collection emptiness is valid user state, so it cannot indicate whether bootstrap succeeded.
  const needsBootstrapShellSnapshot = (generation: number) =>
    state.shellSnapshotReceivedGeneration < generation;

  const loadBootstrapShellSnapshotIfMissing = async (generation: number) => {
    if (
      state.disposed ||
      generation !== state.shellSubscriptionGeneration ||
      !needsBootstrapShellSnapshot(generation)
    ) {
      return;
    }
    const snapshot = await context.api.orchestration.getShellSnapshot();
    if (
      state.disposed ||
      generation !== state.shellSubscriptionGeneration ||
      !needsBootstrapShellSnapshot(generation)
    ) {
      return;
    }
    if (applyAuthoritativeShellSnapshot(snapshot)) {
      state.shellSnapshotReceivedGeneration = generation;
    }
  };

  const scheduleShellSnapshotFallback = (generation: number) => {
    state.shellSnapshotFallbackTimer = window.setTimeout(() => {
      state.shellSnapshotFallbackTimer = null;
      void loadBootstrapShellSnapshotIfMissing(generation).catch(() => undefined);
    }, SHELL_SNAPSHOT_BOOTSTRAP_FALLBACK_DELAY_MS);
  };

  const unregisterEmptyRouteRestoreRefresh = registerEmptyRouteRestoreRefresh(() =>
    runEmptyRouteRestoreRefresh({
      getShellSnapshot: () => context.api.orchestration.getShellSnapshot(),
      getSnapshot: () => context.api.orchestration.getSnapshot(),
      repairState: () => context.api.orchestration.repairState(),
      applyShellSnapshot: applyQueriedShellSnapshot,
      hasThreads: () => (useStore.getState().threadIds?.length ?? 0) > 0,
    }),
  );

  const ensureScopedSubscriptions = () => {
    if (state.scopedSubscriptionRefresh) {
      return state.scopedSubscriptionRefresh;
    }
    state.shellSubscriptionGeneration += 1;
    const generation = state.shellSubscriptionGeneration;
    if (state.shellSnapshotFallbackTimer !== null) {
      window.clearTimeout(state.shellSnapshotFallbackTimer);
      state.shellSnapshotFallbackTimer = null;
    }
    scheduleShellSnapshotFallback(generation);
    const refresh = (async () => {
      state.shellSnapshotSequence = -1;
      state.pendingShellEvents = [];
      await context.api.orchestration
        .subscribeShell()
        .catch(() => loadBootstrapShellSnapshotIfMissing(generation));
      await enqueueThreadSubscriptionOperation(async () => {
        state.threadSnapshotSequenceById.clear();
        state.pendingThreadEventsById.clear();
        state.threadSnapshotRequestInFlight.clear();
        state.threadSnapshotRefreshPending.clear();
        state.threadReplayRequestInFlight.clear();
        state.threadProjectionReconcileInFlight.clear();
        state.threadProjectionTerminalFencePending.clear();
        state.threadProjectionTerminalFenceSequenceById.clear();
        state.threadProjectionTerminalFenceArmedAtById.clear();
        state.threadSubscriptionGenerationById.clear();
        state.nextThreadProjectionReconcileAtById.clear();
        state.threadCatchupBackoffById.clear();
        const previousThreadIds = [...state.subscribedThreadIds];
        state.subscribedThreadIds.clear();

        releaseOrphanedThreadDetail({
          releasedThreadIds: previousThreadIds,
          keptThreadIds: new Set(context.visibleThreadIdsRef.current),
        });
        await Promise.all(
          previousThreadIds.map((threadId) =>
            context.api.orchestration.unsubscribeThread({ threadId }).catch(() => undefined),
          ),
        );
        await reconcileThreadSubscriptions(context.visibleThreadIdsRef.current);
      });
    })().finally(() => {
      if (state.scopedSubscriptionRefresh === refresh) {
        state.scopedSubscriptionRefresh = null;
      }
    });
    state.scopedSubscriptionRefresh = refresh;
    return refresh;
  };

  const removeOrphanedTerminalsForCurrentState = () => {
    const draftThreadIds = Object.keys(
      useComposerDraftStore.getState().draftThreadsByThreadId,
    ) as ThreadId[];
    const activeThreadIds = collectActiveTerminalThreadIds({
      snapshotThreads: getThreadsFromState(useStore.getState()).map((thread) => ({
        id: thread.id,
        deletedAt: null,
        archivedAt: thread.archivedAt ?? null,
      })),
      draftThreadIds,
    });

    for (const activeThreadId of Array.from(activeThreadIds)) {
      activeThreadIds.add(dockTerminalThreadId(activeThreadId));
    }
    context.removeOrphanedTerminalStates(activeThreadIds);
    removeOrphanedTerminalRuntimes(activeThreadIds);
  };
  return {
    flushShellBuffer,
    reconcileThreadSubscriptions,
    enqueueThreadSubscriptionOperation,
    enqueueThreadSubscriptionReconcile,
    refreshThreadSnapshot,
    shouldApplyBootstrapShellSnapshot,
    applyAuthoritativeShellSnapshot,
    applyQueriedShellSnapshot,
    needsBootstrapShellSnapshot,
    loadBootstrapShellSnapshotIfMissing,
    scheduleShellSnapshotFallback,
    unregisterEmptyRouteRestoreRefresh,
    ensureScopedSubscriptions,
    removeOrphanedTerminalsForCurrentState,
    collectSubscribedDraftsInShell,
    reconcileMissingSubscribedThreadProjections,
  };
}
