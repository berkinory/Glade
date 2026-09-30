import { ensureNativeApi } from "~/nativeApi";
import {
  useCallback,
  useEffect,
  startTransition,
  useMemo,
  useRef,
  useSyncExternalStore,
  useState,
  type MouseEvent,
} from "react";
import { type AutomationListResult } from "@glade/contracts/automation/automation";
import { type DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import { ProjectId, SpaceId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { pluralize } from "@glade/shared/text/text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useAppSettings } from "../appSettings";
import { useRailShellStore } from "../railShellStore";
import { useSidebarLayout } from "../hooks/useSidebarLayout";
import { isMacNavigatorPlatform } from "../lib/utils";
import { isOrdinarySpaceProject } from "../lib/spaces";
import { useStore } from "../store";
import { shortcutLabelForCommand } from "../keybindings";
import {
  createProjectLastActivityAtSelector,
  createSidebarThreadSummariesSelector,
  createSidebarTreeThreadsSelector,
  isSidebarThreadVisible,
} from "../storeSelectors";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { isHomeChatContainerProject } from "../lib/chatProjects";
import { useComposerDraftStore } from "../composerDraftStore";
import { useLatestProjectStore } from "../latestProjectStore";
import { type SidebarThreadSummary } from "../types";
import {
  applyAutomationEvent,
  automationAttentionCount,
  automationQueryKey,
  groupAutomationsByContinuedThread,
} from "../routes/-automations.shared";
import { shouldRenderTerminalWorkspace } from "./ChatView.logic.subagents";
import { hasUnreadActivity as hasUnreadActivityOutsideActiveThread } from "./SidebarActivityView.logic";
import { type SidebarSearchPaletteMode } from "./SidebarSearchPalette";
import { useHandleNewChat } from "../hooks/useHandleNewChat";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useProviderStatusesForLocalConfig } from "../hooks/useProviderStatusesForLocalConfig";
import { useFeedbackDialogStore } from "../feedbackDialogStore";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { toastManager } from "./ui/toast";
import { readSidebarUiState, subscribeSidebarUiState } from "./Sidebar.uiState";
import { useSidebarStateStore } from "../sidebarStateStore";
import { getPinnedThreadsForSidebar } from "./Sidebar.logic.preview";
import {
  DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY,
  shouldShowDebugFeatureFlagsMenu,
} from "./Sidebar.logic.statusTypes";
import { resolveThreadStatusPill } from "./Sidebar.logic.status";
import { useDiffRouteSearch } from "../hooks/useDiffRouteSearch";
import { normalizeSettingsSection } from "../settingsNavigation";
import { selectSplitView, useSplitViewStore } from "../splitViewStore";
import { useRightDockStore } from "../rightDockStore";
import { useSidebarProjectRunController } from "../hooks/useSidebarProjectRunController";
import { useSidebarThreadActions } from "../hooks/useSidebarThreadActions";
import { useWorkspacePathsStore } from "../workspacePathsStore";
import { useFocusedChatContext } from "../focusedChatContext";
import { useSpacesUiStore } from "../spacesUiStore";
import { resolveActiveSpaceId } from "../lib/spaceGrouping";
import {
  EMPTY_KEYBINDINGS,
  subscribeGitHubProvisioningCapability,
  readGitHubProvisioningCapability,
  readGitHubProvisioningServerCapability,
  ProjectContextMenuState,
  DebugFeatureFlagsWindow,
  readDebugFeatureFlagsMenuVisibility,
} from "./sidebarSupport";

export function useSidebarShellState() {
  const githubProvisioningAvailable = useSyncExternalStore(
    subscribeGitHubProvisioningCapability,
    readGitHubProvisioningCapability,
    readGitHubProvisioningServerCapability,
  );

  const [showDebugFeatureFlagsMenu, setShowDebugFeatureFlagsMenu] = useState(
    readDebugFeatureFlagsMenuVisibility,
  );

  const projects = useStore((store) => store.projects);

  const spaces = useStore((store) => store.spaces);

  const storedActiveSpaceId = useSpacesUiStore((store) => store.activeSpaceId);

  const chatSpaceByThreadId = useSpacesUiStore((store) => store.chatSpaceByThreadId);

  const pendingActiveSpaceId = useSpacesUiStore(
    (store) => store.pendingActiveSpace?.spaceId ?? null,
  );

  const activeSpaceId = resolveActiveSpaceId(storedActiveSpaceId, spaces, pendingActiveSpaceId);

  const threadsHydrated = useStore((store) => store.threadsHydrated);

  const isRailLayout = useSidebarLayout() === "rail";

  const railActiveItem = useRailShellStore((store) => store.activeItem);

  const railPanelView = useRailShellStore((store) => store.panelView);

  const railSpacesProjectId = useRailShellStore((store) => store.spacesProjectId);

  const selectRailPanelItem = useRailShellStore((store) => store.selectPanelItem);

  const selectRailRouteItem = useRailShellStore((store) => store.selectRouteItem);

  const openRailSpacesProject = useRailShellStore((store) => store.openSpacesProject);

  const closeRailSpacesProject = useRailShellStore((store) => store.closeSpacesProject);

  const reconcileRailShell = useRailShellStore((store) => store.reconcile);

  const sidebarThreadSummaryById = useStore((store) => store.sidebarThreadSummaryById);

  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);

  const markThreadVisited = useStore((store) => store.markThreadVisited);

  const markThreadUnread = useStore((store) => store.markThreadUnread);

  const toggleProject = useStore((store) => store.toggleProject);

  const setProjectExpanded = useStore((store) => store.setProjectExpanded);

  const setAllProjectsExpanded = useStore((store) => store.setAllProjectsExpanded);

  const collapseProjectsExcept = useStore((store) => store.collapseProjectsExcept);

  const reorderProjects = useStore((store) => store.reorderProjects);

  const renameProjectLocally = useStore((store) => store.renameProjectLocally);

  const setProjectAppearanceLocally = useStore((store) => store.setProjectAppearanceLocally);

  const removeDeletedProjectFromClientState = useStore(
    (store) => store.removeDeletedProjectFromClientState,
  );

  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);

  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);

  const openChatThreadPage = useTerminalStateStore((state) => state.openChatThreadPage);

  const openTerminalThreadPage = useTerminalStateStore((state) => state.openTerminalThreadPage);

  const clearProjectDraftThreads = useComposerDraftStore((store) => store.clearProjectDraftThreads);

  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);

  const persistedPinnedProjectIds = useSidebarStateStore((store) => store.pinnedProjectIds);

  const pinProjectLocally = useSidebarStateStore((store) => store.pinProject);

  const unpinProject = useSidebarStateStore((store) => store.unpinProject);

  const prunePinnedProjects = useSidebarStateStore((store) => store.prunePinnedProjects);

  const homeDir = useWorkspacePathsStore((store) => store.homeDir);

  const chatWorkspaceRoot = useWorkspacePathsStore((store) => store.chatWorkspaceRoot);

  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const pathname = useLocation({ select: (loc) => loc.pathname });

  const isOnSettings = useLocation({
    select: (loc) => loc.pathname === "/settings",
  });

  const isOnKanban = pathname.startsWith("/kanban");

  const isOnAutomations = pathname.startsWith("/automations");

  const automationListQuery = useQuery({
    queryKey: automationQueryKey,
    queryFn: () => ensureNativeApi().automation.list({}),
  });

  useEffect(() => {
    const api = ensureNativeApi();
    return api.automation.onEvent((event) => {
      queryClient.setQueryData<AutomationListResult>(automationQueryKey, (prev) =>
        applyAutomationEvent(prev, event),
      );
    });
  }, [queryClient]);

  const automationAttentionBadge = useMemo(() => {
    const data = automationListQuery.data;
    if (!data) return null;
    const count = automationAttentionCount(data.runs);
    return count > 0
      ? {
          text: String(count),
          accessibleLabel: `${count} ${pluralize(count, "automation needs", "automations need")} attention`,
        }
      : null;
  }, [automationListQuery.data]);

  const automationsByThreadId = useMemo(
    () => groupAutomationsByContinuedThread(automationListQuery.data?.definitions ?? []),
    [automationListQuery.data],
  );

  const { settings: appSettings, serverSettings, updateSettings } = useAppSettings();

  const chatsSectionVisible = appSettings.showChatsSection;

  const { handleNewThread } = useHandleNewThread();

  const { handleNewChat } = useHandleNewChat();

  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });

  const routeProjectId = useParams({
    strict: false,
    select: (params) =>
      typeof params.projectId === "string" ? ProjectId.makeUnsafe(params.projectId) : null,
  });

  const routeSearch = useDiffRouteSearch();

  const settingsSectionSearch = useSearch({ strict: false }) as Record<string, unknown>;

  const activeSettingsSection = normalizeSettingsSection(settingsSectionSearch.section);

  const activeSplitView = useSplitViewStore(
    useMemo(() => selectSplitView(routeSearch.splitViewId ?? null), [routeSearch.splitViewId]),
  );

  const splitViewsById = useSplitViewStore((store) => store.splitViewsById);

  useEffect(() => {
    const api = readNativeApi();
    if (!api || !threadsHydrated || projects.length > 0) {
      return;
    }

    let cancelled = false;

    void api.orchestration
      .getShellSnapshot()
      .then((snapshot) => {
        if (
          cancelled ||
          (snapshot.spaces.length === 0 &&
            snapshot.projects.length === 0 &&
            snapshot.threads.length === 0)
        ) {
          return;
        }
        syncServerShellSnapshot(snapshot);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [projects.length, syncServerShellSnapshot, threadsHydrated]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const canInstallConsoleCommand = shouldShowDebugFeatureFlagsMenu({
      isDev: import.meta.env.DEV,
      hostname: window.location.hostname,
      storageValue: "true",
    });
    if (!canInstallConsoleCommand) {
      return;
    }

    const debugWindow = window as DebugFeatureFlagsWindow;
    const updateVisibility = () => {
      setShowDebugFeatureFlagsMenu(readDebugFeatureFlagsMenuVisibility());
    };
    const showFeatureFlags = () => {
      window.localStorage.setItem(DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY, "true");
      updateVisibility();
    };
    const hideFeatureFlags = () => {
      window.localStorage.removeItem(DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY);
      updateVisibility();
    };

    debugWindow.gladeShowFeatureFlags = showFeatureFlags;
    debugWindow.gladeHideFeatureFlags = hideFeatureFlags;
    window.addEventListener("storage", updateVisibility);
    updateVisibility();

    return () => {
      window.removeEventListener("storage", updateVisibility);
      if (debugWindow.gladeShowFeatureFlags === showFeatureFlags) {
        delete debugWindow.gladeShowFeatureFlags;
      }
      if (debugWindow.gladeHideFeatureFlags === hideFeatureFlags) {
        delete debugWindow.gladeHideFeatureFlags;
      }
    };
  }, []);

  const setSplitFocusedPane = useSplitViewStore((store) => store.setFocusedPane);

  const openRightDockPane = useRightDockStore((store) => store.openPane);

  const keybindingsQuery = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });

  const keybindings = keybindingsQuery.data ?? EMPTY_KEYBINDINGS;

  const serverCwdQuery = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.cwd ?? null,
  });

  const serverCwd = serverCwdQuery.data ?? null;

  const providerStatuses = useProviderStatusesForLocalConfig();

  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.new") ??
    shortcutLabelForCommand(keybindings, "chat.newLatestProject");

  const newChatShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newChat") ??
    shortcutLabelForCommand(keybindings, "chat.newLocal");

  const searchShortcutLabel =
    shortcutLabelForCommand(keybindings, "sidebar.search") ??
    (isMacNavigatorPlatform() ? "⌘K" : "Ctrl+K");

  const activityShortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.activity");

  const importThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "sidebar.importThread") ??
    (isMacNavigatorPlatform() ? "⌘I" : "Ctrl+I");

  const addProjectShortcutLabel =
    shortcutLabelForCommand(keybindings, "sidebar.addProject") ??
    (isMacNavigatorPlatform() ? "⇧⌘O" : "Ctrl+Shift+O");

  const usageSettingsShortcutLabel = shortcutLabelForCommand(keybindings, "settings.usage");

  const { activeProjectId: focusedProjectId } = useFocusedChatContext();

  const latestProjectId = useLatestProjectStore((state) => state.latestProjectId);

  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);

  const [createProjectSpaceId, setCreateProjectSpaceId] = useState<SpaceId | null | undefined>();

  const [searchPaletteOpen, setSearchPaletteOpen] = useState(false);

  const openFeedbackDialog = useFeedbackDialogStore((state) => state.openDialog);

  const [searchPaletteMode, setSearchPaletteMode] = useState<SidebarSearchPaletteMode>("search");

  const projectAdditionLockRef = useRef(false);

  const [renameDialogThreadId, setRenameDialogThreadId] = useState<ThreadId | null>(null);

  const [editProjectDialog, setEditProjectDialog] = useState<{
    projectId: ProjectId;
    open: boolean;
  } | null>(null);

  const [relocateProjectDialogId, setRelocateProjectDialogId] = useState<ProjectId | null>(null);

  const [projectContextMenuState, setProjectContextMenuState] =
    useState<ProjectContextMenuState | null>(null);

  const [threadListExtraPagesByProjectCwd, setThreadListExtraPagesByProjectCwd] = useState<
    ReadonlyMap<string, number>
  >(() => new Map(Object.entries(readSidebarUiState().projectThreadListExtraPagesByCwd)));

  const [chatSectionExpanded, setChatSectionExpanded] = useState(
    () => readSidebarUiState().chatSectionExpanded,
  );

  const [dismissedThreadStatusKeyByThreadId, setDismissedThreadStatusKeyByThreadId] = useState<
    Record<string, string>
  >(() => readSidebarUiState().dismissedThreadStatusKeyByThreadId);

  const [lastThreadRoute, setLastThreadRoute] = useState(
    () => readSidebarUiState().lastThreadRoute,
  );

  const [activityViewEnabled, setActivityViewEnabled] = useState(
    () => readSidebarUiState().activityViewEnabled,
  );

  const [activityVisibleThreadIds, setActivityVisibleThreadIds] = useState<readonly ThreadId[]>([]);

  const handleActivityVisibleThreadIdsChange = useCallback((threadIds: readonly ThreadId[]) => {
    setActivityVisibleThreadIds((current) => {
      if (
        current.length === threadIds.length &&
        current.every((threadId, index) => threadId === threadIds[index])
      ) {
        return current;
      }
      return [...threadIds];
    });
  }, []);

  useEffect(
    () =>
      subscribeSidebarUiState((state) => {
        setChatSectionExpanded(state.chatSectionExpanded);
        setThreadListExtraPagesByProjectCwd(
          new Map(Object.entries(state.projectThreadListExtraPagesByCwd)),
        );
        setDismissedThreadStatusKeyByThreadId(state.dismissedThreadStatusKeyByThreadId);
        setLastThreadRoute(state.lastThreadRoute);
        setActivityViewEnabled(state.activityViewEnabled);
      }),
    [],
  );

  const setActivityViewEnabledSmoothly = useCallback((enabled: boolean) => {
    startTransition(() => {
      setActivityViewEnabled(enabled);
    });
  }, []);

  const [optimisticActiveThreadId, setOptimisticActiveThreadId] = useState<ThreadId | null>(null);

  const lastThreadRenameTapRef = useRef<{
    threadId: ThreadId;
    timestamp: number;
  } | null>(null);

  const dragInProgressRef = useRef(false);

  const suppressProjectClickAfterDragRef = useRef(false);

  const optimisticPinnedStateByProjectIdRef = useRef(new Map<ProjectId, boolean>());

  const latestPinnedMutationVersionByProjectIdRef = useRef(new Map<ProjectId, number>());

  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);

  const [installingDesktopUpdate, setInstallingDesktopUpdate] = useState(false);

  const [optimisticPinnedStateByProjectId, setOptimisticPinnedStateByProjectId] = useState<
    ReadonlyMap<ProjectId, boolean>
  >(() => new Map());

  const lastDesktopUpdateErrorToastSignatureRef = useRef<string | null>(null);

  const selectedThreadIds = useSidebarStateStore((s) => s.selectedThreadIds);

  const toggleThreadSelection = useSidebarStateStore((s) => s.toggleThread);

  const rangeSelectTo = useSidebarStateStore((s) => s.rangeSelectTo);

  const clearSelection = useSidebarStateStore((s) => s.clearSelection);

  const removeFromSelection = useSidebarStateStore((s) => s.removeFromSelection);

  const setSelectionAnchor = useSidebarStateStore((s) => s.setAnchor);

  const routeActiveSidebarThreadId = routeThreadId;

  const activeSidebarThreadId = optimisticActiveThreadId ?? routeActiveSidebarThreadId;

  const visualActiveSidebarThreadId = optimisticActiveThreadId ?? routeThreadId;

  const selectSidebarThreads = useMemo(() => createSidebarThreadSummariesSelector(), []);

  const hideAutomationRunThreads = !appSettings.showAutomationRunThreads;

  const selectSidebarTreeThreads = useMemo(
    () => createSidebarTreeThreadsSelector({ hideAutomationRunThreads }),
    [hideAutomationRunThreads],
  );

  const sidebarThreads = useStore(selectSidebarThreads);

  const sidebarTreeThreads = useStore(selectSidebarTreeThreads);

  const selectProjectLastActivityAt = useMemo(() => createProjectLastActivityAtSelector(), []);

  const projectLastActivityAt = useStore(selectProjectLastActivityAt);

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );

  const visibleSidebarActivityThreads = useMemo(
    () =>
      sidebarThreads.filter((thread) => {
        if (!isSidebarThreadVisible(thread, { hideAutomationRunThreads })) return false;
        const project = projectById.get(thread.projectId);
        return (
          !isHomeChatContainerProject(project, { homeDir, chatWorkspaceRoot }) ||
          (chatSpaceByThreadId[thread.id] ?? null) === activeSpaceId
        );
      }),
    [
      activeSpaceId,
      chatSpaceByThreadId,
      chatWorkspaceRoot,
      hideAutomationRunThreads,
      homeDir,
      sidebarThreads,
      projectById,
    ],
  );

  const hasUnreadActivity = useMemo(
    () =>
      hasUnreadActivityOutsideActiveThread(visibleSidebarActivityThreads, activeSidebarThreadId),
    [activeSidebarThreadId, visibleSidebarActivityThreads],
  );

  const dismissThreadStatus = useCallback(
    (threadId: ThreadId, statusKey: string | null | undefined) => {
      if (!statusKey) {
        return;
      }
      setDismissedThreadStatusKeyByThreadId((current) => {
        if (current[threadId] === statusKey) {
          return current;
        }
        return {
          ...current,
          [threadId]: statusKey,
        };
      });
    },
    [],
  );

  const clearDismissedThreadStatus = useCallback((threadId: ThreadId) => {
    setDismissedThreadStatusKeyByThreadId((current) => {
      if (!(threadId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  }, []);

  const resolveThreadStatusForSidebar = useCallback(
    (thread: SidebarThreadSummary) =>
      resolveThreadStatusPill({
        thread: {
          ...thread,
          dismissedStatusKey: dismissedThreadStatusKeyByThreadId[thread.id],
        },
        hasPendingApprovals: thread.hasPendingApprovals,
        hasPendingUserInput: thread.hasPendingUserInput,
      }),
    [dismissedThreadStatusKeyByThreadId],
  );

  useEffect(() => {
    if (!optimisticActiveThreadId) {
      return;
    }
    if (routeActiveSidebarThreadId === optimisticActiveThreadId) {
      const settle = window.setTimeout(() => {
        setOptimisticActiveThreadId((current) =>
          current === optimisticActiveThreadId ? null : current,
        );
      }, 0);
      return () => window.clearTimeout(settle);
    }

    const timeout = window.setTimeout(() => {
      setOptimisticActiveThreadId((current) =>
        current === optimisticActiveThreadId ? null : current,
      );
    }, 1_500);
    return () => window.clearTimeout(timeout);
  }, [optimisticActiveThreadId, routeActiveSidebarThreadId]);

  const clearThreadNotification = useCallback(
    (threadId: ThreadId) => {
      const thread = sidebarThreadSummaryById[threadId];
      if (!thread) {
        return;
      }
      const threadStatus = resolveThreadStatusForSidebar(thread);
      if (!threadStatus?.dismissible) {
        return;
      }
      if (threadStatus.label === "Completed") {
        markThreadVisited(threadId, thread.latestTurn?.completedAt ?? undefined);
        return;
      }
      dismissThreadStatus(threadId, threadStatus.dismissalKey);
    },
    [
      dismissThreadStatus,
      markThreadVisited,
      resolveThreadStatusForSidebar,
      sidebarThreadSummaryById,
    ],
  );

  const routeTerminalState = routeThreadId
    ? selectThreadTerminalState(terminalStateByThreadId, routeThreadId)
    : null;

  const terminalOpen = routeTerminalState?.terminalOpen ?? false;

  const terminalWorkspaceOpen = shouldRenderTerminalWorkspace({
    presentationMode: routeTerminalState?.presentationMode ?? "drawer",
    terminalOpen,
  });

  const {
    pinnedThreadIds,
    pinnedThreadIdSet,
    toggleThreadPinned,
    setThreadSettledWithToast,
    settledOverrideByThreadId,
    deleteThread,
    confirmAndDeleteThread,
    archiveThread,
    archiveThreadWithUndo,
    confirmAndArchiveThread,
    archiveAllThreadsInProject,
    deleteProjectThreads,
  } = useSidebarThreadActions({
    activeSplitView,
    appSettings,
    clearTerminalState,
    handleNewChat,
    projectById,
    routeSplitViewId: routeSearch.splitViewId ?? null,
    routeThreadId,
    sidebarThreads,
    sidebarTreeThreads,
    sidebarThreadSummaryById,
    threadsHydrated,
  });

  const {
    projectRunsByProjectId,
    projectRunServerByProjectId,
    projectRunDialogProjectId,
    projectRunDialogProject,
    projectRunDialogExistingRun,
    projectRunDialogCommandDraft,
    setProjectRunDialogCommandDraft,
    projectRunDialogCommandIsValid,
    openProjectRunDialog,
    closeProjectRunDialog,
    handleConfirmProjectRun,
    handleStopProjectRun,
    handleOpenProjectRunServer,
  } = useSidebarProjectRunController({
    projects,
    projectById,
    homeDir,
    chatWorkspaceRoot,
  });

  useEffect(() => {
    if (!isRailLayout) return;
    reconcileRailShell({
      pathname,
      projectIds: threadsHydrated ? new Set(projects.map((project) => project.id)) : null,
    });
  }, [isRailLayout, pathname, projects, reconcileRailShell, threadsHydrated]);

  const ordinarySpaceProjects = useMemo(
    () =>
      projects.filter((project) => isOrdinarySpaceProject(project, { homeDir, chatWorkspaceRoot })),
    [chatWorkspaceRoot, homeDir, projects],
  );

  const activeRouteProjectId = routeThreadId
    ? (sidebarThreadSummaryById[routeThreadId]?.projectId ??
      draftThreadsByThreadId[routeThreadId]?.projectId ??
      null)
    : null;

  const activeRouteProject = activeRouteProjectId
    ? (projectById.get(activeRouteProjectId) ?? null)
    : null;

  const activeSpaceSidebarTreeThreads = useMemo(
    () =>
      sidebarTreeThreads.filter((thread) => {
        const project = projectById.get(thread.projectId);
        return isHomeChatContainerProject(project, { homeDir, chatWorkspaceRoot })
          ? (chatSpaceByThreadId[thread.id] ?? null) === activeSpaceId
          : !isOrdinarySpaceProject(project, { homeDir, chatWorkspaceRoot }) ||
              (project.spaceId ?? null) === activeSpaceId;
      }),
    [
      activeSpaceId,
      chatWorkspaceRoot,
      chatSpaceByThreadId,
      homeDir,
      sidebarTreeThreads,
      projectById,
    ],
  );

  const pinnedThreads = useMemo(
    () => getPinnedThreadsForSidebar(activeSpaceSidebarTreeThreads, pinnedThreadIds),
    [activeSpaceSidebarTreeThreads, pinnedThreadIds],
  );

  const openPrLink = useCallback((event: MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );

  const projectByIdRef = useRef(projectById);

  useEffect(() => {
    projectByIdRef.current = projectById;
  }, [projectById]);
  return {
    githubProvisioningAvailable,
    showDebugFeatureFlagsMenu,
    projects,
    spaces,
    chatSpaceByThreadId,
    activeSpaceId,
    threadsHydrated,
    isRailLayout,
    railActiveItem,
    railPanelView,
    railSpacesProjectId,
    selectRailPanelItem,
    selectRailRouteItem,
    openRailSpacesProject,
    closeRailSpacesProject,
    sidebarThreadSummaryById,
    syncServerShellSnapshot,
    markThreadVisited,
    markThreadUnread,
    toggleProject,
    setProjectExpanded,
    setAllProjectsExpanded,
    collapseProjectsExcept,
    reorderProjects,
    renameProjectLocally,
    setProjectAppearanceLocally,
    removeDeletedProjectFromClientState,
    terminalStateByThreadId,
    openChatThreadPage,
    openTerminalThreadPage,
    clearProjectDraftThreads,
    draftThreadsByThreadId,
    persistedPinnedProjectIds,
    pinProjectLocally,
    unpinProject,
    prunePinnedProjects,
    homeDir,
    chatWorkspaceRoot,
    navigate,
    queryClient,
    isOnSettings,
    isOnKanban,
    isOnAutomations,
    automationAttentionBadge,
    automationsByThreadId,
    appSettings,
    serverSettings,
    updateSettings,
    chatsSectionVisible,
    handleNewThread,
    handleNewChat,
    routeThreadId,
    routeProjectId,
    routeSearch,
    activeSettingsSection,
    activeSplitView,
    splitViewsById,
    setSplitFocusedPane,
    openRightDockPane,
    keybindings,
    serverCwd,
    providerStatuses,
    newThreadShortcutLabel,
    newChatShortcutLabel,
    searchShortcutLabel,
    activityShortcutLabel,
    importThreadShortcutLabel,
    addProjectShortcutLabel,
    usageSettingsShortcutLabel,
    focusedProjectId,
    latestProjectId,
    createProjectDialogOpen,
    setCreateProjectDialogOpen,
    createProjectSpaceId,
    setCreateProjectSpaceId,
    searchPaletteOpen,
    setSearchPaletteOpen,
    openFeedbackDialog,
    searchPaletteMode,
    setSearchPaletteMode,
    projectAdditionLockRef,
    renameDialogThreadId,
    setRenameDialogThreadId,
    editProjectDialog,
    setEditProjectDialog,
    relocateProjectDialogId,
    setRelocateProjectDialogId,
    projectContextMenuState,
    setProjectContextMenuState,
    threadListExtraPagesByProjectCwd,
    setThreadListExtraPagesByProjectCwd,
    chatSectionExpanded,
    setChatSectionExpanded,
    dismissedThreadStatusKeyByThreadId,
    setDismissedThreadStatusKeyByThreadId,
    lastThreadRoute,
    setLastThreadRoute,
    activityViewEnabled,
    activityVisibleThreadIds,
    handleActivityVisibleThreadIdsChange,
    setActivityViewEnabledSmoothly,
    setOptimisticActiveThreadId,
    lastThreadRenameTapRef,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    optimisticPinnedStateByProjectIdRef,
    latestPinnedMutationVersionByProjectIdRef,
    desktopUpdateState,
    setDesktopUpdateState,
    installingDesktopUpdate,
    setInstallingDesktopUpdate,
    optimisticPinnedStateByProjectId,
    setOptimisticPinnedStateByProjectId,
    lastDesktopUpdateErrorToastSignatureRef,
    selectedThreadIds,
    toggleThreadSelection,
    rangeSelectTo,
    clearSelection,
    removeFromSelection,
    setSelectionAnchor,
    activeSidebarThreadId,
    visualActiveSidebarThreadId,
    hideAutomationRunThreads,
    sidebarThreads,
    sidebarTreeThreads,
    projectLastActivityAt,
    projectById,
    visibleSidebarActivityThreads,
    hasUnreadActivity,
    clearDismissedThreadStatus,
    resolveThreadStatusForSidebar,
    clearThreadNotification,
    terminalOpen,
    terminalWorkspaceOpen,
    pinnedThreadIds,
    pinnedThreadIdSet,
    toggleThreadPinned,
    setThreadSettledWithToast,
    settledOverrideByThreadId,
    deleteThread,
    confirmAndDeleteThread,
    archiveThread,
    archiveThreadWithUndo,
    confirmAndArchiveThread,
    archiveAllThreadsInProject,
    deleteProjectThreads,
    projectRunsByProjectId,
    projectRunServerByProjectId,
    projectRunDialogProjectId,
    projectRunDialogProject,
    projectRunDialogExistingRun,
    projectRunDialogCommandDraft,
    setProjectRunDialogCommandDraft,
    projectRunDialogCommandIsValid,
    openProjectRunDialog,
    closeProjectRunDialog,
    handleConfirmProjectRun,
    handleStopProjectRun,
    handleOpenProjectRunServer,
    ordinarySpaceProjects,
    activeRouteProjectId,
    activeRouteProject,
    pinnedThreads,
    openPrLink,
    projectCwdById,
    projectByIdRef,
  };
}
