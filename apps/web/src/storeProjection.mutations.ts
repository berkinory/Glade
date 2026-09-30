import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { deriveThreadSummaryMetadata } from "@glade/shared/threads/threadSummary";
import { getThreadFromState } from "./threadDerivation";
import { forgetProjectState } from "./storePersistence";
import { EMPTY_THREAD_SHELL_BY_ID, type AppState } from "./storeState";
import type { Project, Thread } from "./types";
import { removeThreadState, writeThreadState } from "./storeProjection.threadState";
import { buildSidebarThreadSummary } from "./storeProjection.records";

// When the deletion arrives as a domain event we know it exactly; for optimistic client-side
// deletes we only have a lower bound — the delete cannot have been recorded before the newest
// snapshot we have already integrated, so `shellSnapshotSequence + 1` is safe. Re-deleting keeps
// the highest known sequence, because retiring later is always the safe direction.
function nextTombstoneSequence<TId extends string>(
  tombstones: Record<TId, number> | undefined,
  id: TId,
  state: AppState,
  deletedAtSequence: number | undefined,
): number {
  const candidate = deletedAtSequence ?? (state.shellSnapshotSequence ?? 0) + 1;
  const existing = tombstones?.[id];
  return existing === undefined ? candidate : Math.max(existing, candidate);
}

// Snapshots older than that can still carry the deleted row, so they must never retire it; that is
// what keeps the resurrection guard intact.
function retireDeletionTombstones<TId extends string>(
  tombstones: Record<TId, number> | undefined,
  snapshotSequence: number,
  presentIds: ReadonlySet<string>,
): Record<TId, number> | undefined {
  if (tombstones === undefined) {
    return tombstones;
  }
  let retiredAny = false;
  const retained = {} as Record<TId, number>;
  for (const [id, deletedAtSequence] of Object.entries(tombstones) as [TId, number][]) {
    if (snapshotSequence >= deletedAtSequence && !presentIds.has(id)) {
      retiredAny = true;
      continue;
    }
    retained[id] = deletedAtSequence;
  }
  return retiredAny ? retained : tombstones;
}

export // The tombstone map cannot tell "never deleted" from "deleted and already confirmed gone", so the
// whole stale payload has to be rejected before it is merged.
function isStaleSnapshot(state: AppState, snapshotSequence: number): boolean {
  return snapshotSequence < (state.shellSnapshotSequence ?? 0);
}

export function retireConfirmedDeletionTombstones(
  state: AppState,
  snapshotSequence: number,
  presentThreadIds: ReadonlySet<string>,
  presentProjectIds: ReadonlySet<string>,
): AppState {
  if (snapshotSequence < (state.shellSnapshotSequence ?? 0)) {
    return state;
  }
  const deletedThreadIdsById = retireDeletionTombstones(
    state.deletedThreadIdsById,
    snapshotSequence,
    presentThreadIds,
  );
  const deletedProjectIdsById = retireDeletionTombstones(
    state.deletedProjectIdsById,
    snapshotSequence,
    presentProjectIds,
  );
  if (
    deletedThreadIdsById === state.deletedThreadIdsById &&
    deletedProjectIdsById === state.deletedProjectIdsById
  ) {
    return state;
  }
  return {
    ...state,
    ...(deletedThreadIdsById !== undefined ? { deletedThreadIdsById } : {}),
    ...(deletedProjectIdsById !== undefined ? { deletedProjectIdsById } : {}),
  };
}

export function removeDeletedThreadFromClientState(
  state: AppState,
  threadId: ThreadId,
  deletedAtSequence?: number,
): AppState {
  const sequence = nextTombstoneSequence(
    state.deletedThreadIdsById,
    threadId,
    state,
    deletedAtSequence,
  );
  const deletedThreadIdsById =
    state.deletedThreadIdsById?.[threadId] === sequence
      ? state.deletedThreadIdsById
      : {
          ...state.deletedThreadIdsById,
          [threadId]: sequence,
        };
  const nextState = removeThreadState(state, threadId);
  return nextState.deletedThreadIdsById === deletedThreadIdsById
    ? nextState
    : {
        ...nextState,
        deletedThreadIdsById,
      };
}

function removeProjectState(state: AppState, projectId: Project["id"]): AppState {
  const threadIds = new Set<ThreadId>();
  for (const shell of Object.values(state.threadShellById ?? EMPTY_THREAD_SHELL_BY_ID)) {
    if (shell.projectId === projectId) {
      threadIds.add(shell.id);
    }
  }

  const removedProject = state.projects.find((project) => project.id === projectId);
  if (removedProject) {
    forgetProjectState(removedProject.cwd);
  }

  const nextProjects = state.projects.some((project) => project.id === projectId)
    ? state.projects.filter((project) => project.id !== projectId)
    : state.projects;
  const nextState = [...threadIds].reduce((currentState, threadId) => {
    return removeThreadState(currentState, threadId);
  }, state);

  if (nextProjects === state.projects && nextState === state) {
    return state;
  }

  return nextProjects === nextState.projects
    ? nextState
    : {
        ...nextState,
        projects: nextProjects,
      };
}

