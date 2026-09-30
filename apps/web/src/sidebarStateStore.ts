import { MAX_PINNED_PROJECTS } from "@glade/contracts/orchestration/threadEntities";
import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { create } from "zustand";
import { readPersistedStoreField, writePersistedStoreField } from "./persistedStoreFields";
import { normalizePinnedIds, pinId, prunePinnedIds, unpinId } from "./pinning.logic";
import {
  type RecentView,
  type RecentViewAvailability,
  MAX_RECENT_VIEWS,
  pruneRecentViews,
  recentViewKey,
  upsertRecentView,
} from "./recentViews.logic";

const PINNED_PROJECTS_KEY = "glade:pinned-projects:v1";
const PINNED_THREADS_KEY = "glade:pinned-threads:v1";
const RECENT_VIEWS_KEY = "glade:recent-views:v1";
const PINNED_PROJECTS_OPTIONS = { maxCount: MAX_PINNED_PROJECTS } as const;
const EMPTY_SELECTION = new Set<ThreadId>();

interface SidebarState {
  pinnedProjectIds: ProjectId[];
  pinnedThreadIds: ThreadId[];
  recentViews: RecentView[];
  selectedThreadIds: ReadonlySet<ThreadId>;
  anchorThreadId: ThreadId | null;
  pinProject: (projectId: ProjectId) => boolean;
  unpinProject: (projectId: ProjectId) => void;
  prunePinnedProjects: (projectIds: readonly ProjectId[]) => void;
  pinThread: (threadId: ThreadId) => void;
  unpinThread: (threadId: ThreadId) => void;
  togglePinnedThread: (threadId: ThreadId) => void;
  prunePinnedThreads: (threadIds: readonly ThreadId[]) => void;
  recordRecentView: (view: RecentView) => void;
  pruneRecentViews: (availability: RecentViewAvailability) => void;
  toggleThread: (threadId: ThreadId) => void;
  rangeSelectTo: (threadId: ThreadId, orderedThreadIds: readonly ThreadId[]) => void;
  clearSelection: () => void;
  removeFromSelection: (threadIds: readonly ThreadId[]) => void;
  setAnchor: (threadId: ThreadId) => void;
  hasSelection: () => boolean;
}

function readStoredField(key: string, field: string): unknown {
  return readPersistedStoreField(
    typeof localStorage === "undefined" ? null : localStorage,
    key,
    field,
  );
}

function writeStoredField(key: string, field: string, value: unknown): void {
  writePersistedStoreField(
    typeof localStorage === "undefined" ? null : localStorage,
    key,
    field,
    value,
  );
}

function readPinnedIds<TId extends string>(key: string, field: string, maxCount?: number): TId[] {
  const value = readStoredField(key, field);
  if (!Array.isArray(value)) return [];
  const ids = value.filter((item): item is TId => typeof item === "string");
  return normalizePinnedIds(ids, maxCount === undefined ? undefined : { maxCount });
}

function normalizeOptionalId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeRecentView(input: unknown): RecentView | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (record.kind === "thread") {
    const threadId = normalizeOptionalId(record.threadId);
    if (!threadId) return null;
    const splitViewId = normalizeOptionalId(record.splitViewId);
    return {
      kind: "thread",
      threadId: threadId as ThreadId,
      ...(splitViewId ? { splitViewId } : {}),
    };
  }
  if (record.kind === "settings") {
    const section = normalizeOptionalId(record.section);
    return { kind: "settings", ...(section ? { section } : {}) };
  }
  return record.kind === "plugins" ? { kind: "plugins" } : null;
}

function normalizeRecentViews(input: unknown): RecentView[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const views: RecentView[] = [];
  for (const item of input) {
    const view = normalizeRecentView(item);
    if (!view) continue;
    const key = recentViewKey(view);
    if (seen.has(key)) continue;
    seen.add(key);
    views.push(view);
  }
  return views.slice(0, MAX_RECENT_VIEWS);
}

function sameIds<T extends string>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sameViews(left: readonly RecentView[], right: readonly RecentView[]): boolean {
  return (
    left.length === right.length &&
    left.every((view, index) => {
      const other = right[index];
      return other !== undefined && recentViewKey(view) === recentViewKey(other);
    })
  );
}

