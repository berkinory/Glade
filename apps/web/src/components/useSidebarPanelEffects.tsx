import { PlusIcon } from "~/lib/icons";
import { isShortcutComposition } from "@glade/shared/settings/shortcutEvent";
import { hasOpenKeyboardOverlay } from "~/lib/keyboardOverlay";
import { useSidebarDesktopUpdate } from "./useSidebarDesktopUpdate";
import { useStore } from "../store";
import { useProjectSpaceIdOf } from "../spacesUiStore";
import { useSidebarStateStore } from "../sidebarStateStore";
import { useEffect } from "react";
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
    routeThreadId,
    confirmAndArchiveThread,
    markThreadUnread,
    newThreadShortcutLabel,
    newChatShortcutLabel,
    addProjectShortcutLabel,
    setCreateProjectDialogOpen,
    setSearchPaletteOpen,
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
  const projectSpaceIdOf = useProjectSpaceIdOf();
  const selectedThreadIds = useSidebarStateStore((state) => state.selectedThreadIds);
  const clearSelection = useSidebarStateStore((state) => state.clearSelection);
  const setThreadListExtraPagesByProjectCwd = useSidebarStateStore(
    (state) => state.setThreadListExtraPagesByProjectCwd,
  );
  const activityViewEnabled = useSidebarStateStore((state) => state.activityViewEnabled);
  const resetProjectThreadPagingOnClose = (projectId: ProjectId) => {
    const project = projectById.get(projectId);
    if (!project?.expanded) return;
    const cwdKey = normalizeSidebarProjectThreadListCwd(project.cwd);
    setThreadListExtraPagesByProjectCwd((current) => {
      if (!current.has(cwdKey)) return current;
      const next = new Map(current);
      next.delete(cwdKey);
      return next;
    });
  };
  const handleProjectTitleClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    projectId: ProjectId,
  ) => {
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
  };
  const handleProjectTitleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    projectId: ProjectId,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (dragInProgressRef.current) {
      return;
    }
    resetProjectThreadPagingOnClose(projectId);
    toggleProject(projectId);
  };
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
      if (
        event.defaultPrevented ||
        isShortcutComposition(event) ||
        document.activeElement?.hasAttribute("data-keybinding-capture")
      )
        return;
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
        setSearchPaletteOpen((prev) => !prev);
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
      if (command === "settings.usage") {
        event.preventDefault();
        event.stopPropagation();
        void navigate({
          to: "/settings",
          search: {
            section: "usage",
          },
        });
        return;
      }
      if (command === "thread.archive" || command === "thread.markUnread") {
        const thread =
          isOnSettings || !routeThreadId
            ? undefined
            : useStore.getState().sidebarThreadSummaryById[routeThreadId];
        if (!thread || thread.archivedAt != null || hasOpenKeyboardOverlay()) return;
        // Subagent chats follow their parent's archive, as in the thread menu.
        if (command === "thread.archive" && thread.parentThreadId) return;
        event.preventDefault();
        event.stopPropagation();
        if (command === "thread.archive") void confirmAndArchiveThread(thread.id);
        else markThreadUnread(thread.id);
        return;
      }
      if (command === "space.previous" || command === "space.next") {
        if (
          !isProjectsSidebarSurface({
            isOnSettings,
          })
        )
          return;
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
        if (
          !isProjectsSidebarSurface({
            isOnSettings,
          })
        )
          return;
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
    window.addEventListener("keydown", onKeyDown, {
      capture: true,
    });
    window.addEventListener("keyup", onKeyUp, {
      capture: true,
    });
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, {
        capture: true,
      });
      window.removeEventListener("keyup", onKeyUp, {
        capture: true,
      });
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
    routeThreadId,
    confirmAndArchiveThread,
    markThreadUnread,
  ]);
  const desktopUpdate = useSidebarDesktopUpdate();
  const searchPaletteProjects: SidebarSearchProject[] = projects
    .filter((project) =>
      isOrdinarySpaceProject(project, {
        homeDir,
        chatWorkspaceRoot,
      }),
    )
    .map((project) => ({
      id: project.id,
      name: project.name,
      remoteName: project.remoteName,
      folderName: project.folderName,
      localName: project.localName,
      appearance: project.appearance ?? null,
      cwd: project.cwd,
      spaceName: spaceDisplayName(projectSpaceIdOf(project), spaces, voidSpace),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
  const searchPaletteActions: SidebarSearchAction[] = [
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
      icon: PlusIcon,
    },
  ];
  const setThreadListExtraPagesForProject = (projectCwd: string, nextExtraPages: number) => {
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
  };
  const showMoreThreadsForProject = (projectCwd: string, currentExtraPages: number) => {
    setThreadListExtraPagesForProject(projectCwd, currentExtraPages + 1);
  };
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
