import type {
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
} from "@glade/contracts/orchestration/snapshots";
import {
  resetThreadDetailResumeCursors,
  retainThreadDetailResumeCursors,
} from "./threadDetailResumeCursors";
import { getThreadFromState, getThreadsFromState } from "./threadDerivation";
import {
  mapProjects,
  normalizeThreadFromReadModel,
  normalizeThreadShellSnapshot,
} from "./storeNormalization.threads";
import {
  mapSpaces,
  mergeReadModelThreadDetailWithLiveHotPath,
} from "./storeNormalization.messages";
import { recordsShallowEqual } from "./storeNormalization.shared";
import {
  projectCwdKey,
  rememberProjectState,
  resetStaleRememberedProjectState,
} from "./storePersistence";
import type { AppState } from "./storeState";
import type { SidebarThreadSummary } from "./types";
import {
  commitThreadProjection,
  isStaleSnapshot,
  removeDeletedProjectFromClientState,
  retireConfirmedDeletionTombstones,
} from "./storeProjection.mutations";
import {
  applySpaceOrder,
  buildSidebarThreadSummary,
  removeSpace,
  reuseThreadIdRegistry,
  upsertProject,
  upsertSpace,
} from "./storeProjection.records";
import type { ReadModelThread } from "./storeProjection.records";
import {
  rebuildThreadShellRecords,
  removeThreadState,
  retainThreadScopedRecord,
  writeThreadDetailSyncState,
  writeThreadShellProjection,
  writeThreadState,
} from "./storeProjection.threadState";

export function syncServerShellSnapshot(
  state: AppState,
  snapshot: OrchestrationShellSnapshot,
): AppState {
  if (isStaleSnapshot(state, snapshot.snapshotSequence)) {
    return state;
  }
  rememberProjectState(state.projects);
  const deletedProjectIdsById = state.deletedProjectIdsById ?? {};
  const deletedThreadIdsById = state.deletedThreadIdsById ?? {};
  const snapshotThreads = snapshot.threads.filter(
    (thread) =>
      deletedProjectIdsById[thread.projectId] === undefined &&
      deletedThreadIdsById[thread.id] === undefined,
  );
  const snapshotProjects = snapshot.projects.filter(
    (project) => deletedProjectIdsById[project.id] === undefined,
  );

  resetStaleRememberedProjectState(
    new Set(snapshotProjects.map((project) => projectCwdKey(project.workspaceRoot))),
  );
  const spaces = mapSpaces(snapshot.spaces ?? [], state.spaces ?? []);
  const projects = mapProjects(snapshotProjects, state.projects);
  rememberProjectState(projects);
  const nextThreadIds = new Set(snapshotThreads.map((thread) => thread.id));

  retainThreadDetailResumeCursors(nextThreadIds);

  const normalizedState: AppState = {
    ...state,
    threadIds: reuseThreadIdRegistry(state.threadIds, nextThreadIds),
    ...rebuildThreadShellRecords(state, snapshotThreads, snapshot.snapshotSequence),
    messageIdsByThreadId: retainThreadScopedRecord(state.messageIdsByThreadId, nextThreadIds),
    messageByThreadId: retainThreadScopedRecord(state.messageByThreadId, nextThreadIds),
    activityIdsByThreadId: retainThreadScopedRecord(state.activityIdsByThreadId, nextThreadIds),
    activityByThreadId: retainThreadScopedRecord(state.activityByThreadId, nextThreadIds),
    proposedPlanIdsByThreadId: retainThreadScopedRecord(
      state.proposedPlanIdsByThreadId,
      nextThreadIds,
    ),
    proposedPlanByThreadId: retainThreadScopedRecord(state.proposedPlanByThreadId, nextThreadIds),
    turnDiffIdsByThreadId: retainThreadScopedRecord(state.turnDiffIdsByThreadId, nextThreadIds),
    turnDiffSummaryByThreadId: retainThreadScopedRecord(
      state.turnDiffSummaryByThreadId,
      nextThreadIds,
    ),
    threadDetailSyncById: retainThreadScopedRecord(state.threadDetailSyncById, nextThreadIds),
  };

  const threads = getThreadsFromState(normalizedState);
  const nextSidebarThreadSummaryById = Object.fromEntries(
    threads.map((thread) => [
      thread.id,
      buildSidebarThreadSummary(thread, state.sidebarThreadSummaryById[thread.id]),
    ]),
  ) as Record<string, SidebarThreadSummary>;
  const sidebarThreadSummaryById = recordsShallowEqual(
    state.sidebarThreadSummaryById,
    nextSidebarThreadSummaryById,
  )
    ? state.sidebarThreadSummaryById
    : nextSidebarThreadSummaryById;

  return retireConfirmedDeletionTombstones(
    {
      ...normalizedState,
      shellSnapshotSequence: Math.max(state.shellSnapshotSequence ?? 0, snapshot.snapshotSequence),
      spaces,
      projects,
      sidebarThreadSummaryById,
      threadsHydrated: true,
    },
    snapshot.snapshotSequence,
    new Set(snapshot.threads.map((thread) => thread.id)),
    new Set(snapshot.projects.map((project) => project.id)),
  );
}

