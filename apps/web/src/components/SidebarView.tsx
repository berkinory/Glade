import {
  PlusIcon,
  SquarePenIcon,
  SearchIcon,
  SettingsIcon,
  TriangleAlertIcon,
  ExpandIcon,
  CollapseIcon,
} from "~/lib/icons";
import { SidebarUsageIndicators } from "./SidebarUsageIndicators";
import { useStore } from "../store";
import { useSidebarStateStore } from "../sidebarStateStore";
import { SidebarTrigger } from "./ui/sidebar";
import { normalizeSidebarProjectThreadListCwd } from "./Sidebar.uiState";
import { SidebarLeadingControls } from "./SidebarHeaderNavigationControls";
import { isMacNavigatorPlatform } from "../lib/utils";
import { SIDEBAR_NAV_ITEM_IDS } from "../sidebarNavOrdering";
import { SidebarDialogs } from "./SidebarDialogs";
import { Suspense, useCallback } from "react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { isElectron } from "../env";
import { CHAT_SURFACE_HEADER_HEIGHT_CLASS } from "./chat/chatHeaderControls";
import { GladeLogo } from "./GladeLogo";
import { SidebarActivityView } from "./SidebarActivityView";
import { SidebarIconButton } from "./SidebarIconButton";
import { SidebarLeadingIcon } from "./SidebarLeadingIcon";
import { SidebarPrimaryAction } from "./SidebarPrimaryAction";
import { SidebarSectionToolbar } from "./SidebarSectionToolbar";
import { SidebarGlyph } from "./sidebarGlyphs";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { DisclosureChevron } from "./ui/DisclosureChevron";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";
import { DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS } from "~/hooks/useDesktopTopBarGutter";
import { cn } from "~/lib/utils";
import {
  disclosureContentClassName,
  disclosureShellClassName,
  DISCLOSURE_INNER_CLASS,
} from "~/lib/disclosureMotion";
import {
  SIDEBAR_HEADER_ROW_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
  SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
} from "../sidebarRowStyles";
import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { SidebarVirtualChatList } from "./SidebarVirtualChatList";
import { SpaceEmptyState } from "./SpaceEmptyState";
import { SpaceSwitcher } from "./SpaceSwitcher";
import type { useSidebarPanelEffects } from "./useSidebarPanelEffects";
import { useSidebarRows } from "./useSidebarRows";
import {
  DebugFeatureFlagsMenu,
  ProjectSortMenu,
  SidebarHelpMenu,
  SortableProjectItem,
  SidebarActivityBellButton,
} from "./sidebarSupport";
export function SidebarView({ context }: { context: ReturnType<typeof useSidebarPanelEffects> }) {
  const {
    showDebugFeatureFlagsMenu,
    spaces,
    activeSpaceId,
    threadsHydrated,
    desktopUpdate,
    navigate,
    isOnSettings,
    appSettings,
    updateSettings,
    activeSettingsSection,
    newChatShortcutLabel,
    searchShortcutLabel,
    activityShortcutLabel,
    focusedProjectId,
    setSearchPaletteOpen,
    handleActivityVisibleThreadIdsChange,
    setActivityViewEnabledSmoothly,
    visualActiveSidebarThreadId,
    projectById,
    visibleSidebarActivityThreads,
    hasUnreadActivity,
    resolveThreadStatusForSidebar,
    pinnedThreadIdSet,
    toggleThreadPinned,
    setThreadSettledWithToast,
    settledOverrideByThreadId,
    archiveThreadWithUndo,
    handleBackToAppFromSettings,
    handleCreateHomeChat,
    handleStartAddProject,
    handlePrimaryNewThread,
    openRenameThreadDialog,
    handleThreadRenamePointerUp,
    handleThreadContextMenu,
    activateThreadFromSidebarIntent,
    openThreadPullRequest,
    activeSpace,
    voidSpace,
    openSpaceCreator,
    openSpaceEditor,
    openVoidEditor,
    openSpaceProjectPicker,
    handleSelectSpace,
    handleReorderSpaces,
    handleRenameSpace,
    handleRenameVoid,
    resetVoidSpace,
    handleDeleteSpace,
    handleMoveProjectToSpace,
    jumpShortcutLabelForSpaceTab,
    handleProjectContextMenu,
    projectDnDSensors,
    projectCollisionDetection,
    handleProjectDragEnd,
    handleProjectDragStart,
    handleProjectDragCancel,
    sidebarNavDescriptors,
    visibleChatThreadRows,
    visibleChatThreadIds,
    allStandardProjectsBase,
    spaceActivityById,
    standardProjects,
    projectEmptyState,
    allProjectsExpanded,
    prByThreadId,
    isManualProjectSorting,
    openFeedbackDialog,
  } = context;
  const {
    showDesktopUpdateButton,
    desktopUpdateTooltip,
    desktopUpdateButtonDisabled,
    desktopUpdateButtonAction,
    desktopUpdateButtonPresentation,
    showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription,
    desktopUpdateDownloadPercent,
    desktopUpdateRowButtonClasses,
    handleDesktopUpdateButtonClick,
  } = desktopUpdate;
  const {
    renderListSectionHeader,
    renderPinnedThreadsSection,
    renderThreadHoverCardPopup,
    renderThreadRow,
    renderProjectItem,
  } = useSidebarRows(context);
  const markThreadVisited = useStore((state) => state.markThreadVisited);
  const setAllProjectsExpanded = useStore((state) => state.setAllProjectsExpanded);
  const collapseProjectsExcept = useStore((state) => state.collapseProjectsExcept);
  const chatSectionExpanded = useSidebarStateStore((state) => state.chatSectionExpanded);
  const setChatSectionExpanded = useSidebarStateStore((state) => state.setChatSectionExpanded);
  const setThreadListExtraPagesByProjectCwd = useSidebarStateStore(
    (state) => state.setThreadListExtraPagesByProjectCwd,
  );
  const activityViewEnabled = useSidebarStateStore((state) => state.activityViewEnabled);
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
  const sidebarHelpMenuProps = {
    onOpenShortcuts: () =>
      void navigate({
        to: "/settings",
        search: {
          section: "shortcuts",
        },
      }),
    onOpenFeedback: openFeedbackDialog,
  };
  const sidebarSurfaceKey = isOnSettings
    ? "settings"
    : activityViewEnabled
      ? "activity"
      : "threads";
  return (
    <>
      {isElectron ? (
        <>
          <SidebarHeader
            className={cn(
              "drag-region flex-row items-center gap-2 py-0 ps-4 pe-3 font-system-ui",
              CHAT_SURFACE_HEADER_HEIGHT_CLASS,
              isMacDesktop && DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS,
            )}
          >
            {titlebarControls}
          </SidebarHeader>
        </>
      ) : (
        <SidebarHeader className="gap-3 px-3 py-2.5 font-system-ui sm:gap-2.5 sm:px-4 sm:py-3">
          {wordmark}
        </SidebarHeader>
      )}

      <SidebarContent className="gap-0 font-system-ui">
        {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
          <SidebarGroup className="px-2 pt-2 pb-0">
            <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
              <TriangleAlertIcon />
              <AlertTitle>Intel build on Apple Silicon</AlertTitle>
              <AlertDescription>{arm64IntelBuildWarningDescription}</AlertDescription>
              {desktopUpdateButtonAction !== "none" ? (
                <AlertAction>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={desktopUpdateButtonDisabled}
                    onClick={handleDesktopUpdateButtonClick}
                  >
                    {desktopUpdateButtonAction === "download"
                      ? "Preparing ARM build"
                      : desktopUpdateButtonAction === "install"
                        ? "Update ARM build"
                        : "Check for ARM build update"}
                  </Button>
                </AlertAction>
              ) : null}
            </Alert>
          </SidebarGroup>
        ) : null}
        {isOnSettings ? (
          <SidebarGroup className="p-0">
            <SettingsSidebarNav
              activeSection={activeSettingsSection}
              onBack={handleBackToAppFromSettings}
              onSelectSection={(section, options) => {
                void navigate({
                  to: "/settings",
                  search: (previous) => ({
                    ...previous,
                    section: section === "general" ? undefined : section,
                    target: options?.target,
                  }),
                });
              }}
            />
          </SidebarGroup>
        ) : (
          <>
            <div className={cn("flex items-center gap-1 pt-0 pb-1 pr-2.5 pl-1.5")}>
              <h2 className="flex h-8 min-w-0 items-center gap-1.5 px-2.5">
                <span className="font-display min-w-0 truncate text-[17px] text-foreground">
                  Glade
                </span>
                <GladeLogo aria-hidden className="size-4 text-foreground" />
              </h2>
              <div className="ml-auto flex items-center gap-1.5">
                <SidebarIconButton
                  icon={SearchIcon}
                  label="Search"
                  glyph="leading"
                  size="header"
                  tooltip={searchShortcutLabel ? `Search (${searchShortcutLabel})` : "Search"}
                  tooltipSide="bottom"
                  onClick={() => {
                    setSearchPaletteOpen(true);
                  }}
                />
                <SidebarActivityBellButton
                  active={activityViewEnabled}
                  showUnreadDot={hasUnreadActivity}
                  shortcutLabel={activityShortcutLabel}
                  onClick={() => setActivityViewEnabledSmoothly(!activityViewEnabled)}
                />
              </div>
            </div>
            {}
            <div key={sidebarSurfaceKey} className="sidebar-surface-enter">
              {}
              <SidebarGroup className="px-1.5 pt-1 pb-1.5">
                <SidebarMenu className="gap-0.5">
                  {SIDEBAR_NAV_ITEM_IDS.map((id) => {
                    const item = sidebarNavDescriptors[id];
                    return (
                      <SidebarPrimaryAction
                        key={id}
                        icon={item.icon}
                        {...(item.iconClassName
                          ? {
                              iconClassName: item.iconClassName,
                            }
                          : {})}
                        label={item.label}
                        active={item.active}
                        badge={item.badge}
                        onClick={item.onClick}
                        {...(item.onMouseEnter
                          ? {
                              onMouseEnter: item.onMouseEnter,
                            }
                          : {})}
                        {...(item.onFocus
                          ? {
                              onFocus: item.onFocus,
                            }
                          : {})}
                      />
                    );
                  })}
                </SidebarMenu>
              </SidebarGroup>

              {activityViewEnabled ? (
                <SidebarGroup className="px-1.5 py-1.5">
                  <SidebarActivityView
                    threads={visibleSidebarActivityThreads}
                    projectById={projectById}
                    activeThreadId={visualActiveSidebarThreadId}
                    pinnedThreadIdSet={pinnedThreadIdSet}
                    settledOverrideByThreadId={settledOverrideByThreadId}
                    threadsHydrated={threadsHydrated}
                    resolveThreadStatus={resolveThreadStatusForSidebar}
                    onOpenThread={activateThreadFromSidebarIntent}
                    onOpenThreadPullRequest={openThreadPullRequest}
                    onSetThreadSettled={setThreadSettledWithToast}
                    onToggleThreadPinned={toggleThreadPinned}
                    onArchiveThread={(threadId) => void archiveThreadWithUndo(threadId)}
                    onMarkThreadRead={markThreadVisited}
                    onRenameThread={openRenameThreadDialog}
                    onThreadRenamePointerUp={handleThreadRenamePointerUp}
                    onThreadContextMenu={(threadId, position) => {
                      void handleThreadContextMenu(threadId, position);
                    }}
                    onProjectContextMenu={handleProjectContextMenu}
                    prByThreadId={prByThreadId}
                    onVisibleThreadIdsChange={handleActivityVisibleThreadIdsChange}
                    renderThreadHoverCard={(thread, anchorId) =>
                      renderThreadHoverCardPopup(
                        thread,
                        anchorId,
                        visualActiveSidebarThreadId === thread.id,
                      )
                    }
                    onCreateChat={handlePrimaryNewThread}
                    onAddProject={handleStartAddProject}
                  />
                </SidebarGroup>
              ) : (
                <SidebarGroup className="px-1.5 py-1.5">
                  <SpaceSwitcher
                    spaces={spaces}
                    activeSpaceId={activeSpaceId}
                    activityBySpaceId={spaceActivityById}
                    voidSpace={voidSpace}
                    onSelect={handleSelectSpace}
                    onCreate={() => openSpaceCreator()}
                    onEdit={(space) => openSpaceEditor(space.id)}
                    onDelete={(space) => void handleDeleteSpace(space.id)}
                    onReorder={handleReorderSpaces}
                    onRenameSpace={(space, name) => void handleRenameSpace(space, name)}
                    onEditVoid={openVoidEditor}
                    onRenameVoid={handleRenameVoid}
                    onResetVoid={resetVoidSpace}
                    onDropProject={(projectId, spaceId) =>
                      void handleMoveProjectToSpace(projectId, spaceId)
                    }
                    jumpShortcutLabelForTab={jumpShortcutLabelForSpaceTab}
                  />
                  {renderPinnedThreadsSection()}
                  {renderListSectionHeader(
                    "Projects",
                    <>
                      {standardProjects.length > 0 ? (
                        <SidebarIconButton
                          icon={allProjectsExpanded ? CollapseIcon : ExpandIcon}
                          label={
                            allProjectsExpanded
                              ? focusedProjectId
                                ? "Collapse all projects except the active project"
                                : "Collapse all projects"
                              : "Expand all projects"
                          }
                          className="disabled:cursor-default disabled:opacity-45"
                          onClick={handleToggleProjects}
                          tooltip={
                            allProjectsExpanded
                              ? focusedProjectId
                                ? "Collapse all projects except the active chat's project"
                                : "Collapse all projects"
                              : "Expand all projects"
                          }
                          tooltipSide="bottom"
                        />
                      ) : null}
                      <ProjectSortMenu
                        projectSortOrder={appSettings.sidebarProjectSortOrder}
                        onProjectSortOrderChange={(sortOrder) => {
                          updateSettings({
                            sidebarProjectSortOrder: sortOrder,
                          });
                        }}
                      />
                      <SidebarIconButton
                        icon={PlusIcon}
                        label="Add project"
                        onClick={handleStartAddProject}
                        tooltip="Add project"
                        tooltipSide="right"
                      />
                    </>,
                  )}

                  {isManualProjectSorting ? (
                    <DndContext
                      sensors={projectDnDSensors}
                      collisionDetection={projectCollisionDetection}
                      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
                      onDragStart={handleProjectDragStart}
                      onDragEnd={handleProjectDragEnd}
                      onDragCancel={handleProjectDragCancel}
                    >
                      <SidebarMenu className="gap-3">
                        <SortableContext
                          items={standardProjects.map((project) => project.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {standardProjects.map((project) => (
                            <SortableProjectItem key={project.id} projectId={project.id}>
                              {(dragHandleProps) => renderProjectItem(project, dragHandleProps)}
                            </SortableProjectItem>
                          ))}
                        </SortableContext>
                      </SidebarMenu>
                    </DndContext>
                  ) : (
                    <SidebarMenu className="gap-3">
                      {standardProjects.map((project) => (
                        <SidebarMenuItem key={project.id} className="rounded-md">
                          {renderProjectItem(project, null)}
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  )}

                  {projectEmptyState === "loading" && (
                    <div
                      className="space-y-2 px-2 pt-4"
                      aria-live="polite"
                      aria-label="Loading projects"
                    >
                      <div className="text-center text-ui text-muted-foreground/58">
                        Loading projects...
                      </div>
                      <div className="mx-auto grid w-full max-w-42 gap-1.5 opacity-70">
                        <div className="h-2 rounded-full bg-muted/55 animate-pulse" />
                        <div className="mx-auto h-2 w-4/5 rounded-full bg-muted/40 animate-pulse" />
                        <div className="mx-auto h-2 w-3/5 rounded-full bg-muted/30 animate-pulse" />
                      </div>
                    </div>
                  )}

                  {projectEmptyState === "empty" && (
                    <SpaceEmptyState
                      space={activeSpace}
                      unfiledSpaceName={voidSpace.name}
                      hasProjectsElsewhere={allStandardProjectsBase.length > 0}
                      onMoveProjects={() => {
                        if (activeSpace) openSpaceProjectPicker(activeSpace.id);
                      }}
                    />
                  )}
                </SidebarGroup>
              )}
            </div>
          </>
        )}
        {!isOnSettings && !activityViewEnabled ? (
          <SidebarGroup className="sidebar-surface-enter px-1.5 pt-1 pb-2">
            <div className="group/collapsible">
              <div className="group/project-header relative">
                <SidebarMenuButton
                  size="sm"
                  aria-expanded={chatSectionExpanded}
                  className={cn(
                    SIDEBAR_HEADER_ROW_CLASS_NAME,
                    SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
                    SIDEBAR_ROW_HOVER_CLASS_NAME,
                    "cursor-pointer",
                  )}
                  onClick={() => setChatSectionExpanded((current) => !current)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setChatSectionExpanded((current) => !current);
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                    <span className="truncate font-system-ui text-ui font-normal text-muted-foreground/79">
                      Chats
                    </span>
                    <DisclosureChevron
                      open={chatSectionExpanded}
                      className="text-muted-foreground/79"
                    />
                  </div>
                </SidebarMenuButton>
                <SidebarSectionToolbar placement="overlay" revealOnHover>
                  <SidebarIconButton
                    icon={SquarePenIcon}
                    label="Open new chat home"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleCreateHomeChat();
                    }}
                    tooltip={
                      newChatShortcutLabel ? `New chat (${newChatShortcutLabel})` : "New chat"
                    }
                    tooltipSide="top"
                  />
                </SidebarSectionToolbar>
              </div>

              <div className={cn(disclosureShellClassName(chatSectionExpanded), "pt-1")}>
                <div className={DISCLOSURE_INNER_CLASS}>
                  <div className={disclosureContentClassName(chatSectionExpanded)}>
                    {visibleChatThreadRows.length > 0 ? (
                      <SidebarVirtualChatList
                        rows={visibleChatThreadRows}
                        renderRow={(row, offset) =>
                          renderThreadRow(row.thread, visibleChatThreadIds, row.depth, true, offset)
                        }
                      />
                    ) : (
                      <div className="px-2 py-2 text-ui text-muted-foreground/48">No chats yet</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter className={cn("gap-2 border-sidebar-border border-t p-2 font-system-ui")}>
        <SidebarUsageIndicators />
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex flex-col gap-1">
              {DebugFeatureFlagsMenu && showDebugFeatureFlagsMenu && !isOnSettings ? (
                <Suspense fallback={null}>
                  <DebugFeatureFlagsMenu />
                </Suspense>
              ) : null}
              <div className="flex items-center gap-2">
                {!isOnSettings && (
                  <SidebarMenuButton
                    size="sm"
                    className={cn(
                      SIDEBAR_HEADER_ROW_CLASS_NAME,
                      SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
                      SIDEBAR_ROW_HOVER_CLASS_NAME,
                      "flex-1",
                    )}
                    onClick={() =>
                      void navigate({
                        to: "/settings",
                      })
                    }
                  >
                    <SidebarLeadingIcon size="sm" tone={SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME}>
                      <SidebarGlyph icon={SettingsIcon} variant="leading" />
                    </SidebarLeadingIcon>
                    <span>Settings</span>
                  </SidebarMenuButton>
                )}
                {showDesktopUpdateButton ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={desktopUpdateTooltip}
                          aria-disabled={desktopUpdateButtonDisabled || undefined}
                          disabled={desktopUpdateButtonDisabled}
                          className={desktopUpdateRowButtonClasses}
                          onClick={handleDesktopUpdateButtonClick}
                        >
                          <span className="flex min-w-0 flex-1 items-center justify-between gap-1.5 leading-tight">
                            <span className="min-w-0 truncate text-center">
                              {desktopUpdateButtonPresentation.label}
                            </span>
                            {desktopUpdateButtonPresentation.secondaryLabel ? (
                              <span className="min-w-0 truncate text-center text-ui-xs text-white/80">
                                {desktopUpdateButtonPresentation.secondaryLabel}
                              </span>
                            ) : null}
                          </span>
                          {desktopUpdateDownloadPercent !== null ? (
                            <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-ui-2xs font-semibold tabular-nums text-white/95">
                              {desktopUpdateDownloadPercent}%
                            </span>
                          ) : null}
                        </button>
                      }
                    />
                    <TooltipPopup side="top">{desktopUpdateTooltip}</TooltipPopup>
                  </Tooltip>
                ) : (
                  <SidebarHelpMenu {...sidebarHelpMenuProps} />
                )}
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarDialogs context={context} />
    </>
  );
}
