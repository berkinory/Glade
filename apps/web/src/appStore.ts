import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import {
  type OrchestrationReadModel,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamEvent,
} from "@glade/contracts/orchestration/snapshots";
import { type SpaceId, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { resolveThreadBranchRegressionGuard } from "@glade/shared/git/git";
import { createStore, type StoreApi } from "zustand";

import {
  normalizeProjectAppearance,
  projectAppearanceEquals,
  type ProjectAppearance,
} from "./lib/projectAppearance";
import { resolveCreateBranchFlowCompletedMerge } from "./storeNormalization.shared";
import { applySpaceOrder } from "./storeProjection.records";
import {
  applyShellEvent,
  syncServerReadModel,
  syncServerShellSnapshot,
  syncServerThreadDetail,
  syncServerThreadDetailHotPath,
} from "./storeProjection.synchronization";
import {
  applyThreadUpdate,
  removeDeletedProjectFromClientState,
  removeDeletedThreadFromClientState,
} from "./storeProjection.mutations";
import {
  clearThreadDetailSyncFailureInClientState,
  evictThreadDetailFromClientState,
  markThreadDetailSyncFailedInClientState,
} from "./storeProjection.threadState";
import {
  applyOrchestrationEvents,
  applyOrchestrationEventsHotPath,
} from "./storeEventReducer.batch";
import type { EnvironmentKey } from "./environments/environmentKey";
import { withNormalizingEnvironment } from "./environments/environmentEndpoints";
import type { StoreSideEffects } from "./storeSideEffects";
import type { AppState } from "./storeState";
import type { Project, ThreadWorkspacePatch } from "./types";

type ReadModelThread = OrchestrationReadModel["threads"][number];

function markThreadVisited(state: AppState, threadId: ThreadId, visitedAt?: string): AppState {
  return applyThreadUpdate(state, threadId, (thread) => {
    const at = visitedAt ?? thread.updatedAt;
    if (!at) return thread;
    const visitedAtMs = Date.parse(at);
    const previousVisitedAtMs = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) : NaN;
    if (
      Number.isFinite(previousVisitedAtMs) &&
      Number.isFinite(visitedAtMs) &&
      previousVisitedAtMs >= visitedAtMs
    ) {
      return thread;
    }
    return { ...thread, lastVisitedAt: at };
  });
}

function markThreadUnread(state: AppState, threadId: ThreadId): AppState {
  return applyThreadUpdate(state, threadId, (thread) => {
    if (!thread.latestTurn?.completedAt) return thread;
    const latestTurnCompletedAtMs = Date.parse(thread.latestTurn.completedAt);
    if (Number.isNaN(latestTurnCompletedAtMs)) return thread;
    const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
    if (thread.lastVisitedAt === unreadVisitedAt) return thread;
    return { ...thread, lastVisitedAt: unreadVisitedAt };
  });
}

function toggleProject(state: AppState, projectId: Project["id"]): AppState {
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === projectId ? { ...p, expanded: !p.expanded } : p)),
  };
}

function setProjectExpanded(
  state: AppState,
  projectId: Project["id"],
  expanded: boolean,
): AppState {
  let changed = false;
  const projects = state.projects.map((p) => {
    if (p.id !== projectId || p.expanded === expanded) return p;
    changed = true;
    return { ...p, expanded };
  });
  return changed ? { ...state, projects } : state;
}

function setAllProjectsExpanded(state: AppState, expanded: boolean): AppState {
  let changed = false;
  const projects = state.projects.map((project) => {
    if (project.expanded === expanded) return project;
    changed = true;
    return { ...project, expanded };
  });
  return changed ? { ...state, projects } : state;
}

function collapseProjectsExcept(state: AppState, activeProjectId: Project["id"] | null): AppState {
  let changed = false;
  const projects = state.projects.map((project) => {
    const nextExpanded = activeProjectId !== null && project.id === activeProjectId;
    if (project.expanded === nextExpanded) return project;
    changed = true;
    return { ...project, expanded: nextExpanded };
  });
  return changed ? { ...state, projects } : state;
}

function renameProjectLocally(
  state: AppState,
  projectId: Project["id"],
  name: string | null,
): AppState {
  const normalizedName = name?.trim() ?? null;
  let changed = false;
  const projects = state.projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }
    const nextLocalName = normalizedName && normalizedName.length > 0 ? normalizedName : null;
    const nextName = nextLocalName ?? project.remoteName;
    if (project.localName === nextLocalName && project.name === nextName) {
      return project;
    }
    changed = true;
    return {
      ...project,
      name: nextName,
      localName: nextLocalName,
    };
  });
  return changed ? { ...state, projects } : state;
}

