import { MAX_PINNED_PROJECTS } from "@glade/contracts/orchestration/threadEntities";
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "../appSettings";
import type { Project, SidebarThreadSummary, Thread } from "../types";
import {
  derivePinnedIds,
  getPinnedItems,
  isLatestPinMutation,
  orderPinnedItemsFirst,
} from "../pinning.logic";
import { SIDEBAR_THREAD_PREWARM_LIMIT, hasUnseenCompletion } from "./Sidebar.logic.statusTypes";
import type { SidebarThreadSortInput } from "./Sidebar.logic.statusTypes";

export function getVisibleSidebarEntriesForPreview<
  T extends {
    rowId: Thread["id"];
    rootRowId: Thread["id"];
  },
>(input: {
  entries: readonly T[];
  activeEntryId: Thread["id"] | undefined;
  previewLimit: number;
}): {
  hasHiddenEntries: boolean;
  visibleEntries: T[];
} {
  const { activeEntryId, entries, previewLimit } = input;
  const hasHiddenEntries = entries.length > previewLimit;

  if (!hasHiddenEntries) {
    return {
      hasHiddenEntries,
      visibleEntries: [...entries],
    };
  }

  const previewEntries = entries.slice(0, previewLimit);
  const visibleEntryIds = new Set(previewEntries.map((entry) => entry.rowId));

  if (!activeEntryId || visibleEntryIds.has(activeEntryId)) {
    return {
      hasHiddenEntries: true,
      visibleEntries: previewEntries,
    };
  }

  const activeEntryIndex = entries.findIndex((entry) => entry.rowId === activeEntryId);
  if (activeEntryIndex === -1) {
    return {
      hasHiddenEntries: true,
      visibleEntries: previewEntries,
    };
  }

  const activeEntry = entries[activeEntryIndex];
  if (!activeEntry) {
    return {
      hasHiddenEntries: true,
      visibleEntries: previewEntries,
    };
  }

  const rootEntryIndex = entries.findIndex((entry) => entry.rowId === activeEntry.rootRowId);
  const forcedVisibleEntries =
    rootEntryIndex === -1 ? [activeEntry] : entries.slice(rootEntryIndex, activeEntryIndex + 1);

  for (const entry of forcedVisibleEntries) {
    visibleEntryIds.add(entry.rowId);
  }

  return {
    hasHiddenEntries: true,
    visibleEntries: entries.filter((entry) => visibleEntryIds.has(entry.rowId)),
  };
}

export function getPinnedThreadsForSidebar<T extends Pick<Thread, "id">>(
  threads: readonly T[],
  pinnedThreadIds: readonly T["id"][],
): T[] {
  return getPinnedItems(threads, pinnedThreadIds);
}

export function derivePinnedThreadIdsForSidebar<T extends Pick<Thread, "id" | "isPinned">>(input: {
  readonly threads: readonly T[];
  readonly persistedPinnedThreadIds: readonly T["id"][];
  readonly optimisticPinnedStateByThreadId: ReadonlyMap<T["id"], boolean>;
}): T["id"][] {
  return derivePinnedIds({
    items: input.threads,
    persistedPinnedIds: input.persistedPinnedThreadIds,
    optimisticPinnedStateById: input.optimisticPinnedStateByThreadId,
  });
}

export function isLatestPinnedThreadMutation<T>(input: {
  readonly threadId: T;
  readonly requestVersion: number;
  readonly latestMutationVersionByThreadId: ReadonlyMap<T, number>;
}): boolean {
  return isLatestPinMutation({
    id: input.threadId,
    requestVersion: input.requestVersion,
    latestMutationVersionById: input.latestMutationVersionByThreadId,
  });
}

export function isLatestPinnedProjectMutation<T>(input: {
  readonly projectId: T;
  readonly requestVersion: number;
  readonly latestMutationVersionByProjectId: ReadonlyMap<T, number>;
}): boolean {
  return isLatestPinMutation({
    id: input.projectId,
    requestVersion: input.requestVersion,
    latestMutationVersionById: input.latestMutationVersionByProjectId,
  });
}

export function derivePinnedProjectIdsForSidebar<
  T extends Pick<Project, "id" | "isPinned">,
>(input: {
  readonly projects: readonly T[];
  readonly persistedPinnedProjectIds: readonly T["id"][];
  readonly optimisticPinnedStateByProjectId: ReadonlyMap<T["id"], boolean>;
}): T["id"][] {
  return derivePinnedIds({
    items: input.projects,
    persistedPinnedIds: input.persistedPinnedProjectIds,
    optimisticPinnedStateById: input.optimisticPinnedStateByProjectId,
    maxCount: MAX_PINNED_PROJECTS,
  });
}

export function orderPinnedProjectsForSidebar<T extends Pick<Project, "id">>(
  projects: readonly T[],
  pinnedProjectIds: readonly T["id"][],
): T[] {
  return orderPinnedItemsFirst(projects, pinnedProjectIds);
}

export // Hide globally pinned rows from the per-project lists so the sidebar doesn't duplicate chats.
function getUnpinnedThreadsForSidebar<
  T extends Pick<Thread, "id"> & Partial<Pick<SidebarThreadSummary, "parentThreadId">>,
