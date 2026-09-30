import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationShellSnapshot } from "@glade/contracts/orchestration/snapshots";
import { clearThreadDetailResumeCursor } from "./threadDetailResumeCursors";
import { getThreadFromState } from "./threadDerivation";
import {
  capThreadActivities,
  dedupeActivitiesByIdAfterAppend,
} from "./storeNormalization.activity";
import { normalizeThreadShellSnapshot } from "./storeNormalization.threads";
import {
  recordsShallowEqual,
  threadSessionsEqual,
  threadShellsEqual,
  threadTurnStatesEqual,
} from "./storeNormalization.shared";
import {
  EMPTY_ACTIVITY_BY_THREAD,
  EMPTY_ACTIVITY_IDS_BY_THREAD,
  EMPTY_MESSAGE_BY_THREAD,
  EMPTY_MESSAGE_IDS_BY_THREAD,
  EMPTY_PROPOSED_PLAN_BY_THREAD,
  EMPTY_PROPOSED_PLAN_IDS_BY_THREAD,
  EMPTY_THREAD_IDS,
  EMPTY_THREAD_SESSION_BY_ID,
  EMPTY_THREAD_SHELL_BY_ID,
  EMPTY_THREAD_TURN_STATE_BY_ID,
  EMPTY_TURN_DIFF_BY_THREAD,
  EMPTY_TURN_DIFF_IDS_BY_THREAD,
  type AppState,
  type ThreadDetailSyncState,
} from "./storeState";
import type { Thread, ThreadSession, ThreadShell, ThreadTurnState } from "./types";
import {
  activityId,
  buildNormalizedSlice,
  messageId,
  proposedPlanId,
  toThreadShell,
  toThreadTurnState,
  turnDiffId,
} from "./storeProjection.records";

function ensureThreadRegistered(state: AppState, threadId: ThreadId): AppState {
  const threadIds = state.threadIds ?? EMPTY_THREAD_IDS;
  if (threadIds.includes(threadId)) {
    return state;
  }
  return {
    ...state,
    threadIds: [...threadIds, threadId],
  };
}

export function retainThreadScopedRecord<T>(
  record: Record<ThreadId, T> | undefined,
  nextThreadIds: ReadonlySet<ThreadId>,
): Record<ThreadId, T> {
  if (!record) {
    return {};
  }
  let changed = false;
  const nextRecord: Record<ThreadId, T> = {};
  for (const [threadId, value] of Object.entries(record) as [ThreadId, T][]) {
    if (!nextThreadIds.has(threadId)) {
      changed = true;
      continue;
    }
    nextRecord[threadId] = value;
  }
  return changed ? nextRecord : record;
}

function resolveShellEntry(previous: ThreadShell | undefined, next: ThreadShell): ThreadShell {
  return previous !== undefined && threadShellsEqual(previous, next) ? previous : next;
}

function resolveSessionEntry(
  previous: ThreadSession | null | undefined,
  next: ThreadSession | null,
): ThreadSession | undefined {
  if (next === null) {
    return undefined;
  }
  return previous != null && threadSessionsEqual(previous, next) ? previous : next;
}

function resolveTurnStateEntry(
  previous: ThreadTurnState | undefined,
  next: ThreadTurnState,
): ThreadTurnState {
  return previous !== undefined && threadTurnStatesEqual(previous, next) ? previous : next;
}

