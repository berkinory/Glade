import { useCallback, useMemo } from "react";
import { SIDEBAR_NAV_ITEM_IDS } from "../sidebarNavOrdering";
import {
  RAIL_PANEL_ITEM_IDS,
  RAIL_PANEL_ITEM_LABELS,
  railProjectShortcutKey,
  railSpaceShortcutKey,
  resolveActiveRailShortcutKey,
  toggleRailShortcutKey,
} from "../appRail.logic";
import { isMacNavigatorPlatform } from "../lib/utils";
import { SidebarLeadingControls } from "./SidebarHeaderNavigationControls";
import { railCentralGlyphs, railItemGlyphs, railProjectGlyphs, type AppRailItem } from "./AppRail";
import { AppRailMoreMenu } from "./AppRailMoreMenu";
import { normalizeSidebarProjectThreadListCwd } from "./Sidebar.uiState";
import { SidebarTrigger } from "./ui/sidebar";
import { resolveSidebarProjectRowLabel } from "./Sidebar.logic.statusTypes";
import { createClientPointMenuAnchor } from "~/lib/clientPointMenuAnchor";
import { firstLocalServerUrl } from "../hooks/useSidebarProjectRunController";
import { spaceDisplayIcon, spaceDisplayName } from "../lib/spaceGrouping";
import type { useSidebarRows } from "./useSidebarRows";

