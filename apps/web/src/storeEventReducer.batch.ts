import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import {
  createThreadActivityAccumulator,
  withOrchestrationEventSequence,
} from "./storeNormalization.activity";
import { applyThreadUpdate } from "./storeProjection.mutations";
import type { AppState } from "./storeState";
import {
  reconcilePendingInteractionsFromActivity,
  threadActivityUpdatesSummary,
} from "./storeEventReducer.eventHelpers";
import type {
  ApplyOrchestrationEventOptions,
  ThreadActivityAppendedEvent,
} from "./storeEventReducer.eventHelpers";
import { applyOrchestrationEvent } from "./storeEventReducer.events";
function applyThreadActivityEventBatch(
  state: AppState,
  events: ReadonlyArray<ThreadActivityAppendedEvent>,
  options: ApplyOrchestrationEventOptions,
): AppState {
  const firstEvent = events[0];
  if (!firstEvent) {
    return state;
  }
  const updatesSummary = events.some(threadActivityUpdatesSummary);
  return applyThreadUpdate(
    state,
    firstEvent.payload.threadId,
    (thread) => {
      const activityAccumulator = createThreadActivityAccumulator(thread.activities);
      let nextPendingInteractions = thread.pendingInteractions;
      let updatedAt = thread.updatedAt ?? thread.createdAt;
      for (const event of events) {
        const sequencedActivity = withOrchestrationEventSequence(
          event.payload.activity,
          event.sequence,
        );
        const activitiesChanged = activityAccumulator.append(sequencedActivity);
        const reconciledPendingInteractions = reconcilePendingInteractionsFromActivity(
          thread.id,
          nextPendingInteractions,
          event,
        );
        const changed =
          activitiesChanged || reconciledPendingInteractions !== nextPendingInteractions;
        nextPendingInteractions = reconciledPendingInteractions;
        if (changed && sequencedActivity.createdAt > updatedAt) {
          updatedAt = sequencedActivity.createdAt;
        }
      }
      const nextActivities = activityAccumulator.result();
      if (
        nextActivities === thread.activities &&
        nextPendingInteractions === thread.pendingInteractions
      ) {
        return thread;
      }
      return {
        ...thread,
        activities: nextActivities,
        ...(nextPendingInteractions !== undefined
          ? { pendingInteractions: nextPendingInteractions }
          : {}),
        updatedAt,
      };
    },
    {
      ...options,
      recomputeSummarySignals: updatesSummary,
      updateSidebarSummary: options.updateSidebarSummary === true || updatesSummary,
    },
  );
}

export function applyOrchestrationEvents(
  state: AppState,
  events: ReadonlyArray<OrchestrationEvent>,
): AppState {
  return applyOrchestrationEventsHotPath(state, events, {
    updateSidebarSummary: false,
  });
}

export function applyOrchestrationEventsHotPath(
  state: AppState,
  events: ReadonlyArray<OrchestrationEvent>,
  options?: ApplyOrchestrationEventOptions,
): AppState {
  const normalizedOptions = {
    updateSidebarSummary: options?.updateSidebarSummary ?? false,
  };
  let nextState = state;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.type === "thread.activity-appended") {
      const activityEvents = [event];
      while (index + 1 < events.length) {
        const nextEvent = events[index + 1];
        if (
          nextEvent?.type !== "thread.activity-appended" ||
          nextEvent.payload.threadId !== event.payload.threadId
        ) {
          break;
        }
        activityEvents.push(nextEvent);
        index += 1;
      }
      nextState = applyThreadActivityEventBatch(nextState, activityEvents, normalizedOptions);
      continue;
    }
    nextState = applyOrchestrationEvent(nextState, event, normalizedOptions);
  }
  return nextState;
}