export function writeThreadShellProjection(
  state: AppState,
  nextThread: {
    shell: ThreadShell;
    session: ThreadSession | null;
    turnState: ThreadTurnState;
  },
): AppState {
  const threadId = nextThread.shell.id;
  let nextState = ensureThreadRegistered(state, threadId);

  const previousShellById = nextState.threadShellById ?? EMPTY_THREAD_SHELL_BY_ID;
  const shell = resolveShellEntry(previousShellById[threadId], nextThread.shell);
  if (shell !== previousShellById[threadId]) {
    nextState = {
      ...nextState,
      threadShellById: { ...previousShellById, [threadId]: shell },
    };
  }

  const previousSessionById = nextState.threadSessionById ?? EMPTY_THREAD_SESSION_BY_ID;
  const previousSession = previousSessionById[threadId];
  const session = resolveSessionEntry(previousSession, nextThread.session);
  if (session !== previousSession) {
    const threadSessionById = { ...previousSessionById };
    if (session === undefined) {
      delete threadSessionById[threadId];
    } else {
      threadSessionById[threadId] = session;
    }
    nextState = { ...nextState, threadSessionById };
  }

  const previousTurnStateById = nextState.threadTurnStateById ?? EMPTY_THREAD_TURN_STATE_BY_ID;
  const turnState = resolveTurnStateEntry(previousTurnStateById[threadId], nextThread.turnState);
  if (turnState !== previousTurnStateById[threadId]) {
    nextState = {
      ...nextState,
      threadTurnStateById: { ...previousTurnStateById, [threadId]: turnState },
    };
  }

  return nextState;
}

export // Every equality guard therefore failed by construction, so each of the three records was re-spread
// for every thread: O(n²) property copies per snapshot. Each entry goes through the same
// `resolve*Entry` rule the per-thread writer uses, so the two paths cannot drift: a thread that did
// not change keeps the object already stored, and a thread without a session leaves no key behind.
function rebuildThreadShellRecords(
  state: AppState,
  snapshotThreads: readonly OrchestrationShellSnapshot["threads"][number][],
  snapshotSequence: number,
): {
  threadShellById: Record<ThreadId, ThreadShell>;
  threadSessionById: Record<ThreadId, ThreadSession | null>;
  threadTurnStateById: Record<ThreadId, ThreadTurnState>;
} {
  const previousShellById = state.threadShellById ?? EMPTY_THREAD_SHELL_BY_ID;
  const previousSessionById = state.threadSessionById ?? EMPTY_THREAD_SESSION_BY_ID;
  const previousTurnStateById = state.threadTurnStateById ?? EMPTY_THREAD_TURN_STATE_BY_ID;

  const threadShellById = {} as Record<ThreadId, ThreadShell>;
  const threadSessionById = {} as Record<ThreadId, ThreadSession | null>;
  const threadTurnStateById = {} as Record<ThreadId, ThreadTurnState>;

  for (const thread of snapshotThreads) {
    const previousThread = getThreadFromState(state, thread.id);
    const next = normalizeThreadShellSnapshot(
      thread,
      previousThread,
      thread.claudeCacheReview != null || previousThread?.claudeCacheReviewSequence !== undefined
        ? snapshotSequence
        : undefined,
    );
    const threadId = next.shell.id;

    threadShellById[threadId] = resolveShellEntry(previousShellById[threadId], next.shell);

    const session = resolveSessionEntry(previousSessionById[threadId], next.session);
    if (session !== undefined) {
      threadSessionById[threadId] = session;
    }

    threadTurnStateById[threadId] = resolveTurnStateEntry(
      previousTurnStateById[threadId],
      next.turnState,
    );
  }

  return {
    threadShellById: recordsShallowEqual(previousShellById, threadShellById)
      ? previousShellById
      : threadShellById,
    threadSessionById: recordsShallowEqual(previousSessionById, threadSessionById)
      ? previousSessionById
      : threadSessionById,
    threadTurnStateById: recordsShallowEqual(previousTurnStateById, threadTurnStateById)
      ? previousTurnStateById
      : threadTurnStateById,
  };
}

export function writeThreadDetailSyncState(
  state: AppState,
  threadId: ThreadId,
  syncState: ThreadDetailSyncState,
): AppState {
  if (state.threadDetailSyncById?.[threadId] === syncState) {
    return state;
  }
  return {
    ...state,
    threadDetailSyncById: {
      ...state.threadDetailSyncById,
      [threadId]: syncState,
    },
  };
}