function setProjectAppearanceLocally(
  state: AppState,
  projectId: Project["id"],
  appearance: ProjectAppearance | null,
): AppState {
  const nextAppearance = normalizeProjectAppearance(appearance);
  let changed = false;
  const projects = state.projects.map((project) => {
    if (project.id !== projectId) return project;
    if (projectAppearanceEquals(project.appearance ?? null, nextAppearance)) return project;
    changed = true;
    return { ...project, appearance: nextAppearance };
  });
  return changed ? { ...state, projects } : state;
}

function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  return applyThreadUpdate(state, threadId, (thread) => {
    if (thread.error === error) return thread;
    return { ...thread, error };
  });
}

function setThreadWorkspace(
  state: AppState,
  threadId: ThreadId,
  patch: ThreadWorkspacePatch,
): AppState {
  return applyThreadUpdate(state, threadId, (t) => {
    const nextEnvMode = patch.envMode !== undefined ? patch.envMode : t.envMode;
    const nextBranch = resolveThreadBranchRegressionGuard({
      currentBranch: t.branch,
      nextBranch: patch.branch !== undefined ? patch.branch : t.branch,
    });
    const nextWorktreePath = patch.worktreePath !== undefined ? patch.worktreePath : t.worktreePath;
    const nextWorkingDirectory =
      patch.workingDirectory !== undefined ? patch.workingDirectory : (t.workingDirectory ?? null);
    const nextAssociatedWorktreePath =
      patch.associatedWorktreePath !== undefined
        ? patch.associatedWorktreePath
        : (t.associatedWorktreePath ?? null);
    const nextAssociatedWorktreeBranch =
      patch.associatedWorktreeBranch !== undefined
        ? patch.associatedWorktreeBranch
        : (t.associatedWorktreeBranch ?? null);
    const nextAssociatedWorktreeRef =
      patch.associatedWorktreeRef !== undefined
        ? patch.associatedWorktreeRef
        : (t.associatedWorktreeRef ?? null);
    const nextCreateBranchFlowCompleted = resolveCreateBranchFlowCompletedMerge({
      currentBranch: t.branch,
      nextBranch,
      currentWorktreePath: t.worktreePath,
      nextWorktreePath,
      currentAssociatedWorktreePath: t.associatedWorktreePath,
      nextAssociatedWorktreePath,
      currentAssociatedWorktreeBranch: t.associatedWorktreeBranch,
      nextAssociatedWorktreeBranch,
      currentAssociatedWorktreeRef: t.associatedWorktreeRef,
      nextAssociatedWorktreeRef,
      currentCreateBranchFlowCompleted: t.createBranchFlowCompleted,
      nextCreateBranchFlowCompleted: patch.createBranchFlowCompleted,
    });
    if (
      t.envMode === nextEnvMode &&
      t.branch === nextBranch &&
      t.worktreePath === nextWorktreePath &&
      (t.workingDirectory ?? null) === nextWorkingDirectory &&
      (t.associatedWorktreePath ?? null) === nextAssociatedWorktreePath &&
      (t.associatedWorktreeBranch ?? null) === nextAssociatedWorktreeBranch &&
      (t.associatedWorktreeRef ?? null) === nextAssociatedWorktreeRef &&
      (t.createBranchFlowCompleted ?? false) === nextCreateBranchFlowCompleted
    ) {
      return t;
    }
    const cwdChanged =
      t.worktreePath !== nextWorktreePath || (t.workingDirectory ?? null) !== nextWorkingDirectory;
    return {
      ...t,
      envMode: nextEnvMode,
      branch: nextBranch,
      worktreePath: nextWorktreePath,
      workingDirectory: nextWorkingDirectory,
      associatedWorktreePath: nextAssociatedWorktreePath,
      associatedWorktreeBranch: nextAssociatedWorktreeBranch,
      associatedWorktreeRef: nextAssociatedWorktreeRef,
      createBranchFlowCompleted: nextCreateBranchFlowCompleted,
      ...(cwdChanged ? { session: null } : {}),
    };
  });
}