export function useSidebarPresentation(context: ReturnType<typeof useSidebarRows>) {
  const {
    spaces,
    activeSpaceId,
    isRailLayout,
    railActiveItem,
    railPanelView,
    railSpacesProjectId,
    selectRailPanelItem,
    selectRailRouteItem,
    openRailSpacesProject,
    setAllProjectsExpanded,
    collapseProjectsExcept,
    navigate,
    isOnSettings,
    isOnKanban,
    isOnAutomations,
    appSettings,
    updateSettings,
    focusedProjectId,
    openFeedbackDialog,
    editProjectDialog,
    relocateProjectDialogId,
    projectContextMenuState,
    setThreadListExtraPagesByProjectCwd,
    activityViewEnabled,
    setActivityViewEnabledSmoothly,
    sidebarThreads,
    projectById,
    projectRunsByProjectId,
    projectRunServerByProjectId,
    handleBackToThreads,
    voidSpace,
    handleSelectSpace,
    sidebarNavDescriptors,
    railRouteItemIds,
    allStandardProjectsBase,
    pinnedProjectIdSet,
    standardProjects,
    allProjectsExpanded,
    railShortcuts,
    railSpacesProject,
  } = context;
  const handleToggleProjects = useCallback(() => {
    if (allProjectsExpanded) {
      const closingCwds = new Set(
        standardProjects
          .filter((project) => project.id !== focusedProjectId)
          .map((project) => normalizeSidebarProjectThreadListCwd(project.cwd)),
      );
      setThreadListExtraPagesByProjectCwd((current) => {
        const next = new Map([...current].filter(([cwd]) => !closingCwds.has(cwd)));
        return next.size === current.size ? current : next;
      });
      collapseProjectsExcept(focusedProjectId);
      return;
    }
    setAllProjectsExpanded(true);
  }, [
    allProjectsExpanded,
    collapseProjectsExcept,
    focusedProjectId,
    setAllProjectsExpanded,
    standardProjects,
    setThreadListExtraPagesByProjectCwd,
  ]);

  const isMacDesktop = isMacNavigatorPlatform();

  const titlebarControls = <SidebarLeadingControls className="hidden md:flex" />;

  const headerControls = <SidebarLeadingControls className="ml-auto hidden md:flex" />;

  const wordmark = (
    <div className="flex w-full items-center gap-1.5">
      <SidebarTrigger className="shrink-0 text-muted-foreground/75 hover:text-foreground md:hidden" />
      {headerControls}
    </div>
  );

  const isOnThreadsSection = !isOnSettings && !isOnKanban && !isOnAutomations;

  const sidebarHelpMenuProps = {
    onOpenShortcuts: () => void navigate({ to: "/settings", search: { section: "shortcuts" } }),
    onOpenFeedback: openFeedbackDialog,
  };

  const activeRailShortcutKey = resolveActiveRailShortcutKey({
    activeItem: railActiveItem,
    activeSpaceId,
    spacesProjectId: railSpacesProjectId,
    shortcuts: railShortcuts,
  });

  const railItems: AppRailItem[] = [
    ...RAIL_PANEL_ITEM_IDS.map(
      (id): AppRailItem => ({
        id,
        glyphs: railItemGlyphs(id),
        label: RAIL_PANEL_ITEM_LABELS[id],
        badge: null,
        active: railActiveItem === id && activeRailShortcutKey === null,
        onSelect: () => {
          setActivityViewEnabledSmoothly(false);
          selectRailPanelItem(id);

          if (!isOnThreadsSection) handleBackToThreads();
        },
      }),
    ),
    ...railRouteItemIds.map((id): AppRailItem => {
      const item = sidebarNavDescriptors[id];
      return {
        id,
        glyphs: railItemGlyphs(id),
        label: item.label,
        badge: item.badge,
        active: railActiveItem === id,
        onSelect: () => {
          selectRailRouteItem(id);
          item.onClick();
        },
        onMouseEnter: item.onMouseEnter,
        onFocus: item.onFocus,
      };
    }),
  ];

  const railShortcutItems: AppRailItem[] = railShortcuts.flatMap((shortcut): AppRailItem[] => {
    if (shortcut.kind === "space") {
      return [
        {
          id: shortcut.key,
          glyphs: railCentralGlyphs(spaceDisplayIcon(shortcut.spaceId, spaces, voidSpace)),
          label: spaceDisplayName(shortcut.spaceId, spaces, voidSpace),
          badge: null,
          active: activeRailShortcutKey === shortcut.key,
          onSelect: () => {
            setActivityViewEnabledSmoothly(false);
            selectRailPanelItem("home");

            if (shortcut.spaceId !== activeSpaceId) handleSelectSpace(shortcut.spaceId);
            else if (!isOnThreadsSection) handleBackToThreads();
          },
        },
      ];
    }
    const project = projectById.get(shortcut.projectId);
    if (!project) return [];
    return [
      {
        id: shortcut.key,
        glyphs: railProjectGlyphs(project.cwd, project.appearance ?? null),
        label: resolveSidebarProjectRowLabel(project),
        badge: null,
        active: activeRailShortcutKey === shortcut.key,
        onSelect: () => {
          setActivityViewEnabledSmoothly(false);
          selectRailPanelItem("spaces");
          openRailSpacesProject(project.id);
          if (!isOnThreadsSection) handleBackToThreads();
        },
      },
    ];
  });

  const railMoreMenu = (
    <AppRailMoreMenu
      spaces={[null, ...spaces.map((space) => space.id)].map((spaceId) => ({
        key: railSpaceShortcutKey(spaceId),
        label: spaceDisplayName(spaceId, spaces, voidSpace),
      }))}
      projects={allStandardProjectsBase.map((project) => ({
        key: railProjectShortcutKey(project.id),
        label: resolveSidebarProjectRowLabel(project),
      }))}
      pinnedKeys={new Set(railShortcuts.map((shortcut) => shortcut.key))}
      onToggleShortcut={(key) =>
        updateSettings({
          railShortcuts: toggleRailShortcutKey(appSettings.railShortcuts, key),
        })
      }
      active={false}
    />
  );

  const railBottomItems: AppRailItem[] = [
    {
      id: "settings",
      glyphs: railItemGlyphs("settings"),
      label: "Settings",
      badge: null,
      active: railActiveItem === "settings",
      onSelect: () => {
        selectRailRouteItem("settings");
        void navigate({ to: "/settings" });
      },
    },
  ];

  const panelSidebarNavIds = isRailLayout ? SIDEBAR_NAV_ITEM_IDS.slice(0, 1) : SIDEBAR_NAV_ITEM_IDS;

  const showRailAutomationsPanel = isRailLayout && isOnAutomations;

  const showRailSpacesPanel =
    isRailLayout && railPanelView === "spaces" && !isOnSettings && !activityViewEnabled;

  const sidebarSurfaceKey = showRailSpacesPanel
    ? `spaces:${railSpacesProject?.id ?? ""}`
    : activityViewEnabled
      ? "activity"
      : "threads";

  const relocateProjectDialogProject = relocateProjectDialogId
    ? (projectById.get(relocateProjectDialogId) ?? null)
    : null;

  const editProjectDialogProject = editProjectDialog
    ? (projectById.get(editProjectDialog.projectId) ?? null)
    : null;

  const projectContextMenuProject = projectContextMenuState
    ? (projectById.get(projectContextMenuState.projectId) ?? null)
    : null;

  const projectContextMenuThreads = useMemo(
    () =>
      projectContextMenuState
        ? sidebarThreads.filter((thread) => thread.projectId === projectContextMenuState.projectId)
        : [],
    [projectContextMenuState, sidebarThreads],
  );

  const projectContextMenuAnchor = useMemo(
    () =>
      projectContextMenuState
        ? createClientPointMenuAnchor(projectContextMenuState.position)
        : null,
    [projectContextMenuState],
  );

  const projectContextMenuHasAnyThreads = projectContextMenuThreads.length > 0;

  const projectContextMenuHasArchivableThreads = projectContextMenuThreads.some(
    (thread) => thread.archivedAt == null,
  );

  const projectContextMenuIsPinned = projectContextMenuProject
    ? pinnedProjectIdSet.has(projectContextMenuProject.id)
    : false;

  const projectContextMenuIsRunning = projectContextMenuProject
    ? Boolean(projectRunsByProjectId[projectContextMenuProject.id])
    : false;

  const projectContextMenuServer = projectContextMenuProject
    ? (projectRunServerByProjectId.get(projectContextMenuProject.id) ?? null)
    : null;

  const projectContextMenuHasOpenServer =
    projectContextMenuServer !== null && firstLocalServerUrl(projectContextMenuServer) !== null;
  return {
    ...context,
    handleToggleProjects,
    isMacDesktop,
    titlebarControls,
    wordmark,
    sidebarHelpMenuProps,
    railItems,
    railShortcutItems,
    railMoreMenu,
    railBottomItems,
    panelSidebarNavIds,
    showRailAutomationsPanel,
    showRailSpacesPanel,
    sidebarSurfaceKey,
    relocateProjectDialogProject,
    editProjectDialogProject,
    projectContextMenuProject,
    projectContextMenuAnchor,
    projectContextMenuHasAnyThreads,
    projectContextMenuHasArchivableThreads,
    projectContextMenuIsPinned,
    projectContextMenuIsRunning,
    projectContextMenuHasOpenServer,
  };
}