function clearThreadDetailSyncState(state: AppState, threadId: ThreadId): AppState {
  // Single-thread detail-wipe choke point: every transition that removes or invalidates a thread's
  // cached detail (removeThreadState, eviction, sync failure reset) funnels through here, so this is
  // where the resume-cursor invariant is enforced — wiped detail must never leave a cursor that would
  // let a resubscribe gap-replay on top of missing history.
  clearThreadDetailResumeCursor(threadId);
  if (
    state.threadDetailSyncById === undefined ||
    !Object.hasOwn(state.threadDetailSyncById, threadId)
  ) {
    return state;
  }
  const { [threadId]: _removed, ...threadDetailSyncById } = state.threadDetailSyncById;
  return { ...state, threadDetailSyncById };
}

export function markThreadDetailSyncFailedInClientState(
  state: AppState,
  threadId: ThreadId,
): AppState {
  return writeThreadDetailSyncState(state, threadId, "failed");
}

export function clearThreadDetailSyncFailureInClientState(
  state: AppState,
  threadId: ThreadId,
): AppState {
  if (state.threadDetailSyncById?.[threadId] !== "failed") {
    return state;
  }
  return clearThreadDetailSyncState(state, threadId);
}

export function writeThreadState(
  state: AppState,
  nextThread: Thread,
  previousThread?: Thread,
): AppState {
  const nextShell = toThreadShell(nextThread);
  const nextTurnState = toThreadTurnState(nextThread);
  const previousShell = state.threadShellById?.[nextThread.id];
  const previousTurnState = state.threadTurnStateById?.[nextThread.id];

  let nextState = ensureThreadRegistered(state, nextThread.id);

  if (!threadShellsEqual(previousShell, nextShell)) {
    nextState = {
      ...nextState,
      threadShellById: {
        ...(nextState.threadShellById ?? EMPTY_THREAD_SHELL_BY_ID),
        [nextThread.id]: nextShell,
      },
    };
  }

  if (!threadSessionsEqual(previousThread?.session ?? null, nextThread.session)) {
    nextState = {
      ...nextState,
      threadSessionById: {
        ...(nextState.threadSessionById ?? EMPTY_THREAD_SESSION_BY_ID),
        [nextThread.id]: nextThread.session,
      },
    };
  }

  if (!threadTurnStatesEqual(previousTurnState, nextTurnState)) {
    nextState = {
      ...nextState,
      threadTurnStateById: {
        ...(nextState.threadTurnStateById ?? EMPTY_THREAD_TURN_STATE_BY_ID),
        [nextThread.id]: nextTurnState,
      },
    };
  }

  if (previousThread?.messages !== nextThread.messages) {
    const previousIds = nextState.messageIdsByThreadId?.[nextThread.id];
    const previousById = nextState.messageByThreadId?.[nextThread.id];
    const slice = buildNormalizedSlice(
      nextThread.messages,
      messageId,
      previousThread?.messages,
      previousIds,
      previousById,
    );
    if (slice.ids !== previousIds) {
      nextState = {
        ...nextState,
        messageIdsByThreadId: {
          ...(nextState.messageIdsByThreadId ?? EMPTY_MESSAGE_IDS_BY_THREAD),
          [nextThread.id]: slice.ids,
        },
      };
    }
    if (slice.byId !== previousById) {
      nextState = {
        ...nextState,
        messageByThreadId: {
          ...(nextState.messageByThreadId ?? EMPTY_MESSAGE_BY_THREAD),
          [nextThread.id]: slice.byId,
        },
      };
    }
  }

  if (previousThread?.activities !== nextThread.activities) {
    const previousIds = nextState.activityIdsByThreadId?.[nextThread.id];
    const previousById = nextState.activityByThreadId?.[nextThread.id];
    const activities = capThreadActivities(
      dedupeActivitiesByIdAfterAppend(
        nextThread.activities,
        previousThread?.activities,
        previousById,
      ),
    );
    const slice = buildNormalizedSlice(
      activities,
      activityId,
      previousThread?.activities,
      previousIds,
      previousById,
    );
    if (slice.ids !== previousIds) {
      nextState = {
        ...nextState,
        activityIdsByThreadId: {
          ...(nextState.activityIdsByThreadId ?? EMPTY_ACTIVITY_IDS_BY_THREAD),
          [nextThread.id]: slice.ids,
        },
      };
    }
    if (slice.byId !== previousById) {
      nextState = {
        ...nextState,
        activityByThreadId: {
          ...(nextState.activityByThreadId ?? EMPTY_ACTIVITY_BY_THREAD),
          [nextThread.id]: slice.byId,
        },
      };
    }
  }

  if (previousThread?.proposedPlans !== nextThread.proposedPlans) {
    const previousIds = nextState.proposedPlanIdsByThreadId?.[nextThread.id];
    const previousById = nextState.proposedPlanByThreadId?.[nextThread.id];
    const slice = buildNormalizedSlice(
      nextThread.proposedPlans,
      proposedPlanId,
      previousThread?.proposedPlans,
      previousIds,
      previousById,
    );
    if (slice.ids !== previousIds) {
      nextState = {
        ...nextState,
        proposedPlanIdsByThreadId: {
          ...(nextState.proposedPlanIdsByThreadId ?? EMPTY_PROPOSED_PLAN_IDS_BY_THREAD),
          [nextThread.id]: slice.ids,
        },
      };
    }
    if (slice.byId !== previousById) {
      nextState = {
        ...nextState,
        proposedPlanByThreadId: {
          ...(nextState.proposedPlanByThreadId ?? EMPTY_PROPOSED_PLAN_BY_THREAD),
          [nextThread.id]: slice.byId,
        },
      };
    }
  }

  if (previousThread?.turnDiffSummaries !== nextThread.turnDiffSummaries) {
    const previousIds = nextState.turnDiffIdsByThreadId?.[nextThread.id];
    const previousById = nextState.turnDiffSummaryByThreadId?.[nextThread.id];
    const slice = buildNormalizedSlice(
      nextThread.turnDiffSummaries,
      turnDiffId,
      previousThread?.turnDiffSummaries,
      previousIds,
      previousById,
    );
    if (slice.ids !== previousIds) {
      nextState = {
        ...nextState,
        turnDiffIdsByThreadId: {
          ...(nextState.turnDiffIdsByThreadId ?? EMPTY_TURN_DIFF_IDS_BY_THREAD),
          [nextThread.id]: slice.ids,
        },
      };
    }
    if (slice.byId !== previousById) {
      nextState = {
        ...nextState,
        turnDiffSummaryByThreadId: {
          ...(nextState.turnDiffSummaryByThreadId ?? EMPTY_TURN_DIFF_BY_THREAD),
          [nextThread.id]: slice.byId,
        },
      };
    }
  }

  return nextState;
}

