import { useSidebarStateStore } from "../sidebarStateStore";
import { ClockIcon, KanbanIcon, NewThreadIcon } from "~/lib/icons";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ProjectId, SpaceId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { SIDEBAR_NAV_ITEM_IDS, type SidebarNavItemId } from "../sidebarNavOrdering";
import { buildRailSpacesSections, resolveRailShortcuts } from "../appRail.logic";
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
  derivePinnedProjectIdsForSidebar,
  orderPinnedProjectsForSidebar,
  getSidebarThreadIdsToPrewarm,
  resolveProjectEmptyState,
  shouldPrunePinnedThreads,
} from "./Sidebar.logic.preview";
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
    spaces,
    chatSpaceByThreadId,
    activeSpaceId,
    threadsHydrated,
    isRailLayout,
    railSpacesProjectId,
    renameProjectLocally,
    setProjectAppearanceLocally,
    persistedPinnedProjectIds,
    prunePinnedProjects,
    homeDir,
    chatWorkspaceRoot,
    navigate,
    isOnSettings,
    isOnKanban,
    isOnAutomations,
    automationAttentionBadge,
    appSettings,
    routeThreadId,
    routeSearch,
    activityVisibleThreadIds,
    suppressProjectClickAfterDragRef,
    optimisticPinnedStateByProjectId,
    toggleThreadSelection,
    rangeSelectTo,
    activeSidebarThreadId,
    sidebarThreads,
    sidebarTreeThreads,
    projectById,
    resolveThreadStatusForSidebar,
    terminalOpen,
    terminalWorkspaceOpen,
    pinnedThreadIds,
    pinnedThreads,
    projectCwdById,
    prefetchModelsForPrimaryNewThread,
    handlePrimaryNewThread,
    activateThreadFromSidebarIntent,
    voidSpace,
  } = context;
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

  const sidebarNavDescriptors = useMemo<Record<SidebarNavItemId, SidebarNavItemDescriptor>>(
    () => ({
      newThread: {
        icon: NewThreadIcon,
        iconClassName: "size-3.5",
        label: "New thread",
        active: false,
        badge: null,
        onClick: handlePrimaryNewThread,
        onMouseEnter: prefetchModelsForPrimaryNewThread,
        onFocus: prefetchModelsForPrimaryNewThread,
      },
      kanban: {
        icon: KanbanIcon,
        label: "Kanban",
        active: isOnKanban,
        badge: null,
        onClick: () => {
          void navigate({ to: "/kanban" });
        },
      },
      automations: {
        icon: ClockIcon,
        label: "Automations",
        active: isOnAutomations,
        badge: automationAttentionBadge,
        onClick: () => {
          void navigate({ to: "/automations" });
        },
      },
    }),
    [
      automationAttentionBadge,
      handlePrimaryNewThread,
      isOnAutomations,
      isOnKanban,
      navigate,
      prefetchModelsForPrimaryNewThread,
    ],
  );

  const railRouteItemIds = SIDEBAR_NAV_ITEM_IDS.filter((id) => id !== "newThread");

  const sidebarThreadsByProjectId = useMemo(
    () => groupSidebarThreadsByProjectId(sidebarTreeThreads),
    [sidebarTreeThreads],
  );

  const sortedSidebarThreadsByProjectId = useMemo(() => {
    const byProjectId = new Map<ProjectId, SidebarThreadSummary[]>();
    for (const [projectId, projectThreads] of sidebarThreadsByProjectId) {
      byProjectId.set(
        projectId,
        sortThreadsForSidebar(projectThreads, appSettings.sidebarThreadSortOrder),
      );
    }
    return byProjectId;
  }, [appSettings.sidebarThreadSortOrder, sidebarThreadsByProjectId]);

  const handleProjectTitlePointerDownCapture = useCallback(() => {
    suppressProjectClickAfterDragRef.current = false;
  }, [suppressProjectClickAfterDragRef]);

  const handleEditProjectSave = useCallback(
    (projectId: ProjectId, next: EditProjectValue, previousLocalName: string | null) => {
      setProjectAppearanceLocally(projectId, next.appearance);
      const trimmed = next.name.trim();
      const normalizedPrevious = previousLocalName?.trim() ?? "";
      if (trimmed === normalizedPrevious) {
        return;
      }
      renameProjectLocally(projectId, trimmed.length > 0 ? trimmed : null);
    },
    [renameProjectLocally, setProjectAppearanceLocally],
  );

  const sortedProjects = useMemo(
    () => sortProjectsForSidebar(projects, sidebarThreads, appSettings.sidebarProjectSortOrder),
    [appSettings.sidebarProjectSortOrder, projects, sidebarThreads],
  );

  const chatProjects = useMemo(
    () =>
      sortedProjects.filter((project) =>
        isHomeChatContainerProject(project, { homeDir, chatWorkspaceRoot }),
      ),
    [chatWorkspaceRoot, homeDir, sortedProjects],
  );

  const visibleChatThreadRows = useMemo(() => {
    if (!chatSectionExpanded) {
      return [];
    }
    return buildProjectThreadTree({
      threads: sortThreadsForSidebar(
        chatProjects.flatMap((project) =>
          (sortedSidebarThreadsByProjectId.get(project.id) ?? []).filter(
            (thread) => (chatSpaceByThreadId[thread.id] ?? null) === activeSpaceId,
          ),
        ),
        appSettings.sidebarThreadSortOrder,
      ),
      forceVisibleThreadId: activeSidebarThreadId ?? undefined,
    });
  }, [
    activeSidebarThreadId,
    activeSpaceId,
    appSettings.sidebarThreadSortOrder,
    chatSectionExpanded,
    chatProjects,
    chatSpaceByThreadId,
    sortedSidebarThreadsByProjectId,
  ]);

  const visibleChatThreadIds = useMemo(
    () => visibleChatThreadRows.map((row) => row.thread.id),
    [visibleChatThreadRows],
  );

  const allStandardProjectsBase = useMemo(
    () =>
      sortedProjects.filter((project) =>
        isOrdinarySpaceProject(project, { homeDir, chatWorkspaceRoot }),
      ),
    [chatWorkspaceRoot, homeDir, sortedProjects],
  );

  const spaceActivityById = useMemo(() => {
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
        status.label === "Working" || status.label === "Connecting"
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
  }, [allStandardProjectsBase, resolveThreadStatusForSidebar, sidebarThreadsByProjectId]);

  const standardProjectsBase = useMemo(
    () => allStandardProjectsBase.filter((project) => (project.spaceId ?? null) === activeSpaceId),
    [activeSpaceId, allStandardProjectsBase],
  );

  const pinnedProjectIds = useMemo(
    () =>
      derivePinnedProjectIdsForSidebar({
        projects: standardProjectsBase,
        persistedPinnedProjectIds,
        optimisticPinnedStateByProjectId,
      }),
    [optimisticPinnedStateByProjectId, persistedPinnedProjectIds, standardProjectsBase],
  );

  const pinnedProjectIdSet = useMemo(() => new Set(pinnedProjectIds), [pinnedProjectIds]);

  const standardProjects = useMemo(
    () => orderPinnedProjectsForSidebar(standardProjectsBase, pinnedProjectIds),
    [pinnedProjectIds, standardProjectsBase],
  );

  const projectEmptyState = resolveProjectEmptyState({
    projectCount: standardProjects.length,
    threadsHydrated,
  });

  const standardProjectSidebarDataById = useMemo<ReadonlyMap<ProjectId, SidebarDerivedProjectData>>(
    () =>
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
      }),
    [
      activeSidebarThreadId,
      threadListExtraPagesByProjectCwd,
      pinnedThreadIds,
      sortedSidebarThreadsByProjectId,
      standardProjects,
      resolveThreadStatusForSidebar,
    ],
  );

  const surfaceProjects = standardProjects;

  const surfaceProjectSidebarDataById = standardProjectSidebarDataById;

  const allProjectsExpanded = useMemo(
    () => standardProjects.length > 0 && standardProjects.every((project) => project.expanded),
    [standardProjects],
  );

  const railSpacesSections = useMemo(
    () =>
      isRailLayout
        ? buildRailSpacesSections({
            items: allStandardProjectsBase,
            spaces,
            activeSpaceId,
            spaceIdOf: (project) => project.spaceId ?? null,
            voidSpace,
          })
        : [],
    [activeSpaceId, allStandardProjectsBase, isRailLayout, spaces, voidSpace],
  );

  const railShortcuts = useMemo(
    () =>
      isRailLayout
        ? resolveRailShortcuts({
            keys: appSettings.railShortcuts,
            spaceIds: new Set(spaces.map((space) => space.id)),
            projectIds: new Set(allStandardProjectsBase.map((project) => project.id)),
          })
        : [],
    [allStandardProjectsBase, appSettings.railShortcuts, isRailLayout, spaces],
  );

  const railSpacesProject =
    isRailLayout && railSpacesProjectId !== null
      ? (projectById.get(railSpacesProjectId) ?? null)
      : null;

  const railSpacesProjectSidebarData = useMemo(() => {
    if (!railSpacesProject) {
      return null;
    }
    return (
      deriveSidebarProjectData({
        projects: [{ id: railSpacesProject.id, cwd: railSpacesProject.cwd, expanded: true }],
        sortedSidebarThreadsByProjectId,
        pinnedThreadIds,
        threadListExtraPagesByProjectCwd,
        normalizeProjectCwd: normalizeSidebarProjectThreadListCwd,
        activeSidebarThreadId: activeSidebarThreadId ?? undefined,
        previewLimit: THREAD_PREVIEW_LIMIT,
        previewPageSize: THREAD_PREVIEW_PAGE_SIZE,
        resolveThreadStatus: resolveThreadStatusForSidebar,
      }).get(railSpacesProject.id) ?? null
    );
  }, [
    activeSidebarThreadId,
    pinnedThreadIds,
    railSpacesProject,
    resolveThreadStatusForSidebar,
    sortedSidebarThreadsByProjectId,
    threadListExtraPagesByProjectCwd,
  ]);

  const railSpacesPagedProjectId = railSpacesProject?.id ?? null;

  useEffect(() => {
    const settle = window.setTimeout(() => {
      setThreadListExtraPagesByProjectCwd((current) =>
        pruneProjectThreadListPagingForCollapsedProjects({
          threadListExtraPagesByProjectCwd: current,
          projects:
            railSpacesPagedProjectId === null
              ? standardProjects
              : standardProjects.filter((project) => project.id !== railSpacesPagedProjectId),
          normalizeProjectCwd: normalizeSidebarProjectThreadListCwd,
        }),
      );
    }, 0);
    return () => window.clearTimeout(settle);
  }, [railSpacesPagedProjectId, standardProjects, setThreadListExtraPagesByProjectCwd]);

  useEffect(() => {
    if (!shouldPrunePinnedThreads({ threadsHydrated })) {
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
      ...(routeSearch.splitViewId ? { splitViewId: routeSearch.splitViewId } : {}),
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

  const handleThreadClick = useCallback(
    (event: MouseEvent, threadId: ThreadId, orderedProjectThreadIds: readonly ThreadId[]) => {
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
    },
    [activateThreadFromSidebarIntent, rangeSelectTo, toggleThreadSelection],
  );

  const classicVisibleSidebarThreadIds = useMemo(() => {
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
  }, [pinnedThreads, surfaceProjectSidebarDataById, surfaceProjects]);

  const visibleSidebarThreadIds = activityViewEnabled
    ? activityVisibleThreadIds
    : classicVisibleSidebarThreadIds;

  const visibleSidebarThreadIdSet = useMemo(
    () =>
      new Set(
        activityViewEnabled
          ? visibleSidebarThreadIds
          : [...visibleSidebarThreadIds, ...visibleChatThreadIds],
      ),
    [activityViewEnabled, visibleChatThreadIds, visibleSidebarThreadIds],
  );

  const visibleSidebarThreads = useMemo(
    () => sidebarTreeThreads.filter((thread) => visibleSidebarThreadIdSet.has(thread.id)),
    [sidebarTreeThreads, visibleSidebarThreadIdSet],
  );

  const prByThreadId = useThreadPullRequests({
    threads: visibleSidebarThreads,
    projectCwdById,
  });

  const isManualProjectSorting = appSettings.sidebarProjectSortOrder === "manual";

  const threadJumpCommandByThreadId = useMemo(() => {
    const mapping = new Map<ThreadId, NonNullable<ReturnType<typeof threadJumpCommandForIndex>>>();
    for (const [visibleThreadIndex, threadId] of visibleSidebarThreadIds.entries()) {
      const jumpCommand = threadJumpCommandForIndex(visibleThreadIndex);
      if (!jumpCommand) {
        break;
      }
      mapping.set(threadId, jumpCommand);
    }

    return mapping;
  }, [visibleSidebarThreadIds]);

  const threadJumpThreadIds = useMemo(
    () => [...threadJumpCommandByThreadId.keys()],
    [threadJumpCommandByThreadId],
  );

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
    railRouteItemIds,
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
    railSpacesSections,
    railShortcuts,
    railSpacesProject,
    railSpacesProjectSidebarData,
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
