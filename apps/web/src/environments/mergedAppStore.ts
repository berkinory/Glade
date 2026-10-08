import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { AppStore } from "../appStore";
import type { AppState } from "../storeState";
import type { Project } from "../types";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "./environmentKey";
import {
  environmentOfProject,
  environmentOfThread,
  environmentStore,
  environmentStoreEntries,
  subscribeEnvironmentStores,
} from "./environmentStores";

// Records keyed by thread or project id. Ids are UUIDs, so environments never collide and the merged
// record is a plain union.
const RECORD_FIELDS = [
  "sidebarThreadSummaryById",
  "threadShellById",
  "threadSessionById",
  "threadTurnStateById",
  "messageIdsByThreadId",
  "messageByThreadId",
  "activityIdsByThreadId",
  "activityByThreadId",
  "turnDiffIdsByThreadId",
  "turnDiffSummaryByThreadId",
  "threadDetailSyncById",
  "deletedProjectIdsById",
  "deletedThreadIdsById",
] as const satisfies ReadonlyArray<keyof AppState>;

type RecordField = (typeof RECORD_FIELDS)[number];

function sameItems(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Reuses the previous merged value while none of its sources changed, so selectors keep their
// identities and components do not re-render for updates in another environment's fields.
function createFieldMemo<T>(merge: (sources: readonly unknown[]) => T) {
  let previous: { sources: readonly unknown[]; value: T } | null = null;
  return (sources: readonly unknown[]): T => {
    if (previous && sameItems(previous.sources, sources)) return previous.value;
    const value = merge(sources);
    previous = { sources, value };
    return value;
  };
}

function createProjectTagger() {
  const tagged = new WeakMap<readonly Project[], Project[]>();
  return (key: EnvironmentKey, projects: readonly Project[]): readonly Project[] => {
    if (key === LOCAL_ENVIRONMENT) return projects;
    const cached = tagged.get(projects);
    if (cached) return cached;
    const next = projects.map((project) => ({ ...project, environmentKey: key }));
    tagged.set(projects, next);
    return next;
  };
}

// `useStore` reads this view. With only the local environment it is the local store's state itself,
// so the common case pays nothing. Actions that name a thread or project run on the store owning it;
// stream actions go to each environment's own store directly, never through this view.
export function createMergedAppStore(
  localStore: StoreApi<AppStore>,
): UseBoundStore<StoreApi<AppStore>> {
  const storeOfThread = (threadId: ThreadId) =>
    environmentStore(environmentOfThread(threadId) ?? LOCAL_ENVIRONMENT) ?? localStore;
  const storeOfProject = (projectId: ProjectId) =>
    environmentStore(environmentOfProject(projectId) ?? LOCAL_ENVIRONMENT) ?? localStore;
  const everyStore = (apply: (store: AppStore) => void) => {
    for (const [, store] of environmentStoreEntries()) apply(store.getState());
  };

  const routedActions: Partial<AppStore> = {
    evictThreadDetail: (threadId) => storeOfThread(threadId).getState().evictThreadDetail(threadId),
    evictThreadDetails: (threadIds) => everyStore((store) => store.evictThreadDetails(threadIds)),
    markThreadDetailSyncFailed: (threadId) =>
      storeOfThread(threadId).getState().markThreadDetailSyncFailed(threadId),
    clearThreadDetailSyncFailure: (threadId) =>
      storeOfThread(threadId).getState().clearThreadDetailSyncFailure(threadId),
    removeDeletedProjectFromClientState: (projectId) =>
      storeOfProject(projectId).getState().removeDeletedProjectFromClientState(projectId),
    removeDeletedThreadFromClientState: (threadId) =>
      storeOfThread(threadId).getState().removeDeletedThreadFromClientState(threadId),
    markThreadVisited: (threadId, visitedAt) =>
      storeOfThread(threadId).getState().markThreadVisited(threadId, visitedAt),
    markThreadUnread: (threadId) => storeOfThread(threadId).getState().markThreadUnread(threadId),
    toggleProject: (projectId) => storeOfProject(projectId).getState().toggleProject(projectId),
    setProjectExpanded: (projectId, expanded) =>
      storeOfProject(projectId).getState().setProjectExpanded(projectId, expanded),
    setAllProjectsExpanded: (expanded) =>
      everyStore((store) => store.setAllProjectsExpanded(expanded)),
    collapseProjectsExcept: (activeProjectId) =>
      everyStore((store) => store.collapseProjectsExcept(activeProjectId)),
    renameProjectLocally: (projectId, name) =>
      storeOfProject(projectId).getState().renameProjectLocally(projectId, name),
    setProjectAppearanceLocally: (projectId, appearance) =>
      storeOfProject(projectId).getState().setProjectAppearanceLocally(projectId, appearance),
    setError: (threadId, error) => storeOfThread(threadId).getState().setError(threadId, error),
    setThreadWorkspace: (threadId, patch) =>
      storeOfThread(threadId).getState().setThreadWorkspace(threadId, patch),
  };

  const tagProjects = createProjectTagger();
  const recordMemos = Object.fromEntries(
    RECORD_FIELDS.map((field) => [
      field,
      createFieldMemo((sources) => Object.assign({}, ...(sources as object[]))),
    ]),
  ) as Record<RecordField, (sources: readonly unknown[]) => unknown>;
  const projectsMemo = createFieldMemo((sources) => (sources as Project[][]).flat());
  const threadIdsMemo = createFieldMemo((sources) => (sources as ThreadId[][]).flat());

  function compute(): AppStore {
    const entries = environmentStoreEntries();
    const local = localStore.getState();
    if (entries.length <= 1) return local;
    const states = entries.map(([, store]) => store.getState());
    const records = Object.fromEntries(
      RECORD_FIELDS.map((field) => [
        field,
        recordMemos[field](states.map((state) => state[field] ?? {})),
      ]),
    );
    return {
      ...local,
      ...routedActions,
      ...records,
      projects: projectsMemo(
        entries.map(([key, store]) => tagProjects(key, store.getState().projects)),
      ),
      threadIds: threadIdsMemo(states.map((state) => state.threadIds ?? [])),
      allEnvironmentsHydrated: states.every((state) => state.threadsHydrated),
    };
  }

  const merged = create<AppStore>(() => compute());
  const refresh = () => merged.setState(compute(), true);
  let unsubscribeStores: Array<() => void> = [];
  const resubscribe = () => {
    for (const unsubscribe of unsubscribeStores) unsubscribe();
    unsubscribeStores = environmentStoreEntries().map(([, store]) => store.subscribe(refresh));
    refresh();
  };
  subscribeEnvironmentStores(resubscribe);
  resubscribe();
  return merged;
}
