import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { Throttler } from "@tanstack/react-pacer";
import { invalidateGitQueries, invalidateGitQueriesForCwds } from "../lib/gitQueryOptions";
import { invalidateProjectFileQueriesForCwds, projectQueryKeys } from "../lib/projectReactQuery";
import { providerQueryKeys } from "../lib/providerReactQuery";
import { coalesceOrchestrationUiEvents } from "../orchestrationEventCoalescing";
import { useStore } from "../store";
import {
  getGitInvalidationThreadIdForEvent,
  getProjectFileInvalidationThreadIdForEvent,
  resolveGitInvalidationCwdForThreadId,
  shouldInvalidateGitQueriesForEvent,
  shouldInvalidateProviderQueriesForEvent,
} from "./-rootEventInvalidation";
import { shouldFlushDomainEventImmediately } from "./-rootStreamPolicy";
import type { StreamContext } from "./-streamContracts";
import type { StreamState } from "./-streamState";

export function createStreamBatching(context: StreamContext, state: StreamState) {
  const flushPendingDomainEvents = () => {
    if (state.pendingDomainEvents.length > 0) {
      context.applyOrchestrationEventsHotPath(
        coalesceOrchestrationUiEvents(state.pendingDomainEvents),
      );
      state.pendingDomainEvents = [];
    }
    if (state.needsProviderInvalidation) {
      state.needsProviderInvalidation = false;
      state.pendingProjectFileInvalidationThreadIds = new Set();
      void context.queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });

      void context.queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
    } else if (state.pendingProjectFileInvalidationThreadIds.size > 0) {
      const currentState = useStore.getState();
      const fileChangeCwds = new Set<string>();
      for (const threadId of state.pendingProjectFileInvalidationThreadIds) {
        const cwd = resolveGitInvalidationCwdForThreadId(currentState, threadId);
        if (cwd) {
          fileChangeCwds.add(cwd);
        }
      }
      state.pendingProjectFileInvalidationThreadIds = new Set();
      if (fileChangeCwds.size > 0) {
        void invalidateProjectFileQueriesForCwds(context.queryClient, fileChangeCwds);
      } else {
        void context.queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
      }
    }
    if (state.needsBroadGitInvalidation) {
      state.needsBroadGitInvalidation = false;
      state.pendingGitInvalidationThreadIds = new Set();
      void invalidateGitQueries(context.queryClient);
    } else if (state.pendingGitInvalidationThreadIds.size > 0) {
      const currentState = useStore.getState();
      const scopedCwds = new Set<string>();
      let hasUnresolvedThread = false;
      for (const threadId of state.pendingGitInvalidationThreadIds) {
        const cwd = resolveGitInvalidationCwdForThreadId(currentState, threadId);
        if (cwd) {
          scopedCwds.add(cwd);
        } else {
          hasUnresolvedThread = true;
        }
      }
      state.pendingGitInvalidationThreadIds = new Set();
      if (hasUnresolvedThread || scopedCwds.size === 0) {
        void invalidateGitQueries(context.queryClient);
      } else {
        void invalidateGitQueriesForCwds(context.queryClient, scopedCwds);
      }
    }
  };

  const queueDomainEvent = (event: OrchestrationEvent) => {
    state.pendingDomainEvents.push(event);
    if (shouldInvalidateProviderQueriesForEvent(event)) {
      state.needsProviderInvalidation = true;
    }
    const projectFileThreadId = getProjectFileInvalidationThreadIdForEvent(event);
    if (projectFileThreadId) {
      state.pendingProjectFileInvalidationThreadIds.add(projectFileThreadId);
    }
    if (shouldInvalidateGitQueriesForEvent(event)) {
      const threadId = getGitInvalidationThreadIdForEvent(event);
      if (threadId) {
        state.pendingGitInvalidationThreadIds.add(threadId);
      } else {
        state.needsBroadGitInvalidation = true;
      }
    }
    if (shouldFlushDomainEventImmediately(event, state.immediatelyFlushedAssistantMessageIds)) {
      domainEventFlushThrottler.cancel();
      flushPendingDomainEvents();
      return;
    }
    domainEventFlushThrottler.maybeExecute();
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
  return { flushPendingDomainEvents, queueDomainEvent, domainEventFlushThrottler };
}
