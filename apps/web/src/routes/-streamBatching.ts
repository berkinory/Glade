import { type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { Throttler } from "@tanstack/react-pacer";
import {
  activeGitStatusCwds,
  invalidateGitQueries,
  invalidateGitQueriesForCwds,
} from "../lib/gitQueryOptions";
import { invalidateProjectFileQueriesForCwds, projectQueryKeys } from "../lib/projectReactQuery";
import { providerQueryKeys } from "../lib/providerReactQuery";
import { coalesceOrchestrationUiEvents } from "../orchestrationEventCoalescing";
import { useStore } from "../store";
import {
  getCheckpointDiffInvalidationThreadIdForEvent,
  getGitInvalidationThreadIdForEvent,
  getProjectFileInvalidationThreadIdForEvent,
  isPotentiallyFileMutatingToolCompletion,
  resolveGitInvalidationCwdForThreadId,
  shouldInvalidateGitQueriesForEvent,
} from "./-rootEventInvalidation";
import { createCwdRefreshThrottle } from "./-cwdRefreshThrottle";
import { shouldFlushDomainEventImmediately } from "./-rootStreamPolicy";
import type { StreamContext } from "./-streamContracts";
import type { StreamState } from "./-streamState";

export function createStreamBatching(context: StreamContext, state: StreamState) {
  const { queryClient } = context;

  // Turn diffs, reverts and rollbacks refresh at once; tool completions mid-turn go through the throttles.
  const fileActivityRefresh = createCwdRefreshThrottle((cwd) => {
    void invalidateProjectFileQueriesForCwds(queryClient, [cwd]);
  });
  const gitActivityRefresh = createCwdRefreshThrottle((cwd) => {
    void invalidateGitQueriesForCwds(queryClient, [cwd]);
  });

  const invalidateFileChangeQueries = (resolveCwd: (threadId: ThreadId) => string | null) => {
    const fileChangeThreadIds = state.pendingCheckpointDiffThreadIds;
    const activityThreadIds = state.pendingProjectFileInvalidationThreadIds;
    state.pendingCheckpointDiffThreadIds = new Set();
    state.pendingProjectFileInvalidationThreadIds = new Set();
    for (const threadId of fileChangeThreadIds) {
      void queryClient.invalidateQueries({
        queryKey: providerQueryKeys.threadCheckpointDiffs(threadId),
      });
    }
    const immediateCwds = new Set<string>();
    const activityCwds = new Set<string>();
    for (const threadId of new Set([...fileChangeThreadIds, ...activityThreadIds])) {
      const cwd = resolveCwd(threadId);
      if (cwd === null) {
        void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
        return;
      }
      (fileChangeThreadIds.has(threadId) ? immediateCwds : activityCwds).add(cwd);
    }
    if (immediateCwds.size > 0)
      void invalidateProjectFileQueriesForCwds(queryClient, immediateCwds);
    fileActivityRefresh.refresh([...activityCwds].filter((cwd) => !immediateCwds.has(cwd)));
  };

  const invalidateGitQueriesForEvents = (resolveCwd: (threadId: ThreadId) => string | null) => {
    const toolThreadIds = state.pendingToolGitInvalidationThreadIds;
    const threadIds = state.pendingGitInvalidationThreadIds;
    state.pendingToolGitInvalidationThreadIds = new Set();
    state.pendingGitInvalidationThreadIds = new Set();
    if (state.needsBroadGitInvalidation) {
      state.needsBroadGitInvalidation = false;
      void invalidateGitQueries(queryClient);
      return;
    }
    const watchedCwds =
      toolThreadIds.size > 0 ? activeGitStatusCwds(queryClient) : new Set<string>();
    const scopedCwds = new Set<string>();
    const toolCwds = new Set<string>();
    for (const threadId of new Set([...threadIds, ...toolThreadIds])) {
      const cwd = resolveCwd(threadId);
      if (cwd === null) {
        void invalidateGitQueries(queryClient);
        return;
      }
      if (threadIds.has(threadId)) scopedCwds.add(cwd);
      else if (!watchedCwds.has(cwd)) toolCwds.add(cwd);
    }
    if (scopedCwds.size > 0) void invalidateGitQueriesForCwds(queryClient, scopedCwds);
    gitActivityRefresh.refresh([...toolCwds].filter((cwd) => !scopedCwds.has(cwd)));
  };

  const flushPendingDomainEvents = () => {
    if (state.pendingDomainEvents.length > 0) {
      context.applyOrchestrationEventsHotPath(
        coalesceOrchestrationUiEvents(state.pendingDomainEvents),
      );
      state.pendingDomainEvents = [];
    }
    const currentState = useStore.getState();
    const resolveCwd = (threadId: ThreadId) =>
      resolveGitInvalidationCwdForThreadId(currentState, threadId);
    invalidateFileChangeQueries(resolveCwd);
    invalidateGitQueriesForEvents(resolveCwd);
  };

  // Every queued event already advanced its thread cursor, so a snapshot accepted at or past that cursor
  // contains it. Flushing the queue on top of the snapshot would re-append streamed deltas and regress
  // newer session state, so callers apply the queue first.
  const flushQueuedDomainEventsNow = () => {
    domainEventFlushThrottler.cancel();
    flushPendingDomainEvents();
  };

  // While a batch is queued, no event flushes on its own: the batch ends with one flush.
  let queueingBatch = false;
  const queueDomainEventBatch = (queueEvents: () => void) => {
    queueingBatch = true;
    try {
      queueEvents();
    } finally {
      queueingBatch = false;
    }
    flushQueuedDomainEventsNow();
  };

  const queueDomainEvent = (event: OrchestrationEvent) => {
    state.pendingDomainEvents.push(event);
    const checkpointDiffThreadId = getCheckpointDiffInvalidationThreadIdForEvent(event);
    if (checkpointDiffThreadId) {
      state.pendingCheckpointDiffThreadIds.add(checkpointDiffThreadId);
    }
    const projectFileThreadId = getProjectFileInvalidationThreadIdForEvent(event);
    if (projectFileThreadId) {
      state.pendingProjectFileInvalidationThreadIds.add(projectFileThreadId);
    }
    if (shouldInvalidateGitQueriesForEvent(event)) {
      const threadId = getGitInvalidationThreadIdForEvent(event);
      if (!threadId) {
        state.needsBroadGitInvalidation = true;
      } else if (isPotentiallyFileMutatingToolCompletion(event)) {
        state.pendingToolGitInvalidationThreadIds.add(threadId);
      } else {
        state.pendingGitInvalidationThreadIds.add(threadId);
      }
    }
    if (
      shouldFlushDomainEventImmediately(event, state.immediatelyFlushedAssistantMessageIds) &&
      !queueingBatch
    ) {
      flushQueuedDomainEventsNow();
      return;
    }
    if (!queueingBatch) domainEventFlushThrottler.maybeExecute();
  };

  const domainEventFlushThrottler = new Throttler(
    () => {
      flushPendingDomainEvents();
    },
    {
      wait: 100,
      leading: false,
      trailing: true,
    },
  );
  const cancelPendingRefreshes = () => {
    domainEventFlushThrottler.cancel();
    fileActivityRefresh.cancel();
    gitActivityRefresh.cancel();
  };

  return {
    cancelPendingRefreshes,
    flushPendingDomainEvents,
    flushQueuedDomainEventsNow,
    queueDomainEvent,
    queueDomainEventBatch,
    domainEventFlushThrottler,
  };
}