function syncServerThreadDetailWithOptions(
  state: AppState,
  thread: ReadModelThread,
  options?: {
    updateSidebarSummary?: boolean;
    snapshotSequence?: number;
  },
): AppState {
  const previousThread = getThreadFromState(state, thread.id);
  const nextThreadDetail = options
    ? mergeReadModelThreadDetailWithLiveHotPath(thread, previousThread, options.snapshotSequence)
    : thread;
  return writeThreadDetailSyncState(
    commitThreadProjection(
      writeThreadState(
        state,
        normalizeThreadFromReadModel(nextThreadDetail, previousThread, options?.snapshotSequence),
        previousThread,
      ),
      thread.id,
      {
        updateSidebarSummary: false,
      },
    ),
    thread.id,
    "synced",
  );
}

export function syncServerThreadDetail(state: AppState, thread: ReadModelThread): AppState {
  if (
    state.deletedProjectIdsById?.[thread.projectId] !== undefined ||
    state.deletedThreadIdsById?.[thread.id] !== undefined
  ) {
    return removeThreadState(state, thread.id);
  }
  return syncServerThreadDetailWithOptions(state, thread);
}

export function syncServerThreadDetailHotPath(
  state: AppState,
  thread: ReadModelThread,
  snapshotSequence?: number,
): AppState {
  if (
    state.deletedProjectIdsById?.[thread.projectId] !== undefined ||
    state.deletedThreadIdsById?.[thread.id] !== undefined
  ) {
    return removeThreadState(state, thread.id);
  }
  return syncServerThreadDetailWithOptions(state, thread, {
    updateSidebarSummary: false,
    ...(snapshotSequence !== undefined ? { snapshotSequence } : {}),
  });
}

export function applyShellEvent(state: AppState, event: OrchestrationShellStreamEvent): AppState {
  switch (event.kind) {
    case "space-upserted":
      return upsertSpace(state, event.space);
    case "space-removed":
      return removeSpace(state, event.spaceId, event.updatedAt);
    case "space-order-updated":
      return applySpaceOrder(state, event.orderedSpaceIds);
    case "project-upserted":
      return upsertProject(state, event.project, "id-or-cwd");
    case "project-removed":
      return removeDeletedProjectFromClientState(state, event.projectId, event.sequence);
    case "thread-upserted": {
      if (
        state.deletedProjectIdsById?.[event.thread.projectId] !== undefined ||
        state.deletedThreadIdsById?.[event.thread.id] !== undefined
      ) {
        return removeThreadState(state, event.thread.id);
      }
      const nextState = writeThreadShellProjection(
        state,
        normalizeThreadShellSnapshot(
          event.thread,
          getThreadFromState(state, event.thread.id),
          event.sequence,
        ),
      );
      return commitThreadProjection(nextState, event.thread.id);
    }
    case "thread-removed":
      return removeThreadState(state, event.threadId);
  }
}