export interface AppStore extends AppState {
  syncServerShellSnapshot: (snapshot: OrchestrationShellSnapshot) => void;
  syncServerThreadDetail: (thread: ReadModelThread) => void;
  syncServerThreadDetailHotPath: (thread: ReadModelThread, snapshotSequence?: number) => void;
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  applyShellEvent: (event: OrchestrationShellStreamEvent) => void;
  applyOrchestrationEvents: (events: ReadonlyArray<OrchestrationEvent>) => void;
  applyOrchestrationEventsHotPath: (events: ReadonlyArray<OrchestrationEvent>) => void;
  evictThreadDetail: (threadId: ThreadId) => void;
  evictThreadDetails: (threadIds: readonly ThreadId[]) => void;
  markThreadDetailSyncFailed: (threadId: ThreadId) => void;
  clearThreadDetailSyncFailure: (threadId: ThreadId) => void;
  removeDeletedProjectFromClientState: (projectId: Project["id"]) => void;
  removeDeletedThreadFromClientState: (threadId: ThreadId) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId) => void;
  toggleProject: (projectId: Project["id"]) => void;
  setProjectExpanded: (projectId: Project["id"], expanded: boolean) => void;
  setAllProjectsExpanded: (expanded: boolean) => void;
  collapseProjectsExcept: (activeProjectId: Project["id"] | null) => void;
  reorderSpacesLocally: (orderedSpaceIds: ReadonlyArray<SpaceId>) => void;
  renameProjectLocally: (projectId: Project["id"], name: string | null) => void;
  setProjectAppearanceLocally: (
    projectId: Project["id"],
    appearance: ProjectAppearance | null,
  ) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadWorkspace: (threadId: ThreadId, patch: ThreadWorkspacePatch) => void;
}

// One server's projects and threads. Every environment owns one; components read them through the
// merged view in store.ts.
export function createAppStore(options: {
  readonly environmentKey: EnvironmentKey;
  readonly initialState: AppState;
  readonly effects: StoreSideEffects;
  // Local renames and appearance changes are persisted at once rather than on the debounce.
  readonly onProjectUiStateChanged: () => void;
}): StoreApi<AppStore> {
  return createStore<AppStore>((rawSet) => {
    const set = (update: (state: AppStore) => Partial<AppStore>) =>
      withNormalizingEnvironment(options.environmentKey, () => rawSet(update));
    return {
      ...options.initialState,
      syncServerShellSnapshot: (snapshot) =>
        set((state) => syncServerShellSnapshot(state, snapshot, options.effects)),
      syncServerThreadDetail: (thread) => set((state) => syncServerThreadDetail(state, thread)),
      syncServerThreadDetailHotPath: (thread, snapshotSequence) =>
        set((state) => syncServerThreadDetailHotPath(state, thread, snapshotSequence)),
      syncServerReadModel: (readModel) =>
        set((state) => syncServerReadModel(state, readModel, options.effects)),
      applyShellEvent: (event) => set((state) => applyShellEvent(state, event)),
      applyOrchestrationEvents: (events) => set((state) => applyOrchestrationEvents(state, events)),
      applyOrchestrationEventsHotPath: (events) =>
        set((state) =>
          applyOrchestrationEventsHotPath(state, events, {
            updateSidebarSummary: false,
          }),
        ),
      evictThreadDetail: (threadId) =>
        set((state) => evictThreadDetailFromClientState(state, threadId)),

      evictThreadDetails: (threadIds) =>
        set((state) => {
          let nextState: AppState = state;
          for (const threadId of threadIds) {
            nextState = evictThreadDetailFromClientState(nextState, threadId);
          }
          return nextState;
        }),
      markThreadDetailSyncFailed: (threadId) =>
        set((state) => markThreadDetailSyncFailedInClientState(state, threadId)),
      clearThreadDetailSyncFailure: (threadId) =>
        set((state) => clearThreadDetailSyncFailureInClientState(state, threadId)),
      removeDeletedProjectFromClientState: (projectId) =>
        set((state) => removeDeletedProjectFromClientState(state, projectId)),
      removeDeletedThreadFromClientState: (threadId) =>
        set((state) => removeDeletedThreadFromClientState(state, threadId)),
      markThreadVisited: (threadId, visitedAt) =>
        set((state) => markThreadVisited(state, threadId, visitedAt)),
      markThreadUnread: (threadId) => set((state) => markThreadUnread(state, threadId)),
      toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
      setProjectExpanded: (projectId, expanded) =>
        set((state) => setProjectExpanded(state, projectId, expanded)),
      setAllProjectsExpanded: (expanded) => set((state) => setAllProjectsExpanded(state, expanded)),
      collapseProjectsExcept: (activeProjectId) =>
        set((state) => collapseProjectsExcept(state, activeProjectId)),
      reorderSpacesLocally: (orderedSpaceIds) =>
        set((state) => applySpaceOrder(state, orderedSpaceIds)),
      renameProjectLocally: (projectId, name) => {
        set((state) => renameProjectLocally(state, projectId, name));
        options.onProjectUiStateChanged();
      },
      setProjectAppearanceLocally: (projectId, appearance) => {
        set((state) => setProjectAppearanceLocally(state, projectId, appearance));
        options.onProjectUiStateChanged();
      },
      setError: (threadId, error) => set((state) => setError(state, threadId, error)),
      setThreadWorkspace: (threadId, patch) =>
        set((state) => setThreadWorkspace(state, threadId, patch)),
    };
  });
}
