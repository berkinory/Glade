import {
  useEffect,
  startTransition,
  useMemo,
  useRef,
  useSyncExternalStore,
  useState,
  type MouseEvent,
} from "react";
import { ProjectId, SpaceId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useAppSettings } from "../appSettings";
import { isMacNavigatorPlatform } from "../lib/utils";
import { isOrdinarySpaceProject } from "../lib/spaces";
import { useStore } from "../store";
import { shortcutLabelForCommand } from "../keybindings";
import {
  createProjectLastActivityAtSelector,
  createSidebarThreadSummariesSelector,
  createSidebarTreeThreadsSelector,
} from "../storeSelectors";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { isHomeChatContainerProject } from "../lib/chatProjects";
import { useComposerDraftStore } from "../composerDraftStore";
import { useProjectPreferencesStore } from "../projectPreferencesStore";
import { type SidebarThreadSummary } from "../types";
import { shouldRenderTerminalWorkspace } from "./ChatView.logic.subagents";
import { hasUnreadActivity as hasUnreadActivityOutsideActiveThread } from "./SidebarActivityView.logic";
import { type SidebarSearchPaletteMode } from "./SidebarSearchPalette";
import { useHandleNewChat } from "../hooks/useHandleNewChat";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useProviderStatusesForLocalConfig } from "../hooks/useProviderStatusesForLocalConfig";
import { useFeedbackDialogStore } from "../feedbackDialogStore";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { toastManager } from "./ui/toast";
import { useSidebarStateStore } from "../sidebarStateStore";
import { getPinnedItems } from "../pinning.logic";
import {
  DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY,
  shouldShowDebugFeatureFlagsMenu,
} from "./Sidebar.logic.statusTypes";
import { resolveThreadStatusPill } from "./Sidebar.logic.status";
import { useDiffRouteSearch } from "../hooks/useDiffRouteSearch";
import { normalizeSettingsSection } from "../settingsNavigation";
import { selectSplitView, useSplitViewStore } from "../splitViewStore";
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

  const sidebarThreadSummaryById = useStore((store) => store.sidebarThreadSummaryById);

  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);

  const removeDeletedProjectFromClientState = useStore(
    (store) => store.removeDeletedProjectFromClientState,
  );

  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);

  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);

  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);

  const homeDir = useWorkspacePathsStore((store) => store.homeDir);

  const chatWorkspaceRoot = useWorkspacePathsStore((store) => store.chatWorkspaceRoot);

  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const isOnSettings = useLocation({
    select: (loc) => loc.pathname === "/settings",
  });

  const { settings: appSettings, serverSettings, updateSettings } = useAppSettings();

  const { handleNewThread } = useHandleNewThread();

  const { handleNewChat } = useHandleNewChat();

  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });

  const routeSearch = useDiffRouteSearch();

  const settingsSectionSearch = useSearch({ strict: false }) as Record<string, unknown>;

  const activeSettingsSection = normalizeSettingsSection(settingsSectionSearch.section);

  const activeSplitView = useSplitViewStore(
    useMemo(() => selectSplitView(routeSearch.splitViewId ?? null), [routeSearch.splitViewId]),
  );

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

  const latestProjectId = useProjectPreferencesStore((state) => state.latestProjectId);

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

  const dismissedThreadStatusKeyByThreadId = useSidebarStateStore(
    (state) => state.dismissedThreadStatusKeyByThreadId,
  );
  const setDismissedThreadStatusKeyByThreadId = useSidebarStateStore(
    (state) => state.setDismissedThreadStatusKeyByThreadId,
  );
  const setActivityViewEnabled = useSidebarStateStore((state) => state.setActivityViewEnabled);

  const [activityVisibleThreadIds, setActivityVisibleThreadIds] = useState<readonly ThreadId[]>([]);

  const handleActivityVisibleThreadIdsChange = (threadIds: readonly ThreadId[]) => {
    setActivityVisibleThreadIds((current) => {
      if (
        current.length === threadIds.length &&
        current.every((threadId, index) => threadId === threadIds[index])
      ) {
        return current;
      }
      return [...threadIds];
    });
  };

  const setActivityViewEnabledSmoothly = (enabled: boolean) => {
    startTransition(() => {
      setActivityViewEnabled(enabled);
    });
  };

  const [optimisticActiveThreadId, setOptimisticActiveThreadId] = useState<ThreadId | null>(null);

  const lastThreadRenameTapRef = useRef<{
    threadId: ThreadId;
    timestamp: number;
  } | null>(null);

  const dragInProgressRef = useRef(false);

  const suppressProjectClickAfterDragRef = useRef(false);

  const optimisticPinnedStateByProjectIdRef = useRef(new Map<ProjectId, boolean>());

  const latestPinnedMutationVersionByProjectIdRef = useRef(new Map<ProjectId, number>());

  const [optimisticPinnedStateByProjectId, setOptimisticPinnedStateByProjectId] = useState<
    ReadonlyMap<ProjectId, boolean>
  >(() => new Map());

  const routeActiveSidebarThreadId = routeThreadId;

  const activeSidebarThreadId = optimisticActiveThreadId ?? routeActiveSidebarThreadId;

  const visualActiveSidebarThreadId = optimisticActiveThreadId ?? routeThreadId;

  const selectSidebarThreads = useMemo(() => createSidebarThreadSummariesSelector(), []);

  const selectSidebarTreeThreads = useMemo(() => createSidebarTreeThreadsSelector(), []);

  const sidebarThreads = useStore(selectSidebarThreads);

  const sidebarTreeThreads = useStore(selectSidebarTreeThreads);

  const selectProjectLastActivityAt = useMemo(() => createProjectLastActivityAtSelector(), []);

  const projectLastActivityAt = useStore(selectProjectLastActivityAt);

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );

  const visibleSidebarActivityThreads = sidebarThreads.filter((thread) => {
    const project = projectById.get(thread.projectId);
    return (
      !isHomeChatContainerProject(project, { homeDir, chatWorkspaceRoot }) ||
      (chatSpaceByThreadId[thread.id] ?? null) === activeSpaceId
    );
  });

  const hasUnreadActivity = hasUnreadActivityOutsideActiveThread(
    visibleSidebarActivityThreads,
    activeSidebarThreadId,
  );

  const dismissThreadStatus = (threadId: ThreadId, statusKey: string | null | undefined) => {
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
  };

  const clearDismissedThreadStatus = (threadId: ThreadId) => {
    setDismissedThreadStatusKeyByThreadId((current) => {
      if (!(threadId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  };

  const resolveThreadStatusForSidebar = (thread: SidebarThreadSummary) =>
    resolveThreadStatusPill({
      thread: {
        ...thread,
        dismissedStatusKey: dismissedThreadStatusKeyByThreadId[thread.id],
      },
      hasPendingApprovals: thread.hasPendingApprovals,
      hasPendingUserInput: thread.hasPendingUserInput,
    });

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

  const clearThreadNotification = (threadId: ThreadId) => {
    const thread = sidebarThreadSummaryById[threadId];
    if (!thread) {
      return;
    }
    const threadStatus = resolveThreadStatusForSidebar(thread);
    if (!threadStatus?.dismissible) {
      return;
    }
    if (threadStatus.label === "Completed") {
      useStore.getState().markThreadVisited(threadId, thread.latestTurn?.completedAt ?? undefined);
      return;
    }
    dismissThreadStatus(threadId, threadStatus.dismissalKey);
  };

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

  const ordinarySpaceProjects = projects.filter((project) =>
    isOrdinarySpaceProject(project, { homeDir, chatWorkspaceRoot }),
  );

  const activeRouteProjectId = routeThreadId
    ? (sidebarThreadSummaryById[routeThreadId]?.projectId ??
      draftThreadsByThreadId[routeThreadId]?.projectId ??
      null)
    : null;

  const activeRouteProject = activeRouteProjectId
    ? (projectById.get(activeRouteProjectId) ?? null)
    : null;

  const activeSpaceSidebarTreeThreads = sidebarTreeThreads.filter((thread) => {
    const project = projectById.get(thread.projectId);
    return isHomeChatContainerProject(project, { homeDir, chatWorkspaceRoot })
      ? (chatSpaceByThreadId[thread.id] ?? null) === activeSpaceId
      : !isOrdinarySpaceProject(project, { homeDir, chatWorkspaceRoot }) ||
          (project.spaceId ?? null) === activeSpaceId;
  });

  const pinnedThreads = getPinnedItems(activeSpaceSidebarTreeThreads, pinnedThreadIds);

  const openPrLink = (event: MouseEvent<HTMLElement>, prUrl: string) => {
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
  };

  const projectCwdById = new Map(projects.map((project) => [project.id, project.cwd] as const));

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
    syncServerShellSnapshot,
    removeDeletedProjectFromClientState,
    homeDir,
    chatWorkspaceRoot,
    navigate,
    queryClient,
    isOnSettings,
    appSettings,
    serverSettings,
    updateSettings,
    handleNewThread,
    handleNewChat,
    routeThreadId,
    routeSearch,
    activeSettingsSection,
    activeSplitView,
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
    activityVisibleThreadIds,
    handleActivityVisibleThreadIdsChange,
    setActivityViewEnabledSmoothly,
    setOptimisticActiveThreadId,
    lastThreadRenameTapRef,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    optimisticPinnedStateByProjectIdRef,
    latestPinnedMutationVersionByProjectIdRef,
    optimisticPinnedStateByProjectId,
    setOptimisticPinnedStateByProjectId,
    activeSidebarThreadId,
    visualActiveSidebarThreadId,
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