export function syncServerReadModel(state: AppState, readModel: OrchestrationReadModel): AppState {
  if (isStaleSnapshot(state, readModel.snapshotSequence)) {
    return state;
  }
  rememberProjectState(state.projects);
  const deletedProjectIdsById = state.deletedProjectIdsById ?? {};
  const deletedThreadIdsById = state.deletedThreadIdsById ?? {};

  const livePresentThreadIds = new Set<string>(
    readModel.threads.filter((thread) => thread.deletedAt === null).map((thread) => thread.id),
  );
  const livePresentProjectIds = new Set<string>(
    readModel.projects.filter((project) => project.deletedAt === null).map((project) => project.id),
  );
  const spaces = mapSpaces(
    (readModel.spaces ?? []).filter((space) => space.deletedAt === null),
    state.spaces ?? [],
  );
  const liveProjects = readModel.projects.filter(
    (project) => project.deletedAt === null && deletedProjectIdsById[project.id] === undefined,
  );

  resetStaleRememberedProjectState(
    new Set(liveProjects.map((project) => projectCwdKey(project.workspaceRoot))),
  );
  const projects = mapProjects(liveProjects, state.projects);
  rememberProjectState(projects);
  const nextThreads = readModel.threads
    .filter(
      (thread) =>
        thread.deletedAt === null &&
        deletedProjectIdsById[thread.projectId] === undefined &&
        deletedThreadIdsById[thread.id] === undefined,
    )
    .map((thread) => {
      const existing = getThreadFromState(state, thread.id);
      return normalizeThreadFromReadModel(
        thread,
        existing,
        thread.claudeCacheReview != null || existing?.claudeCacheReviewSequence !== undefined
          ? readModel.snapshotSequence
          : undefined,
      );
    });
  const nextThreadIds = new Set(nextThreads.map((thread) => thread.id));

  resetThreadDetailResumeCursors();
  let normalizedState: AppState = {
    ...state,
    threadIds: reuseThreadIdRegistry(state.threadIds, nextThreadIds),
    threadShellById: retainThreadScopedRecord(state.threadShellById, nextThreadIds),
    threadSessionById: retainThreadScopedRecord(state.threadSessionById, nextThreadIds),
    threadTurnStateById: retainThreadScopedRecord(state.threadTurnStateById, nextThreadIds),
    messageIdsByThreadId: retainThreadScopedRecord(state.messageIdsByThreadId, nextThreadIds),
    messageByThreadId: retainThreadScopedRecord(state.messageByThreadId, nextThreadIds),
    activityIdsByThreadId: retainThreadScopedRecord(state.activityIdsByThreadId, nextThreadIds),
    activityByThreadId: retainThreadScopedRecord(state.activityByThreadId, nextThreadIds),
    proposedPlanIdsByThreadId: retainThreadScopedRecord(
      state.proposedPlanIdsByThreadId,
      nextThreadIds,
    ),
    proposedPlanByThreadId: retainThreadScopedRecord(state.proposedPlanByThreadId, nextThreadIds),
    turnDiffIdsByThreadId: retainThreadScopedRecord(state.turnDiffIdsByThreadId, nextThreadIds),
    turnDiffSummaryByThreadId: retainThreadScopedRecord(
      state.turnDiffSummaryByThreadId,
      nextThreadIds,
    ),
    threadDetailSyncById: retainThreadScopedRecord(state.threadDetailSyncById, nextThreadIds),
  };
  for (const thread of nextThreads) {
    normalizedState = writeThreadDetailSyncState(
      writeThreadState(normalizedState, thread, getThreadFromState(state, thread.id)),
      thread.id,
      "synced",
    );
  }
  const threads = getThreadsFromState(normalizedState);
  const nextSidebarThreadSummaryById = Object.fromEntries(
    threads.map((thread) => [
      thread.id,
      buildSidebarThreadSummary(thread, state.sidebarThreadSummaryById[thread.id]),
    ]),
  ) as Record<string, SidebarThreadSummary>;
  const sidebarThreadSummaryById = recordsShallowEqual(
    state.sidebarThreadSummaryById,
    nextSidebarThreadSummaryById,
  )
    ? state.sidebarThreadSummaryById
    : nextSidebarThreadSummaryById;
  if (
    spaces === state.spaces &&
    projects === state.projects &&
    sidebarThreadSummaryById === state.sidebarThreadSummaryById &&
    normalizedState.threadIds === state.threadIds &&
    normalizedState.threadShellById === state.threadShellById &&
    normalizedState.threadSessionById === state.threadSessionById &&
    normalizedState.threadTurnStateById === state.threadTurnStateById &&
    normalizedState.messageIdsByThreadId === state.messageIdsByThreadId &&
    normalizedState.messageByThreadId === state.messageByThreadId &&
    normalizedState.activityIdsByThreadId === state.activityIdsByThreadId &&
    normalizedState.activityByThreadId === state.activityByThreadId &&
    normalizedState.proposedPlanIdsByThreadId === state.proposedPlanIdsByThreadId &&
    normalizedState.proposedPlanByThreadId === state.proposedPlanByThreadId &&
    normalizedState.turnDiffIdsByThreadId === state.turnDiffIdsByThreadId &&
    normalizedState.turnDiffSummaryByThreadId === state.turnDiffSummaryByThreadId &&
    normalizedState.threadDetailSyncById === state.threadDetailSyncById &&
    state.threadsHydrated
  ) {
    // Recording it keeps `shellSnapshotSequence` honest, which is what later optimistic deletes derive
    // their tombstone lower bound from — otherwise a tombstone created after this point could be
    // retired by a snapshot that predates the deletion.
    const advanced =
      readModel.snapshotSequence > (state.shellSnapshotSequence ?? 0)
        ? { ...state, shellSnapshotSequence: readModel.snapshotSequence }
        : state;
    return retireConfirmedDeletionTombstones(
      advanced,
      readModel.snapshotSequence,
      livePresentThreadIds,
      livePresentProjectIds,
    );
  }
  return retireConfirmedDeletionTombstones(
    {
      ...normalizedState,
      shellSnapshotSequence: Math.max(state.shellSnapshotSequence ?? 0, readModel.snapshotSequence),
      spaces,
      projects,
      sidebarThreadSummaryById,
      threadsHydrated: true,
    },
    readModel.snapshotSequence,
    livePresentThreadIds,
    livePresentProjectIds,
  );
}
