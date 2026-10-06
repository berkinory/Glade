import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { SidebarProjectSortOrder } from "../appSettings";
import type { Project, SidebarThreadSummary, Thread } from "../types";
import type {
  SidebarProject,
  SidebarProjectEntry,
  SidebarThreadSortInput,
} from "./Sidebar.logic.statusTypes";
import {
  buildProjectThreadTree,
  resolveProjectStatusIndicator,
  resolveSidebarThreadListPaging,
  resolveThreadStatusPill,
} from "./Sidebar.logic.status";
import type { SidebarDerivedProjectData } from "./Sidebar.logic.status";
import {
  getLatestUserMessageTimestamp,
  getUnpinnedThreadsForSidebar,
  getVisibleSidebarEntriesForPreview,
  toSortableTimestamp,
} from "./Sidebar.logic.preview";

export function sortThreadsForSidebar<T extends { id: Thread["id"] } & SidebarThreadSortInput>(
  threads: readonly T[],
): T[] {
  // Order changes only through the user's own messages; lifecycle status lives in the row's pill.
  return threads.toSorted((left, right) => {
    const rightTimestamp = getLatestUserMessageTimestamp(right);
    const leftTimestamp = getLatestUserMessageTimestamp(left);
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return right.id.localeCompare(left.id);
  });
}

export function getFallbackThreadIdAfterDelete<
  T extends { id: Thread["id"]; projectId: Thread["projectId"] } & SidebarThreadSortInput,
>(input: {
  threads: readonly T[];
  deletedThreadId: T["id"];
  deletedThreadIds?: ReadonlySet<T["id"]>;
}): T["id"] | null {
  const { deletedThreadId, deletedThreadIds, threads } = input;
  const deletedThread = threads.find((thread) => thread.id === deletedThreadId);
  if (!deletedThread) {
    return null;
  }

  return (
    sortThreadsForSidebar(
      threads.filter(
        (thread) =>
          thread.projectId === deletedThread.projectId &&
          thread.id !== deletedThreadId &&
          !deletedThreadIds?.has(thread.id),
      ),
    )[0]?.id ?? null
  );
}

function getProjectSortTimestamp(
  project: SidebarProject,
  projectThreads: readonly SidebarThreadSortInput[],
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getLatestUserMessageTimestamp(thread)),
      Number.NEGATIVE_INFINITY,
    );
  }

  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