export function removeThreadState(state: AppState, threadId: ThreadId): AppState {
  const { [threadId]: _removedShell, ...threadShellById } =
    state.threadShellById ?? EMPTY_THREAD_SHELL_BY_ID;
  const { [threadId]: _removedSession, ...threadSessionById } =
    state.threadSessionById ?? EMPTY_THREAD_SESSION_BY_ID;
  const { [threadId]: _removedTurnState, ...threadTurnStateById } =
    state.threadTurnStateById ?? EMPTY_THREAD_TURN_STATE_BY_ID;
  const { [threadId]: _removedMessageIds, ...messageIdsByThreadId } =
    state.messageIdsByThreadId ?? EMPTY_MESSAGE_IDS_BY_THREAD;
  const { [threadId]: _removedMessages, ...messageByThreadId } =
    state.messageByThreadId ?? EMPTY_MESSAGE_BY_THREAD;
  const { [threadId]: _removedActivityIds, ...activityIdsByThreadId } =
    state.activityIdsByThreadId ?? EMPTY_ACTIVITY_IDS_BY_THREAD;
  const { [threadId]: _removedActivities, ...activityByThreadId } =
    state.activityByThreadId ?? EMPTY_ACTIVITY_BY_THREAD;
  const { [threadId]: _removedPlanIds, ...proposedPlanIdsByThreadId } =
    state.proposedPlanIdsByThreadId ?? EMPTY_PROPOSED_PLAN_IDS_BY_THREAD;
  const { [threadId]: _removedPlans, ...proposedPlanByThreadId } =
    state.proposedPlanByThreadId ?? EMPTY_PROPOSED_PLAN_BY_THREAD;
  const { [threadId]: _removedDiffIds, ...turnDiffIdsByThreadId } =
    state.turnDiffIdsByThreadId ?? EMPTY_TURN_DIFF_IDS_BY_THREAD;
  const { [threadId]: _removedDiffs, ...turnDiffSummaryByThreadId } =
    state.turnDiffSummaryByThreadId ?? EMPTY_TURN_DIFF_BY_THREAD;
  const { [threadId]: _removedSummary, ...sidebarThreadSummaryById } =
    state.sidebarThreadSummaryById;
  const nextThreadIds = (state.threadIds ?? EMPTY_THREAD_IDS).filter((id) => id !== threadId);

  if (
    nextThreadIds === state.threadIds &&
    sidebarThreadSummaryById === state.sidebarThreadSummaryById
  ) {
    return clearThreadDetailSyncState(state, threadId);
  }

  return clearThreadDetailSyncState(
    {
      ...state,
      threadIds: nextThreadIds,
      threadShellById,
      threadSessionById,
      threadTurnStateById,
      messageIdsByThreadId,
      messageByThreadId,
      activityIdsByThreadId,
      activityByThreadId,
      proposedPlanIdsByThreadId,
      proposedPlanByThreadId,
      turnDiffIdsByThreadId,
      turnDiffSummaryByThreadId,
      sidebarThreadSummaryById,
    },
    threadId,
  );
}