>(threads: readonly T[], pinnedThreadIds: readonly T["id"][]): T[] {
  if (pinnedThreadIds.length === 0) {
    return [...threads];
  }

  const parentThreadIds = new Set<T["id"]>();
  for (const thread of threads) {
    const parentThreadId = thread.parentThreadId ?? null;
    if (parentThreadId !== null) {
      parentThreadIds.add(parentThreadId as T["id"]);
    }
  }

  const hiddenThreadIds = new Set(
    pinnedThreadIds.filter((threadId) => !parentThreadIds.has(threadId)),
  );
  return threads.filter((thread) => !hiddenThreadIds.has(thread.id));
}

export function shouldPrunePinnedThreads(input: { threadsHydrated: boolean }): boolean {
  return input.threadsHydrated;
}

export type ProjectEmptyState = "loading" | "empty" | null;

export function resolveProjectEmptyState(input: {
  readonly projectCount: number;
  readonly threadsHydrated: boolean;
}): ProjectEmptyState {
  if (input.projectCount > 0) {
    return null;
  }

  return input.threadsHydrated ? "empty" : "loading";
}

export function getNextVisibleSidebarThreadId(input: {
  visibleThreadIds: readonly Thread["id"][];
  activeThreadId: Thread["id"] | undefined;
  direction: "forward" | "backward";
}): Thread["id"] | null {
  const { activeThreadId, direction, visibleThreadIds } = input;
  if (visibleThreadIds.length === 0) {
    return null;
  }

  if (!activeThreadId) {
    return direction === "forward"
      ? (visibleThreadIds[0] ?? null)
      : (visibleThreadIds.at(-1) ?? null);
  }

  const activeIndex = visibleThreadIds.findIndex((threadId) => threadId === activeThreadId);
  if (activeIndex === -1) {
    return direction === "forward"
      ? (visibleThreadIds[0] ?? null)
      : (visibleThreadIds.at(-1) ?? null);
  }

  const nextIndex =
    direction === "forward"
      ? (activeIndex + 1) % visibleThreadIds.length
      : (activeIndex - 1 + visibleThreadIds.length) % visibleThreadIds.length;

  return visibleThreadIds[nextIndex] ?? null;
}

export function getSidebarThreadIdsToPrewarm(input: {
  visibleThreadIds: readonly Thread["id"][];
  activeThreadId?: Thread["id"] | null;
  limit?: number;
  neighborRadius?: number;
}): Thread["id"][] {
  const limit = Math.max(0, input.limit ?? SIDEBAR_THREAD_PREWARM_LIMIT);
  if (limit === 0) {
    return [];
  }
  const prewarmedThreadIds = new Set<Thread["id"]>();
  const neighborRadius = Math.max(0, input.neighborRadius ?? 2);
  const activeIndex =
    input.activeThreadId === undefined || input.activeThreadId === null
      ? -1
      : input.visibleThreadIds.indexOf(input.activeThreadId);

  if (activeIndex >= 0) {
    const start = Math.max(0, activeIndex - neighborRadius);
    const end = Math.min(input.visibleThreadIds.length - 1, activeIndex + neighborRadius);
    for (let index = start; index <= end; index += 1) {
      if (prewarmedThreadIds.size >= limit) {
        break;
      }
      const threadId = input.visibleThreadIds[index];
      if (threadId) {
        prewarmedThreadIds.add(threadId);
      }
    }
  }

  for (const threadId of input.visibleThreadIds) {
    if (prewarmedThreadIds.size >= limit) {
      break;
    }
    prewarmedThreadIds.add(threadId);
  }

  return [...prewarmedThreadIds];
}

export function toSortableTimestamp(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function getLatestUserMessageTimestamp(thread: SidebarThreadSortInput): number {
  const latestUserMessageAt = toSortableTimestamp(thread.latestUserMessageAt ?? undefined);
  if (latestUserMessageAt !== null) {
    return latestUserMessageAt;
  }

  let latestUserMessageTimestamp: number | null = null;

  for (const message of thread.messages ?? []) {
    if (message.role !== "user") continue;
    const messageTimestamp = toSortableTimestamp(message.createdAt);
    if (messageTimestamp === null) continue;
    latestUserMessageTimestamp =
      latestUserMessageTimestamp === null
        ? messageTimestamp
        : Math.max(latestUserMessageTimestamp, messageTimestamp);
  }

  if (latestUserMessageTimestamp !== null) {
    return latestUserMessageTimestamp;
  }

  return toSortableTimestamp(thread.updatedAt ?? thread.createdAt) ?? Number.NEGATIVE_INFINITY;
}

export function getThreadSortTimestamp(
  thread: SidebarThreadSortInput,
  sortOrder: SidebarThreadSortOrder | Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (sortOrder === "created_at") {
    return toSortableTimestamp(thread.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return getLatestUserMessageTimestamp(thread);
}

export function isUnseenFinishedThread(thread: SidebarThreadSortInput): boolean {
  if (thread.hasLiveTailWork === true) {
    return false;
  }
  return hasUnseenCompletion({
    latestTurn: thread.latestTurn ?? null,
    lastVisitedAt: thread.lastVisitedAt,
  });
}