export function sortProjectsForSidebar<
  TProject extends SidebarProject,
  TThread extends { projectId: Thread["projectId"] } & SidebarThreadSortInput,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  const threadsByProjectId = new Map<string, TThread[]>();
  for (const thread of threads) {
    const existing = threadsByProjectId.get(thread.projectId) ?? [];
    existing.push(thread);
    threadsByProjectId.set(thread.projectId, existing);
  }

  // Resolve each project's recency once; the comparator otherwise rescanned that project's threads on
  // every comparison (O(P log P × threads)).
  const timestampByProjectId = new Map(
    projects.map(
      (project) =>
        [
          project.id,
          getProjectSortTimestamp(project, threadsByProjectId.get(project.id) ?? []),
        ] as const,
    ),
  );
  return [...projects].toSorted((left, right) => {
    const rightTimestamp = timestampByProjectId.get(right.id) ?? Number.NEGATIVE_INFINITY;
    const leftTimestamp = timestampByProjectId.get(left.id) ?? Number.NEGATIVE_INFINITY;
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}

export function groupSidebarThreadsByProjectId(
  threads: readonly SidebarThreadSummary[],
): ReadonlyMap<ProjectId, SidebarThreadSummary[]> {
  const byProjectId = new Map<ProjectId, SidebarThreadSummary[]>();
  for (const thread of threads) {
    const existing = byProjectId.get(thread.projectId);
    if (existing) {
      existing.push(thread);
    } else {
      byProjectId.set(thread.projectId, [thread]);
    }
  }
  return byProjectId;
}

export function deriveSidebarProjectData(input: {
  projects: readonly Pick<Project, "id" | "cwd" | "expanded">[];
  sortedSidebarThreadsByProjectId: ReadonlyMap<ProjectId, SidebarThreadSummary[]>;
  pinnedThreadIds: readonly ThreadId[];
  threadListExtraPagesByProjectCwd: ReadonlyMap<string, number>;
  normalizeProjectCwd: (cwd: string) => string;
  activeSidebarThreadId: ThreadId | undefined;
  previewLimit: number;
  previewPageSize: number;
  resolveThreadStatus?: (
    thread: SidebarThreadSummary,
  ) => ReturnType<typeof resolveThreadStatusPill>;
}): ReadonlyMap<ProjectId, SidebarDerivedProjectData> {
  const byProjectId = new Map<ProjectId, SidebarDerivedProjectData>();

  for (const project of input.projects) {
    const allProjectThreads = input.sortedSidebarThreadsByProjectId.get(project.id) ?? [];
    const projectThreads = getUnpinnedThreadsForSidebar(allProjectThreads, input.pinnedThreadIds);
    const projectStatus = resolveProjectStatusIndicator(
      allProjectThreads.map((thread) =>
        input.resolveThreadStatus
          ? input.resolveThreadStatus(thread)
          : resolveThreadStatusPill({
              thread,
              hasPendingApprovals: thread.hasPendingApprovals,
              hasPendingUserInput: thread.hasPendingUserInput,
            }),
      ),
    );
    const requestedExtraPages =
      input.threadListExtraPagesByProjectCwd.get(input.normalizeProjectCwd(project.cwd)) ?? 0;
    const orderedProjectThreadIds = projectThreads.map((thread) => thread.id);

    if (!project.expanded) {
      const activeThread =
        input.activeSidebarThreadId === undefined
          ? null
          : (projectThreads.find((thread) => thread.id === input.activeSidebarThreadId) ?? null);
      const visibleEntries =
        activeThread === null
          ? []
          : [
              {
                kind: "thread" as const,
                rowId: activeThread.id,
                rootRowId: activeThread.id,
                thread: activeThread,
                depth: 0,
              },
            ];

      byProjectId.set(project.id, {
        allProjectThreadCount: allProjectThreads.length,
        projectThreads,
        orderedProjectThreadIds,
        visibleEntries,

        threadListExtraPages: 0,
        canShowMoreThreads: false,
        activeEntryId: activeThread?.id ?? null,
        projectStatus,
      });
      continue;
    }

    const projectThreadTree = buildProjectThreadTree({
      threads: projectThreads,
      forceVisibleThreadId: input.activeSidebarThreadId,
    });
    const orderedEntries: SidebarProjectEntry[] = projectThreadTree.map(
      ({ thread, depth, rootThreadId }) => ({
        kind: "thread",
        rowId: thread.id,
        rootRowId: rootThreadId,
        thread,
        depth,
      }),
    );

    const activeEntry =
      input.activeSidebarThreadId === undefined
        ? null
        : (orderedEntries.find((entry) => entry.rowId === input.activeSidebarThreadId) ?? null);
    const paging = resolveSidebarThreadListPaging({
      totalCount: orderedEntries.length,
      baseLimit: input.previewLimit,
      pageSize: input.previewPageSize,
      requestedExtraPages,
    });
    const { visibleEntries: renderedEntries } = getVisibleSidebarEntriesForPreview({
      entries: orderedEntries,
      activeEntryId: activeEntry?.rowId,
      previewLimit: paging.previewLimit,
    });

    byProjectId.set(project.id, {
      allProjectThreadCount: allProjectThreads.length,
      projectThreads,
      orderedProjectThreadIds,
      visibleEntries: renderedEntries,
      threadListExtraPages: paging.effectiveExtraPages,

      canShowMoreThreads: paging.canShowMore && renderedEntries.length < orderedEntries.length,
      activeEntryId: activeEntry?.rowId ?? null,
      projectStatus,
    });
  }

  return byProjectId;
}
