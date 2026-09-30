import { useSidebarDesktopUpdate } from "./useSidebarDesktopUpdate";
import { useStore } from "../store";
import { useSidebarStateStore } from "../sidebarStateStore";
import { AddPlusIcon } from "~/lib/icons";
import { useCallback, useEffect, useMemo } from "react";
import { ProjectId, SpaceId } from "@glade/contracts/core/baseSchemas";
import { isOrdinarySpaceProject } from "../lib/spaces";
import {
  resolveShortcutCommand,
  shouldShowThreadJumpHints,
  spaceJumpIndexFromCommand,
  threadJumpIndexFromCommand,
} from "../keybindings";
import { isModelPickerShortcutScopeActive } from "./chat/ComposerModelPicker.logic";
import { normalizeSidebarProjectThreadListCwd } from "./Sidebar.uiState";
import { getNextVisibleSidebarThreadId } from "./Sidebar.logic.preview";
import {
  isProjectsSidebarSurface,
  shouldClearThreadSelectionOnMouseDown,
} from "./Sidebar.logic.statusTypes";
import { type SidebarSearchAction, type SidebarSearchProject } from "./SidebarSearchPalette.logic";
import { SpaceIcon } from "./SpaceIcon";
import { spaceDisplayName } from "../lib/spaceGrouping";
import type { useSidebarDerivedLists } from "./useSidebarDerivedLists";
import {
  EMPTY_THREAD_JUMP_LABELS,
  threadJumpLabelMapsEqual,
  buildThreadJumpLabelMap,
} from "./sidebarSupport";