export function evictThreadDetailFromClientState(state: AppState, threadId: ThreadId): AppState {
  const detailRecords = [
    state.messageIdsByThreadId,
    state.messageByThreadId,
    state.activityIdsByThreadId,
    state.activityByThreadId,
    state.proposedPlanIdsByThreadId,
    state.proposedPlanByThreadId,
    state.turnDiffIdsByThreadId,
    state.turnDiffSummaryByThreadId,
  ];
  const hasNormalizedDetail = detailRecords.some(
    (record) => record !== undefined && Object.hasOwn(record, threadId),
  );
  if (!hasNormalizedDetail) {
    // A sync flag without normalized detail is stale; clear it so hydration restarts cleanly.
    return clearThreadDetailSyncState(state, threadId);
  }

  const { [threadId]: _removedMessageIds, ...messageIdsByThreadId } =
    state.messageIdsByThreadId ?? EMPTY_MESSAGE_IDS_BY_THREAD;
  const { [threadId]: _removedMessages, ...messageByThreadId } =
    state.messageByThreadId ?? EMPTY_MESSAGE_BY_THREAD;
  const { [threadId]: _removedActivityIds, ...activityIdsByThreadId } =
    state.activityIdsByThreadId ?? EMPTY_ACTIVITY_IDS_BY_THREAD;
  const { [threadId]: _removedActivities, ...activityByThreadId } =
    state.activityByThreadId ?? EMPTY_ACTIVITY_BY_THREAD;
  const { [threadId]: _removedPlanIds, ...proposedPlanIdsByThreadId } =
    state.proposedPlanIdsByThreadId ?? EMPTY_PROPOSED_PLAN_IDS_BY_THREAD;
  const { [threadId]: _removedPlans, ...proposedPlanByThreadId } =
    state.proposedPlanByThreadId ?? EMPTY_PROPOSED_PLAN_BY_THREAD;
  const { [threadId]: _removedDiffIds, ...turnDiffIdsByThreadId } =
    state.turnDiffIdsByThreadId ?? EMPTY_TURN_DIFF_IDS_BY_THREAD;
  const { [threadId]: _removedDiffs, ...turnDiffSummaryByThreadId } =
    state.turnDiffSummaryByThreadId ?? EMPTY_TURN_DIFF_BY_THREAD;

  return clearThreadDetailSyncState(
    {
      ...state,
      messageIdsByThreadId,
      messageByThreadId,
      activityIdsByThreadId,
      activityByThreadId,
      proposedPlanIdsByThreadId,
      proposedPlanByThreadId,
      turnDiffIdsByThreadId,
      turnDiffSummaryByThreadId,
    },
    threadId,
  );
}