export const useSidebarStateStore = create<SidebarState>((set, get) => ({
  pinnedProjectIds: readPinnedIds<ProjectId>(
    PINNED_PROJECTS_KEY,
    "pinnedProjectIds",
    MAX_PINNED_PROJECTS,
  ),
  pinnedThreadIds: readPinnedIds<ThreadId>(PINNED_THREADS_KEY, "pinnedThreadIds"),
  recentViews: normalizeRecentViews(readStoredField(RECENT_VIEWS_KEY, "recentViews")),
  selectedThreadIds: EMPTY_SELECTION,
  anchorThreadId: null,
  pinProject: (projectId) => {
    if (projectId.length === 0) return false;
    const result = pinId(get().pinnedProjectIds, projectId, PINNED_PROJECTS_OPTIONS);
    if (result.rejected) return false;
    if (result.changed) {
      set({ pinnedProjectIds: result.pinnedIds });
      writeStoredField(
        PINNED_PROJECTS_KEY,
        "pinnedProjectIds",
        normalizePinnedIds(result.pinnedIds, PINNED_PROJECTS_OPTIONS),
      );
    }
    return true;
  },
  unpinProject: (projectId) => {
    if (projectId.length === 0) return;
    const result = unpinId(get().pinnedProjectIds, projectId);
    if (!result.changed) return;
    set({ pinnedProjectIds: result.pinnedIds });
    writeStoredField(
      PINNED_PROJECTS_KEY,
      "pinnedProjectIds",
      normalizePinnedIds(result.pinnedIds, PINNED_PROJECTS_OPTIONS),
    );
  },
  prunePinnedProjects: (projectIds) => {
    const current = get().pinnedProjectIds;
    const next = prunePinnedIds(current, projectIds).slice(0, MAX_PINNED_PROJECTS);
    if (sameIds(current, next)) return;
    set({ pinnedProjectIds: next });
    writeStoredField(
      PINNED_PROJECTS_KEY,
      "pinnedProjectIds",
      normalizePinnedIds(next, PINNED_PROJECTS_OPTIONS),
    );
  },
  pinThread: (threadId) => {
    if (threadId.length === 0) return;
    const result = pinId(get().pinnedThreadIds, threadId);
    if (!result.changed) return;
    set({ pinnedThreadIds: result.pinnedIds });
    writeStoredField(PINNED_THREADS_KEY, "pinnedThreadIds", normalizePinnedIds(result.pinnedIds));
  },
  unpinThread: (threadId) => {
    if (threadId.length === 0) return;
    const result = unpinId(get().pinnedThreadIds, threadId);
    if (!result.changed) return;
    set({ pinnedThreadIds: result.pinnedIds });
    writeStoredField(PINNED_THREADS_KEY, "pinnedThreadIds", normalizePinnedIds(result.pinnedIds));
  },
  togglePinnedThread: (threadId) => {
    if (threadId.length === 0) return;
    const current = get().pinnedThreadIds;
    const next = current.includes(threadId)
      ? unpinId(current, threadId).pinnedIds
      : pinId(current, threadId).pinnedIds;
    set({ pinnedThreadIds: next });
    writeStoredField(PINNED_THREADS_KEY, "pinnedThreadIds", normalizePinnedIds(next));
  },
  prunePinnedThreads: (threadIds) => {
    const current = get().pinnedThreadIds;
    const next = prunePinnedIds(current, threadIds);
    if (next.length === current.length) return;
    set({ pinnedThreadIds: next });
    writeStoredField(PINNED_THREADS_KEY, "pinnedThreadIds", normalizePinnedIds(next));
  },
  recordRecentView: (view) => {
    const current = get().recentViews;
    const next = upsertRecentView(current, view);
    if (sameViews(current, next)) return;
    set({ recentViews: next });
    writeStoredField(RECENT_VIEWS_KEY, "recentViews", normalizeRecentViews(next));
  },
  pruneRecentViews: (availability) => {
    const current = get().recentViews;
    const next = pruneRecentViews(current, availability);
    if (sameViews(current, next)) return;
    set({ recentViews: next });
    writeStoredField(RECENT_VIEWS_KEY, "recentViews", normalizeRecentViews(next));
  },
  toggleThread: (threadId) =>
    set((state) => {
      const next = new Set(state.selectedThreadIds);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return {
        selectedThreadIds: next,
        anchorThreadId: next.has(threadId) ? threadId : state.anchorThreadId,
      };
    }),
  rangeSelectTo: (threadId, orderedThreadIds) =>
    set((state) => {
      const anchor = state.anchorThreadId;
      const next = new Set(state.selectedThreadIds);
      if (anchor === null) {
        next.add(threadId);
        return { selectedThreadIds: next, anchorThreadId: threadId };
      }
      const anchorIndex = orderedThreadIds.indexOf(anchor);
      const targetIndex = orderedThreadIds.indexOf(threadId);
      if (anchorIndex === -1 || targetIndex === -1) {
        next.add(threadId);
        return { selectedThreadIds: next, anchorThreadId: threadId };
      }
      for (
        let i = Math.min(anchorIndex, targetIndex);
        i <= Math.max(anchorIndex, targetIndex);
        i++
      ) {
        const id = orderedThreadIds[i];
        if (id !== undefined) next.add(id);
      }
      return { selectedThreadIds: next, anchorThreadId: anchor };
    }),
  clearSelection: () => {
    const state = get();
    if (state.selectedThreadIds.size === 0 && state.anchorThreadId === null) return;
    set({ selectedThreadIds: EMPTY_SELECTION, anchorThreadId: null });
  },
  removeFromSelection: (threadIds) =>
    set((state) => {
      const toRemove = new Set(threadIds);
      let changed = false;
      const next = new Set<ThreadId>();
      for (const id of state.selectedThreadIds) {
        if (toRemove.has(id)) changed = true;
        else next.add(id);
      }
      if (!changed) return state;
      const anchor =
        state.anchorThreadId !== null && toRemove.has(state.anchorThreadId)
          ? null
          : state.anchorThreadId;
      return { selectedThreadIds: next, anchorThreadId: anchor };
    }),
  setAnchor: (threadId) => {
    if (get().anchorThreadId !== threadId) set({ anchorThreadId: threadId });
  },
  hasSelection: () => get().selectedThreadIds.size > 0,
}));