export function useSidebarPanelEffects(context: ReturnType<typeof useSidebarDerivedLists>) {
  const {
    projects,
    spaces,
    activeSpaceId,
    homeDir,
    chatWorkspaceRoot,
    navigate,
    isOnSettings,
    keybindings,
    newThreadShortcutLabel,
    newChatShortcutLabel,
    importThreadShortcutLabel,
    addProjectShortcutLabel,
    usageSettingsShortcutLabel,
    setCreateProjectDialogOpen,
    setSearchPaletteOpen,
    searchPaletteMode,
    setSearchPaletteMode,
    setActivityViewEnabledSmoothly,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    activeSidebarThreadId,
    projectById,
    handleBackToThreads,
    handleStartAddProject,
    activateThreadFromSidebarIntent,
    voidSpace,
    openSpaceCreator,
    handleSelectSpace,
    visibleSidebarThreadIds,
    threadJumpCommandByThreadId,
    threadJumpThreadIds,
    getCurrentSidebarShortcutContext,
    setThreadJumpLabelByThreadId,
    threadJumpLabelsRef,
    setShowThreadJumpHints,
    showThreadJumpHintsRef,
  } = context;
  const toggleProject = useStore((state) => state.toggleProject);

  const selectedThreadIds = useSidebarStateStore((state) => state.selectedThreadIds);
  const clearSelection = useSidebarStateStore((state) => state.clearSelection);

  const setThreadListExtraPagesByProjectCwd = useSidebarStateStore(
    (state) => state.setThreadListExtraPagesByProjectCwd,
  );
  const activityViewEnabled = useSidebarStateStore((state) => state.activityViewEnabled);

  const resetProjectThreadPagingOnClose = useCallback(
    (projectId: ProjectId) => {
      const project = projectById.get(projectId);
      if (!project?.expanded) return;
      const cwdKey = normalizeSidebarProjectThreadListCwd(project.cwd);
      setThreadListExtraPagesByProjectCwd((current) => {
        if (!current.has(cwdKey)) return current;
        const next = new Map(current);
        next.delete(cwdKey);
        return next;
      });
    },
    [projectById, setThreadListExtraPagesByProjectCwd],
  );

  const handleProjectTitleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, projectId: ProjectId) => {
      if (dragInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (suppressProjectClickAfterDragRef.current) {
        suppressProjectClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (selectedThreadIds.size > 0) {
        clearSelection();
      }
      resetProjectThreadPagingOnClose(projectId);
      toggleProject(projectId);
    },
    [
      clearSelection,
      resetProjectThreadPagingOnClose,
      selectedThreadIds.size,
      toggleProject,
      suppressProjectClickAfterDragRef,
      dragInProgressRef,
    ],
  );

  const handleProjectTitleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, projectId: ProjectId) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (dragInProgressRef.current) {
        return;
      }
      resetProjectThreadPagingOnClose(projectId);
      toggleProject(projectId);
    },
    [resetProjectThreadPagingOnClose, toggleProject, dragInProgressRef],
  );

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (selectedThreadIds.size === 0) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearThreadSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [clearSelection, selectedThreadIds.size]);

  useEffect(() => {
    const clearThreadJumpHints = () => {
      setThreadJumpLabelByThreadId((current) =>
        current === EMPTY_THREAD_JUMP_LABELS ? current : EMPTY_THREAD_JUMP_LABELS,
      );
      setShowThreadJumpHints(false);
    };
    const shouldIgnoreThreadJumpHintUpdate = (event: KeyboardEvent) =>
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key !== "Meta" &&
      event.key !== "Control" &&
      event.key !== "Alt" &&
      event.key !== "Shift" &&
      !showThreadJumpHintsRef.current &&
      threadJumpLabelsRef.current === EMPTY_THREAD_JUMP_LABELS;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const shortcutContext = getCurrentSidebarShortcutContext();
      if (!shouldIgnoreThreadJumpHintUpdate(event)) {
        const shouldShowHints = shouldShowThreadJumpHints(event, keybindings, {
          platform: navigator.platform,
          context: shortcutContext,
        });
        if (!shouldShowHints) {
          if (
            showThreadJumpHintsRef.current ||
            threadJumpLabelsRef.current !== EMPTY_THREAD_JUMP_LABELS
          ) {
            clearThreadJumpHints();
          }
        } else {
          setThreadJumpLabelByThreadId((current) => {
            const nextLabelMap = buildThreadJumpLabelMap({
              keybindings,
              platform: navigator.platform,
              terminalOpen: shortcutContext.terminalOpen,
              threadJumpCommandByThreadId,
            });
            return threadJumpLabelMapsEqual(current, nextLabelMap) ? current : nextLabelMap;
          });
          setShowThreadJumpHints(true);
        }
      }

      const command = resolveShortcutCommand(event, keybindings, {
        context: shortcutContext,
      });
      if (command === "sidebar.search") {
        event.preventDefault();
        event.stopPropagation();
        setSearchPaletteMode("search");
        setSearchPaletteOpen((prev) => !prev || searchPaletteMode !== "search");
        return;
      }
      if (command === "sidebar.activity") {
        event.preventDefault();
        event.stopPropagation();
        const shouldOpenActivity = isOnSettings || !activityViewEnabled;
        setActivityViewEnabledSmoothly(shouldOpenActivity);
        if (shouldOpenActivity && isOnSettings) {
          handleBackToThreads();
        }
        return;
      }
      if (command === "sidebar.addProject") {
        event.preventDefault();
        event.stopPropagation();
        setCreateProjectDialogOpen(true);
        return;
      }
      if (command === "sidebar.importThread") {
        event.preventDefault();
        event.stopPropagation();
        setSearchPaletteMode("import");
        setSearchPaletteOpen((prev) => !prev || searchPaletteMode !== "import");
        return;
      }
      if (command === "settings.usage") {
        event.preventDefault();
        event.stopPropagation();
        void navigate({
          to: "/settings",
          search: { section: "usage" },
        });
        return;
      }
      if (command === "space.previous" || command === "space.next") {
        if (!isProjectsSidebarSurface({ isOnSettings })) return;
        event.preventDefault();
        event.stopPropagation();
        const orderedSpaceIds: ReadonlyArray<SpaceId | null> = [
          null,
          ...spaces.map((space) => space.id),
        ];
        const currentIndex = Math.max(0, orderedSpaceIds.indexOf(activeSpaceId));
        const offset = command === "space.previous" ? -1 : 1;
        const nextIndex = (currentIndex + offset + orderedSpaceIds.length) % orderedSpaceIds.length;
        handleSelectSpace(orderedSpaceIds[nextIndex] ?? null);
        return;
      }
      const spaceJumpIndex = spaceJumpIndexFromCommand(command ?? "");
      if (spaceJumpIndex !== null) {
        if (!isProjectsSidebarSurface({ isOnSettings })) return;

        const orderedSpaceIds: ReadonlyArray<SpaceId | null> = [
          null,
          ...spaces.map((space) => space.id),
        ];
        if (spaceJumpIndex >= orderedSpaceIds.length) return;
        event.preventDefault();
        event.stopPropagation();
        const targetSpaceId = orderedSpaceIds[spaceJumpIndex] ?? null;
        if (targetSpaceId !== activeSpaceId) {
          handleSelectSpace(targetSpaceId);
        }
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex !== null) {
        if (isModelPickerShortcutScopeActive()) return;
        event.preventDefault();
        event.stopPropagation();
        const threadJumpTargetId = threadJumpThreadIds[jumpIndex];
        if (threadJumpTargetId) {
          activateThreadFromSidebarIntent(threadJumpTargetId);
        }
        return;
      }
      if (command !== "chat.visible.next" && command !== "chat.visible.previous") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const nextThreadId = getNextVisibleSidebarThreadId({
        visibleThreadIds: visibleSidebarThreadIds,
        activeThreadId: activeSidebarThreadId ?? undefined,
        direction: command === "chat.visible.previous" ? "backward" : "forward",
      });
      if (nextThreadId && nextThreadId !== activeSidebarThreadId) {
        activateThreadFromSidebarIntent(nextThreadId);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (shouldIgnoreThreadJumpHintUpdate(event)) {
        return;
      }
      const shortcutContext = getCurrentSidebarShortcutContext();
      const shouldShowHints = shouldShowThreadJumpHints(event, keybindings, {
        platform: navigator.platform,
        context: shortcutContext,
      });
      if (!shouldShowHints) {
        clearThreadJumpHints();
        return;
      }
      setThreadJumpLabelByThreadId((current) => {
        const nextLabelMap = buildThreadJumpLabelMap({
          keybindings,
          platform: navigator.platform,
          terminalOpen: shortcutContext.terminalOpen,
          threadJumpCommandByThreadId,
        });
        return threadJumpLabelMapsEqual(current, nextLabelMap) ? current : nextLabelMap;
      });
      setShowThreadJumpHints(true);
    };
    const onWindowBlur = () => {
      clearThreadJumpHints();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [
    activateThreadFromSidebarIntent,
    activeSidebarThreadId,
    activeSpaceId,
    activityViewEnabled,
    handleSelectSpace,
    handleBackToThreads,
    keybindings,
    getCurrentSidebarShortcutContext,
    homeDir,
    isOnSettings,
    navigate,
    searchPaletteMode,
    setActivityViewEnabledSmoothly,
    spaces,
    threadJumpCommandByThreadId,
    threadJumpThreadIds,
    visibleSidebarThreadIds,
    setThreadJumpLabelByThreadId,
    showThreadJumpHintsRef,
    setSearchPaletteOpen,
    threadJumpLabelsRef,
    setShowThreadJumpHints,
    setCreateProjectDialogOpen,
    setSearchPaletteMode,
  ]);

  const desktopUpdate = useSidebarDesktopUpdate();

  const searchPaletteProjects = useMemo<SidebarSearchProject[]>(
    () =>
      projects
        .filter((project) => isOrdinarySpaceProject(project, { homeDir, chatWorkspaceRoot }))
        .map((project) => ({
          id: project.id,
          name: project.name,
          remoteName: project.remoteName,
          folderName: project.folderName,
          localName: project.localName,
          appearance: project.appearance ?? null,
          cwd: project.cwd,
          spaceName: spaceDisplayName(project.spaceId, spaces, voidSpace),
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        })),
    [chatWorkspaceRoot, homeDir, projects, spaces, voidSpace],
  );

  const searchPaletteActions = useMemo<SidebarSearchAction[]>(
    () => [
      {
        id: "new-chat",
        label: "New chat",
        description: "Open the new chat landing screen.",
        keywords: ["chat", "new", "home"],
        shortcutLabel: newChatShortcutLabel,
      },
      {
        id: "new-thread",
        label: "New thread",
        description: "Start a fresh thread in the current or most recently used project.",
        keywords: ["thread", "new", "project"],
        shortcutLabel: newThreadShortcutLabel,
      },
      {
        id: "add-project",
        label: "Add project",
        description: "Open a repository or folder in the sidebar.",
        keywords: ["folder", "repo", "repository", "open"],
        shortcutLabel: addProjectShortcutLabel,
        run: handleStartAddProject,
      },
      {
        id: "import-projects",
        label: "Import projects from…",
        description: "Bring Codex and Claude Code projects and conversations into Glade.",
        keywords: ["import", "projects", "codex", "claude", "conversations", "folders"],
      },
      {
        id: "import-thread",
        label: "Import thread from...",
        description: "Attach a local thread to an existing provider session.",
        keywords: ["import", "resume", "thread", "session", "codex", "claude"],
        shortcutLabel: importThreadShortcutLabel,
      },
      {
        id: "feedback",
        label: "Feedback Glade",
        description: "Send feedback or report an issue to the Glade team.",
        keywords: ["feedback", "bug", "issue", "problem", "report", "support", "glade"],
      },
      {
        id: "settings",
        label: "Settings",
        description: "Open app settings.",
        keywords: ["preferences", "config"],
      },
      {
        id: "usage-settings",
        label: "Usage settings",
        description: "Open provider usage and remaining credits.",
        keywords: ["usage", "limits", "credits", "quota", "providers"],
        shortcutLabel: usageSettingsShortcutLabel,
      },

      ...(spaces.length > 0
        ? [
            {
              id: "switch-space-void",
              label: `Switch to ${voidSpace.name}`,
              description: "Jump to unassigned projects.",

              keywords: ["space", "switch", "void", "unassigned", voidSpace.name],
              requiresQuery: true,
              run: () => handleSelectSpace(null),
              icon: ({ className }: { className?: string }) => (
                <SpaceIcon icon={voidSpace.icon} className={className} />
              ),
            } satisfies SidebarSearchAction,
          ]
        : []),
      ...spaces.map(
        (space) =>
          ({
            id: `switch-space-${space.id}`,
            label: `Switch to ${space.name}`,
            description: "Jump to this space and restore its last context.",
            keywords: ["space", "switch", space.name],
            requiresQuery: true,
            run: () => handleSelectSpace(space.id),
            icon: ({ className }: { className?: string }) => (
              <SpaceIcon icon={space.icon} className={className} />
            ),
          }) satisfies SidebarSearchAction,
      ),
      {
        id: "new-space",
        label: "New space",
        description: "Group projects into a focused work context.",
        keywords: ["space", "create", "new", "group", "workspace"],
        run: () => openSpaceCreator(),
        icon: AddPlusIcon,
      },
    ],
    [
      addProjectShortcutLabel,
      handleSelectSpace,
      handleStartAddProject,
      importThreadShortcutLabel,
      newChatShortcutLabel,
      newThreadShortcutLabel,
      openSpaceCreator,
      spaces,
      usageSettingsShortcutLabel,
      voidSpace,
    ],
  );

  const setThreadListExtraPagesForProject = useCallback(
    (projectCwd: string, nextExtraPages: number) => {
      const cwdKey = normalizeSidebarProjectThreadListCwd(projectCwd);
      if (cwdKey.length === 0) return;
      setThreadListExtraPagesByProjectCwd((current) => {
        const clampedExtraPages = Math.max(0, nextExtraPages);
        if ((current.get(cwdKey) ?? 0) === clampedExtraPages) return current;
        const next = new Map(current);
        if (clampedExtraPages === 0) {
          next.delete(cwdKey);
        } else {
          next.set(cwdKey, clampedExtraPages);
        }
        return next;
      });
    },
    [setThreadListExtraPagesByProjectCwd],
  );

  const showMoreThreadsForProject = useCallback(
    (projectCwd: string, currentExtraPages: number) => {
      setThreadListExtraPagesForProject(projectCwd, currentExtraPages + 1);
    },
    [setThreadListExtraPagesForProject],
  );
  return {
    ...context,
    desktopUpdate,
    handleProjectTitleClick,
    handleProjectTitleKeyDown,
    searchPaletteProjects,
    searchPaletteActions,
    showMoreThreadsForProject,
  };
}
