import { SquarePenIcon } from "~/lib/icons";
import { useStore } from "../store";
import { useSidebarStateStore } from "../sidebarStateStore";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ProjectId, SpaceId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { MAX_PINNED_PROJECTS } from "@glade/contracts/orchestration/threadEntities";
import { type SidebarNavItemId } from "../sidebarNavOrdering";
import { isMacNavigatorPlatform } from "../lib/utils";
import { isOrdinarySpaceProject } from "../lib/spaces";
import { threadJumpCommandForIndex } from "../keybindings";
import { useThreadPullRequests } from "../hooks/useThreadPullRequests";
import { isHomeChatContainerProject } from "../lib/chatProjects";
import { type SidebarThreadSummary } from "../types";
import { type EditProjectValue } from "./EditProjectDialog";
import { normalizeSidebarProjectThreadListCwd } from "./Sidebar.uiState";
import {
  buildProjectThreadTree,
  resolveProjectStatusIndicator,
  type SidebarDerivedProjectData,
} from "./Sidebar.logic.status";
import {
  getSidebarThreadIdsToPrewarm,
  getUnpinnedThreadsForSidebar,
  resolveProjectEmptyState,
} from "./Sidebar.logic.preview";
import { derivePinnedIds, orderPinnedItemsFirst } from "../pinning.logic";
import {
  deriveSidebarProjectData,
  groupSidebarThreadsByProjectId,
  sortProjectsForSidebar,
  sortThreadsForSidebar,
} from "./Sidebar.logic.projectData";
import { pruneProjectThreadListPagingForCollapsedProjects } from "./Sidebar.logic.statusTypes";
import { isTerminalFocused } from "../lib/terminalFocus";
import { hasThreadDetailResumeCursor } from "../threadDetailResumeCursors";
import { retainThreadDetailSubscription } from "../threadDetailSubscriptionRetention";
import { type SpaceActivityTone } from "./SpaceSwitcher";
import type { useSidebarProjectCommands } from "./useSidebarProjectCommands";
import {
  THREAD_PREVIEW_LIMIT,
  THREAD_PREVIEW_PAGE_SIZE,
  EMPTY_THREAD_JUMP_LABELS,
  SidebarNavItemDescriptor,
} from "./sidebarSupport";
export function useSidebarDerivedLists(context: ReturnType<typeof useSidebarProjectCommands>) {
  const {
    projects,
    chatSpaceByThreadId,
    activeSpaceId,
    threadsHydrated,
    homeDir,
    chatWorkspaceRoot,
    isOnSettings,
    appSettings,
    routeThreadId,
    routeSearch,
    activityVisibleThreadIds,
    suppressProjectClickAfterDragRef,
    optimisticPinnedStateByProjectId,
    activeSidebarThreadId,
    sidebarThreads,
    sidebarTreeThreads,
    resolveThreadStatusForSidebar,
    terminalOpen,
    terminalWorkspaceOpen,
    pinnedThreadIds,
    pinnedThreads,
    projectCwdById,
    prefetchModelsForPrimaryNewThread,
    handlePrimaryNewThread,
    activateThreadFromSidebarIntent,
  } = context;
  const renameProjectLocally = useStore((state) => state.renameProjectLocally);
  const setProjectAppearanceLocally = useStore((state) => state.setProjectAppearanceLocally);
  const persistedPinnedProjectIds = useSidebarStateStore((state) => state.pinnedProjectIds);
  const prunePinnedProjects = useSidebarStateStore((state) => state.prunePinnedProjects);
  const toggleThreadSelection = useSidebarStateStore((state) => state.toggleThread);
  const rangeSelectTo = useSidebarStateStore((state) => state.rangeSelectTo);
  const chatSectionExpanded = useSidebarStateStore((state) => state.chatSectionExpanded);
  const threadListExtraPagesByProjectCwd = useSidebarStateStore(
    (state) => state.threadListExtraPagesByProjectCwd,
  );
  const setThreadListExtraPagesByProjectCwd = useSidebarStateStore(
    (state) => state.setThreadListExtraPagesByProjectCwd,
  );
  const setDismissedThreadStatusKeyByThreadId = useSidebarStateStore(
    (state) => state.setDismissedThreadStatusKeyByThreadId,
  );
  const setLastThreadRoute = useSidebarStateStore((state) => state.setLastThreadRoute);
  const activityViewEnabled = useSidebarStateStore((state) => state.activityViewEnabled);
  const sidebarNavDescriptors: Record<SidebarNavItemId, SidebarNavItemDescriptor> = {
    newThread: {
      icon: SquarePenIcon,
      iconClassName: "size-3.5",
      label: "New thread",
      active: false,
      badge: null,
      onClick: handlePrimaryNewThread,
      onMouseEnter: prefetchModelsForPrimaryNewThread,
      onFocus: prefetchModelsForPrimaryNewThread,
    },
  };
  const sidebarThreadsByProjectId = groupSidebarThreadsByProjectId(sidebarTreeThreads);
  const sortedSidebarThreadsByProjectId = (() => {
    const byProjectId = new Map<ProjectId, SidebarThreadSummary[]>();
    for (const [projectId, projectThreads] of sidebarThreadsByProjectId) {
      byProjectId.set(projectId, sortThreadsForSidebar(projectThreads));
    }
    return byProjectId;
  })();
  const handleProjectTitlePointerDownCapture = () => {
    suppressProjectClickAfterDragRef.current = false;
  };
  const handleEditProjectSave = (
    projectId: ProjectId,
    next: EditProjectValue,
    previousLocalName: string | null,
  ) => {
    setProjectAppearanceLocally(projectId, next.appearance);
    const trimmed = next.name.trim();
    const normalizedPrevious = previousLocalName?.trim() ?? "";
    if (trimmed === normalizedPrevious) {
      return;
    }
    renameProjectLocally(projectId, trimmed.length > 0 ? trimmed : null);
  };
  const sortedProjects = sortProjectsForSidebar(
    projects,
    sidebarThreads,
    appSettings.sidebarProjectSortOrder,
  );
  const chatProjects = sortedProjects.filter((project) =>
    isHomeChatContainerProject(project, {
      homeDir,
      chatWorkspaceRoot,
    }),
  );
  const visibleChatThreadRows = (() => {
    if (!chatSectionExpanded) {
      return [];
    }
    return buildProjectThreadTree({
      threads: sortThreadsForSidebar(
        getUnpinnedThreadsForSidebar(
          chatProjects.flatMap((project) =>
            (sortedSidebarThreadsByProjectId.get(project.id) ?? []).filter(
              (thread) => (chatSpaceByThreadId[thread.id] ?? null) === activeSpaceId,
            ),
          ),
          pinnedThreadIds,
        ),
      ),
      forceVisibleThreadId: activeSidebarThreadId ?? undefined,
    });
  })();
  const visibleChatThreadIds = visibleChatThreadRows.map((row) => row.thread.id);
  const allStandardProjectsBase = sortedProjects.filter((project) =>
    isOrdinarySpaceProject(project, {
      homeDir,
      chatWorkspaceRoot,
    }),
  );
  const spaceActivityById = (() => {
    const priority: Record<SpaceActivityTone, number> = {
      attention: 3,
      running: 2,
      completed: 1,
    };
    const activity = new Map<SpaceId | null, SpaceActivityTone>();
    for (const project of allStandardProjectsBase) {
      const status = resolveProjectStatusIndicator(
        (sidebarThreadsByProjectId.get(project.id) ?? []).map(resolveThreadStatusForSidebar),
      );
      if (!status) continue;
      const tone: SpaceActivityTone =
        status.label === "Working" || status.label === "Background" || status.label === "Connecting"
          ? "running"
          : status.label === "Completed"
            ? "completed"
            : "attention";
      const projectSpaceId = project.spaceId ?? null;
      const current = activity.get(projectSpaceId);
      if (!current || priority[tone] > priority[current]) {
        activity.set(projectSpaceId, tone);
      }
    }
    return activity;
  })();
  const standardProjectsBase = allStandardProjectsBase.filter(
    (project) => (project.spaceId ?? null) === activeSpaceId,
  );
  const pinnedProjectIds = derivePinnedIds({
    items: standardProjectsBase,
    persistedPinnedIds: persistedPinnedProjectIds,
    optimisticPinnedStateById: optimisticPinnedStateByProjectId,
    maxCount: MAX_PINNED_PROJECTS,
  });
  const pinnedProjectIdSet = new Set(pinnedProjectIds);
  const standardProjects = orderPinnedItemsFirst(standardProjectsBase, pinnedProjectIds);
  const projectEmptyState = resolveProjectEmptyState({
    projectCount: standardProjects.length,
    threadsHydrated,
  });
  const standardProjectSidebarDataById: ReadonlyMap<ProjectId, SidebarDerivedProjectData> =
    deriveSidebarProjectData({
      projects: standardProjects,
      sortedSidebarThreadsByProjectId,
      pinnedThreadIds,
      threadListExtraPagesByProjectCwd,
      normalizeProjectCwd: normalizeSidebarProjectThreadListCwd,
      activeSidebarThreadId: activeSidebarThreadId ?? undefined,
      previewLimit: THREAD_PREVIEW_LIMIT,
      previewPageSize: THREAD_PREVIEW_PAGE_SIZE,
      resolveThreadStatus: resolveThreadStatusForSidebar,
    });
  const surfaceProjects = standardProjects;
  const surfaceProjectSidebarDataById = standardProjectSidebarDataById;
  const allProjectsExpanded =
    standardProjects.length > 0 && standardProjects.every((project) => project.expanded);
  useEffect(() => {
    const settle = window.setTimeout(() => {
      setThreadListExtraPagesByProjectCwd((current) =>
        pruneProjectThreadListPagingForCollapsedProjects({
          threadListExtraPagesByProjectCwd: current,
          projects: standardProjects,
          normalizeProjectCwd: normalizeSidebarProjectThreadListCwd,
        }),
      );
    }, 0);
    return () => window.clearTimeout(settle);
  }, [standardProjects, setThreadListExtraPagesByProjectCwd]);
  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }
    prunePinnedProjects(allStandardProjectsBase.map((project) => project.id));
  }, [allStandardProjectsBase, prunePinnedProjects, threadsHydrated]);
  useEffect(() => {
    const retainedThreadIds = new Set(sidebarThreads.map((thread) => thread.id));
    const settle = window.setTimeout(() => {
      setDismissedThreadStatusKeyByThreadId((current) => {
        const nextEntries = Object.entries(current).filter(([threadId]) =>
          retainedThreadIds.has(ThreadId.makeUnsafe(threadId)),
        );
        if (nextEntries.length === Object.keys(current).length) {
          return current;
        }
        return Object.fromEntries(nextEntries);
      });
    }, 0);
    return () => window.clearTimeout(settle);
  }, [sidebarThreads, setDismissedThreadStatusKeyByThreadId]);
  useEffect(() => {
    if (isOnSettings || routeThreadId === null) {
      return;
    }
    const nextLastThreadRoute = {
      threadId: routeThreadId,
      ...(routeSearch.splitViewId
        ? {
            splitViewId: routeSearch.splitViewId,
          }
        : {}),
    };
    const settle = window.setTimeout(() => {
      setLastThreadRoute((current) => {
        if (
          current?.threadId === nextLastThreadRoute.threadId &&
          current?.splitViewId === nextLastThreadRoute.splitViewId
        ) {
          return current;
        }
        return nextLastThreadRoute;
      });
    }, 0);
    return () => window.clearTimeout(settle);
  }, [isOnSettings, routeSearch.splitViewId, routeThreadId, setLastThreadRoute]);
  const handleThreadClick = (
    event: MouseEvent,
    threadId: ThreadId,
    orderedProjectThreadIds: readonly ThreadId[],
  ) => {
    const isMac = isMacNavigatorPlatform();
    const isModClick = isMac ? event.metaKey : event.ctrlKey;
    const isShiftClick = event.shiftKey;
    if (isModClick) {
      event.preventDefault();
      toggleThreadSelection(threadId);
      return;
    }
    if (isShiftClick) {
      event.preventDefault();
      rangeSelectTo(threadId, orderedProjectThreadIds);
      return;
    }
    activateThreadFromSidebarIntent(threadId);
  };
  const classicVisibleSidebarThreadIds = (() => {
    const visibleThreadIdSet = new Set<ThreadId>();
    const addVisibleThreadId = (threadId: ThreadId) => {
      visibleThreadIdSet.add(threadId);
    };
    for (const thread of pinnedThreads) {
      addVisibleThreadId(thread.id);
    }
    for (const project of surfaceProjects) {
      const projectSidebarData = surfaceProjectSidebarDataById.get(project.id);
      if (!projectSidebarData) {
        continue;
      }
      if (!project.expanded) {
        if (projectSidebarData.activeEntryId) {
          addVisibleThreadId(projectSidebarData.activeEntryId);
        }
        continue;
      }
      for (const entry of projectSidebarData.visibleEntries) {
        addVisibleThreadId(entry.rowId);
      }
    }
    return [...visibleThreadIdSet];
  })();
  const visibleSidebarThreadIds = activityViewEnabled
    ? activityVisibleThreadIds
    : classicVisibleSidebarThreadIds;
  const visibleSidebarThreadIdSet = new Set(
    activityViewEnabled
      ? [...visibleSidebarThreadIds, ...pinnedThreadIds]
      : [...visibleSidebarThreadIds, ...visibleChatThreadIds],
  );
  const visibleSidebarThreads = sidebarTreeThreads.filter((thread) =>
    visibleSidebarThreadIdSet.has(thread.id),
  );
  const prByThreadId = useThreadPullRequests({
    threads: visibleSidebarThreads,
    projectCwdById,
    pinnedThreadIds,
  });
  const isManualProjectSorting = appSettings.sidebarProjectSortOrder === "manual";
  const threadJumpCommandByThreadId = (() => {
    const mapping = new Map<ThreadId, NonNullable<ReturnType<typeof threadJumpCommandForIndex>>>();
    for (const [visibleThreadIndex, threadId] of visibleSidebarThreadIds.entries()) {
      const jumpCommand = threadJumpCommandForIndex(visibleThreadIndex);
      if (!jumpCommand) {
        break;
      }
      mapping.set(threadId, jumpCommand);
    }
    return mapping;
  })();
  const threadJumpThreadIds = [...threadJumpCommandByThreadId.keys()];
  const getCurrentSidebarShortcutContext = useCallback(
    () => ({
      terminalFocus: isTerminalFocused(),
      terminalOpen,
      terminalWorkspaceOpen,
    }),
    [terminalOpen, terminalWorkspaceOpen],
  );
  const [threadJumpLabelByThreadId, setThreadJumpLabelByThreadId] =
    useState<ReadonlyMap<ThreadId, string>>(EMPTY_THREAD_JUMP_LABELS);
  const threadJumpLabelsRef = useRef<ReadonlyMap<ThreadId, string>>(EMPTY_THREAD_JUMP_LABELS);
  useEffect(() => {
    threadJumpLabelsRef.current = threadJumpLabelByThreadId;
  }, [threadJumpLabelByThreadId]);
  const [showThreadJumpHints, setShowThreadJumpHints] = useState(false);
  const showThreadJumpHintsRef = useRef(false);
  useEffect(() => {
    showThreadJumpHintsRef.current = showThreadJumpHints;
  }, [showThreadJumpHints]);
  const visibleThreadJumpLabelByThreadId = showThreadJumpHints
    ? threadJumpLabelByThreadId
    : EMPTY_THREAD_JUMP_LABELS;
  useEffect(() => {
    const threadIdsToPrewarm = getSidebarThreadIdsToPrewarm({
      visibleThreadIds: visibleSidebarThreadIds,
      activeThreadId: activeSidebarThreadId,
    });
    const releaseCallbacks = threadIdsToPrewarm
      .filter((threadId) => hasThreadDetailResumeCursor(threadId))
      .map((threadId) => retainThreadDetailSubscription(threadId));
    return () => {
      for (const release of releaseCallbacks) {
        release();
      }
    };
  }, [activeSidebarThreadId, visibleSidebarThreadIds]);
  return {
    ...context,
    sidebarNavDescriptors,
    handleProjectTitlePointerDownCapture,
    handleEditProjectSave,
    sortedProjects,
    visibleChatThreadRows,
    visibleChatThreadIds,
    allStandardProjectsBase,
    spaceActivityById,
    pinnedProjectIdSet,
    standardProjects,
    projectEmptyState,
    surfaceProjectSidebarDataById,
    allProjectsExpanded,
    handleThreadClick,
    visibleSidebarThreadIds,
    prByThreadId,
    isManualProjectSorting,
    threadJumpCommandByThreadId,
    threadJumpThreadIds,
    getCurrentSidebarShortcutContext,
    setThreadJumpLabelByThreadId,
    threadJumpLabelsRef,
    setShowThreadJumpHints,
    showThreadJumpHintsRef,
    visibleThreadJumpLabelByThreadId,
  };
}