export function removeDeletedProjectFromClientState(
  state: AppState,
  projectId: Project["id"],
  deletedAtSequence?: number,
): AppState {
  const sequence = nextTombstoneSequence(
    state.deletedProjectIdsById,
    projectId,
    state,
    deletedAtSequence,
  );
  const deletedProjectIdsById =
    state.deletedProjectIdsById?.[projectId] === sequence
      ? state.deletedProjectIdsById
      : {
          ...state.deletedProjectIdsById,
          [projectId]: sequence,
        };
  const nextState = removeProjectState(state, projectId);
  return nextState.deletedProjectIdsById === deletedProjectIdsById
    ? nextState
    : {
        ...nextState,
        deletedProjectIdsById,
      };
}

export function commitThreadProjection(
  state: AppState,
  threadId: ThreadId,
  options?: {
    updateSidebarSummary?: boolean;
  },
): AppState {
  const shouldUpdateSidebarSummary = options?.updateSidebarSummary ?? true;
  const previousSummary = state.sidebarThreadSummaryById[threadId];

  if (!shouldUpdateSidebarSummary && previousSummary !== undefined) {
    return state;
  }

  const nextThread = getThreadFromState(state, threadId);
  if (!nextThread) {
    return state;
  }

  const nextSummary = buildSidebarThreadSummary(nextThread, previousSummary);

  if (nextSummary === previousSummary) {
    return state;
  }

  return {
    ...state,
    sidebarThreadSummaryById:
      nextSummary === previousSummary || nextSummary === undefined
        ? state.sidebarThreadSummaryById
        : {
            ...state.sidebarThreadSummaryById,
            [threadId]: nextSummary,
          },
  };
}

function deriveThreadStateSignals(
  thread: Thread,
): Pick<
  Thread,
  | "latestUserMessageAt"
  | "latestHumanMessageAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
> {
  const metadata = deriveThreadSummaryMetadata({
    messages: thread.messages,
    activities: thread.activities,
    proposedPlans: thread.proposedPlans,
    latestTurn: thread.latestTurn,
  });
  const actionableInteractions = thread.pendingInteractions?.filter(
    (interaction) => interaction.status === "pending" || interaction.status === "retryable",
  );
  return {
    latestUserMessageAt: metadata.latestUserMessageAt,
    latestHumanMessageAt:
      thread.latestHumanMessageAt !== undefined
        ? thread.latestHumanMessageAt
        : metadata.latestHumanMessageAt,
    hasPendingApprovals:
      actionableInteractions?.some((interaction) => interaction.interactionKind === "approval") ??
      metadata.hasPendingApprovals,
    hasPendingUserInput:
      actionableInteractions?.some((interaction) => interaction.interactionKind === "userInput") ??
      metadata.hasPendingUserInput,
    hasActionableProposedPlan: metadata.hasActionableProposedPlan,
  };
}

function withDerivedThreadStateSignals(thread: Thread): Thread {
  const nextSignals = deriveThreadStateSignals(thread);
  if (
    thread.latestUserMessageAt === nextSignals.latestUserMessageAt &&
    thread.latestHumanMessageAt === nextSignals.latestHumanMessageAt &&
    thread.hasPendingApprovals === nextSignals.hasPendingApprovals &&
    thread.hasPendingUserInput === nextSignals.hasPendingUserInput &&
    thread.hasActionableProposedPlan === nextSignals.hasActionableProposedPlan
  ) {
    return thread;
  }
  return {
    ...thread,
    ...nextSignals,
  };
}

export function applyThreadUpdate(
  state: AppState,
  threadId: ThreadId,
  updater: (thread: Thread) => Thread,
  options?: {
    recomputeSummarySignals?: boolean;
    updateSidebarSummary?: boolean;
  },
): AppState {
  const currentThread = getThreadFromState(state, threadId);
  if (!currentThread) {
    return state;
  }
  const updatedThread =
    options?.recomputeSummarySignals === false
      ? updater(currentThread)
      : withDerivedThreadStateSignals(updater(currentThread));
  if (updatedThread === currentThread) {
    return state;
  }
  return commitThreadProjection(writeThreadState(state, updatedThread, currentThread), threadId, {
    updateSidebarSummary: options?.updateSidebarSummary ?? true,
  });
}
