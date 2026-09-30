import { AddPlusIcon, NewThreadIcon } from "~/lib/icons";
import { ThreadPrStatusBadge } from "~/components/pullRequest/ThreadPrStatusBadge";
import { PinStatusIcon, pinActionLabel } from "~/lib/pin";
import { type DragEvent as ReactDragEvent, type ReactNode } from "react";
import { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { formatRelativeTime } from "../lib/relativeTime";
import { type SidebarThreadSummary } from "../types";
import { ProjectSidebarIcon } from "./ProjectSidebarIcon";
import { ThreadHoverCardContent } from "./ThreadHoverCardContent";
import { ProjectHoverCardContent } from "./ProjectHoverCardContent";
import {
  SIDEBAR_HOVER_CARD_POPUP_PROPS,
  SIDEBAR_HOVER_CARD_SURFACE_CLASS_NAME,
  SIDEBAR_HOVER_CARD_TRIGGER_PROPS,
} from "./sidebarHoverCardStyles";
import {
  abbreviateHomePath,
  createProjectHoverCardAnchor,
  createThreadHoverCardAnchor,
} from "./sidebarHoverCardAnchors";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "./ui/preview-card";
import { SidebarIconButton } from "./SidebarIconButton";
import { SidebarLeadingIcon } from "./SidebarLeadingIcon";
import { SidebarMetaChipStack } from "./SidebarMetaChip";
import { SidebarRowHoverActions } from "./SidebarRowHoverActions";
import { SidebarSectionToolbar } from "./SidebarSectionToolbar";
import { SidebarStatusTrailingGlyph } from "./SidebarStatusTrailingGlyph";
import { ThreadArchiveActionButton } from "./ThreadArchiveActionButton";
import { ThreadPinToggleButton } from "./ThreadPinToggleButton";
import { SidebarThreadRowContent } from "./SidebarThreadRowContent";
import { selectThreadTerminalState } from "../terminalStateStore";
import { DisclosureRegion } from "./ui/DisclosureRegion";
import { ShortcutKbd } from "./ui/shortcut-kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "./ui/sidebar";
import {
  createSidebarThreadHoverAnchorId,
  resolveSidebarProjectRowLabel,
  resolveThreadHoverCardMetadata,
  resolveThreadProjectLabel,
  resolveThreadStatusTrailingIndicator,
} from "./Sidebar.logic.statusTypes";
import {
  resolveThreadRowClassName,
  resolveThreadRowTrailingReserveClass,
  type SidebarDerivedProjectData,
} from "./Sidebar.logic.status";
import { cn } from "~/lib/utils";
import { resolveThreadModelSummary } from "~/lib/threadModelSummary";
import { beginThreadDrag, endThreadDrag } from "../lib/threadDrag";
import {
  sidebarHoverRevealHideClassName,
  SIDEBAR_HEADER_ROW_CLASS_NAME,
  SIDEBAR_NESTED_LIST_GAP_CLASS_NAME,
  SIDEBAR_NESTED_LIST_OFFSET_CLASS_NAME,
  SIDEBAR_ROW_ACTIVE_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_PROJECT_NAME_CLASS_NAME,
  SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
  SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
  SIDEBAR_SECTION_LABEL_CLASS_NAME,
} from "../sidebarRowStyles";
import { SpaceEmptyState } from "./SpaceEmptyState";
import { PROJECT_SPACE_DRAG_MIME } from "./SpaceSwitcher";
import type { useSidebarPanelEffects } from "./useSidebarPanelEffects";
import {
  BackArrowIcon,
  preventFocusOnMouseDown,
  ProjectRunIndicatorDot,
  THREAD_ROW_META_CHIP_HOVER_FADE_CLASS_NAME,
  threadRowStatusSlotClassName,
  ThreadMetaChip,
  resolveThreadRowMetaChips,
  terminalStatusFromThreadState,
  SortableProjectHandleProps,
} from "./sidebarSupport";

export function useSidebarRows(context: ReturnType<typeof useSidebarPanelEffects>) {
  const {
    spaces,
    threadsHydrated,
    openRailSpacesProject,
    closeRailSpacesProject,
    terminalStateByThreadId,
    homeDir,
    automationsByThreadId,
    handleNewThread,
    newThreadShortcutLabel,
    setCreateProjectDialogOpen,
    setCreateProjectSpaceId,
    selectedThreadIds,
    clearSelection,
    visualActiveSidebarThreadId,
    projectById,
    resolveThreadStatusForSidebar,
    pinnedThreadIdSet,
    toggleThreadPinned,
    archiveThreadWithUndo,
    projectRunsByProjectId,
    projectRunServerByProjectId,
    pinnedThreads,
    openPrLink,
    toggleProjectPinned,
    prefetchModelsForProjectNewThread,
    openRenameThreadDialog,
    handleThreadRenamePointerUp,
    primeThreadActivation,
    handleThreadContextMenu,
    handleMultiSelectContextMenu,
    activateThreadFromSidebarIntent,
    voidSpace,
    openSpaceProjectPicker,
    handleProjectContextMenuAction,
    handleProjectContextMenu,
    handleProjectTitlePointerDownCapture,
    sortedProjects,
    allStandardProjectsBase,
    pinnedProjectIdSet,
    surfaceProjectSidebarDataById,
    railSpacesSections,
    railSpacesProject,
    railSpacesProjectSidebarData,
    handleThreadClick,
    prByThreadId,
    isManualProjectSorting,
    visibleThreadJumpLabelByThreadId,
    handleProjectTitleClick,
    handleProjectTitleKeyDown,
    showMoreThreadsForProject,
  } = context;
  function resolvePinnedThreadProjectLabel(projectId: ProjectId): string {
    return resolveThreadProjectLabel(projectById.get(projectId));
  }

  function renderThreadArchiveAction(
    threadId: ThreadId,
    toneClassName: string,
    options?: {
      compact?: boolean;
    },
  ) {
    return (
      <ThreadArchiveActionButton
        threadId={threadId}
        toneClassName={toneClassName}
        compact={options?.compact === true}
        onArchive={() => void archiveThreadWithUndo(threadId)}
      />
    );
  }

  function renderThreadHoverActions(input: {
    threadId: ThreadId;
    toneClassName: string;
    isPinned: boolean;
    includePinToggle?: boolean;
    compact?: boolean;
  }) {
    const compact = input.compact === true;
    const includePinToggle = input.includePinToggle !== false;

    return (
      <SidebarRowHoverActions threadId={input.threadId}>
        <div className="pointer-events-auto inline-flex items-center gap-2">
          {includePinToggle ? (
            <ThreadPinToggleButton
              pinned={input.isPinned}
              presentation="inline"
              toneClassName={input.toneClassName}
              onToggle={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleThreadPinned(input.threadId);
              }}
            />
          ) : null}
          {renderThreadArchiveAction(input.threadId, input.toneClassName, {
            compact,
          })}
        </div>
      </SidebarRowHoverActions>
    );
  }

  function renderThreadRowTrailingCluster(input: {
    isSubagentThread: boolean;
    threadJumpLabel: string | null;
    rightMetaChips: ThreadMetaChip[];
    threadStatus: ReturnType<typeof resolveThreadStatusForSidebar>;
    timestampToneClassName?: string;
    hoverActions: ReactNode;
  }) {
    // The jump shortcut owns the slot while it is visible; otherwise the shared rule decides which
    // status glyph shows here.
    const trailingStatus = resolveThreadStatusTrailingIndicator({
      status: input.threadStatus,
      slotOccupied: Boolean(input.threadJumpLabel),
    });
    return (
      <div className="relative flex shrink-0 items-center justify-end gap-[3px]">
        {!input.threadJumpLabel && input.rightMetaChips.length > 0 ? (
          <div className={THREAD_ROW_META_CHIP_HOVER_FADE_CLASS_NAME}>
            <SidebarMetaChipStack chips={input.rightMetaChips} />
          </div>
        ) : null}
        {input.threadJumpLabel ? (
          <ShortcutKbd
            shortcutLabel={input.threadJumpLabel}
            className={THREAD_ROW_META_CHIP_HOVER_FADE_CLASS_NAME}
          />
        ) : null}
        {trailingStatus ? (
          <span
            title={trailingStatus.label}
            className={threadRowStatusSlotClassName(
              input.isSubagentThread,
              input.timestampToneClassName,
            )}
          >
            <SidebarStatusTrailingGlyph status={trailingStatus} />
          </span>
        ) : null}
        {input.hoverActions}
      </div>
    );
  }

  function renderListSectionHeader(label: string, toolbar: ReactNode) {
    return (
      <div className="group/project-header relative my-1">
        <div
          className={cn(
            "flex h-7 w-full min-w-0 items-center px-2 py-0.5 pr-[4.75rem]",
            SIDEBAR_SECTION_LABEL_CLASS_NAME,
          )}
        >
          <span className="truncate">{label}</span>
        </div>
        <SidebarSectionToolbar placement="overlay" revealOnHover>
          {toolbar}
        </SidebarSectionToolbar>
      </div>
    );
  }

  function renderPinnedThreadsSection() {
    if (pinnedThreads.length === 0) {
      return null;
    }
    return (
      <div className="mb-3">
        <div className="my-1 flex items-center justify-between px-2 py-1">
          <span className={SIDEBAR_SECTION_LABEL_CLASS_NAME}>Pinned</span>
        </div>
        <div className="flex flex-col gap-0.5">
          {pinnedThreads.map((thread) => renderPinnedThreadRow(thread))}
        </div>
      </div>
    );
  }

  function renderThreadHoverCardPopup(
    thread: SidebarThreadSummary,
    hoverAnchorId: string,
    isActive: boolean,
  ) {
    const hoverProject = projectById.get(thread.projectId) ?? null;
    const hoverMetadata = resolveThreadHoverCardMetadata({
      thread,
      project: hoverProject,
    });
    const hoverStatus = resolveThreadStatusTrailingIndicator({
      status: resolveThreadStatusForSidebar(thread),
      isActive,
    });
    return (
      <TooltipPopup
        {...SIDEBAR_HOVER_CARD_POPUP_PROPS}
        viewportClassName="[--viewport-inline-padding:0px] py-0"
        anchor={createThreadHoverCardAnchor(hoverAnchorId)}
        className={cn(SIDEBAR_HOVER_CARD_SURFACE_CLASS_NAME, "whitespace-normal leading-tight")}
      >
        <ThreadHoverCardContent
          title={thread.title}
          timeLabel={formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
          project={{
            name: hoverMetadata.projectName,
            cwd: hoverMetadata.projectCwd,
            appearance: hoverProject?.appearance ?? null,
            sourceName: hoverMetadata.sourceProjectName,
          }}
          workspace={{
            branch: hoverMetadata.branch,
            worktreeName: hoverMetadata.worktreeName,
          }}
          pullRequest={prByThreadId.get(thread.id) ?? null}
          onOpenPullRequest={openPrLink}
          model={resolveThreadModelSummary(thread.modelSelection)}
          status={hoverStatus}
        />
      </TooltipPopup>
    );
  }

  function renderProjectHoverCardPopup(
    project: (typeof sortedProjects)[number],
    chatCount: number,
  ) {
    return (
      <PreviewCardPopup
        {...SIDEBAR_HOVER_CARD_POPUP_PROPS}
        anchor={createProjectHoverCardAnchor(project.id)}
        className={SIDEBAR_HOVER_CARD_SURFACE_CLASS_NAME}
      >
        <ProjectHoverCardContent
          name={project.name}
          cwd={project.cwd}
          appearance={project.appearance ?? null}
          isPinned={pinnedProjectIdSet.has(project.id)}
          chatCount={chatCount}
          path={abbreviateHomePath(project.cwd, homeDir)}
          onTogglePin={() => toggleProjectPinned(project.id)}
          onEditProject={() => void handleProjectContextMenuAction(project.id, "rename")}
        />
      </PreviewCardPopup>
    );
  }

  function renderPinnedThreadRow(thread: SidebarThreadSummary) {
    const threadTerminalState = selectThreadTerminalState(terminalStateByThreadId, thread.id);
    const terminalStatus = terminalStatusFromThreadState({
      runningTerminalIds: threadTerminalState.runningTerminalIds,
      terminalAttentionStatesById: threadTerminalState.terminalAttentionStatesById,
    });
    const terminalCount = threadTerminalState.terminalIds.length;
    const isActive = visualActiveSidebarThreadId === thread.id;
    const projectLabel = resolvePinnedThreadProjectLabel(thread.projectId);
    const rightMetaChips = resolveThreadRowMetaChips({
      thread,
      threadAutomations: automationsByThreadId.get(thread.id),
    });
    const threadStatus = resolveThreadStatusForSidebar(thread);
    const isSubagentThread = Boolean(thread.parentThreadId);
    const pr = prByThreadId.get(thread.id) ?? null;
    const leadingPr = isSubagentThread || thread.forkSourceThreadId ? null : pr;
    const threadJumpLabel = visibleThreadJumpLabelByThreadId.get(thread.id) ?? null;

    const hasTrailingStatusGlyph = Boolean(threadStatus) || Boolean(threadJumpLabel);
    const hoverAnchorId = createSidebarThreadHoverAnchorId({
      scope: "pinned",
      threadId: thread.id,
    });
    return (
      <Tooltip key={thread.id}>
        <TooltipTrigger
          {...SIDEBAR_HOVER_CARD_TRIGGER_PROPS}
          render={
            <div
              data-thread-hover-anchor={hoverAnchorId}
              className="group/thread-row relative w-full"
            />
          }
        >
          {leadingPr ? (
            <ThreadPrStatusBadge
              pr={leadingPr}
              onOpen={openPrLink}
              className="pointer-events-auto absolute left-1.5 top-1/2 z-30 size-5 -translate-y-1/2"
            />
          ) : null}
          <div
            role="button"
            tabIndex={0}
            data-thread-item
            className={cn(
              SIDEBAR_HEADER_ROW_CLASS_NAME,

              "relative gap-1.5 transition-colors",
              leadingPr && "pl-8",
              resolveThreadRowTrailingReserveClass({
                metaChipCount: threadJumpLabel ? 0 : rightMetaChips.length,
                hasTrailingGlyph: hasTrailingStatusGlyph,
              }),
              isActive
                ? SIDEBAR_ROW_ACTIVE_CLASS_NAME
                : cn(SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME, SIDEBAR_ROW_HOVER_CLASS_NAME),
            )}
            onPointerDown={(event) => primeThreadActivation(event, thread.id)}
            onClick={() => activateThreadFromSidebarIntent(thread.id)}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openRenameThreadDialog(thread.id);
            }}
            onPointerUp={(event) => handleThreadRenamePointerUp(event, thread.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activateThreadFromSidebarIntent(thread.id);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              void handleThreadContextMenu(thread.id, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <SidebarThreadRowContent
              thread={thread}
              terminalStatus={terminalStatus}
              terminalCount={terminalCount}
              isActive={isActive}
              variant="pinned"
              pendingStatusColorClass={
                threadStatus?.label === "Pending Approval" ? threadStatus.colorClass : null
              }
              suffix={
                projectLabel ? (
                  <span
                    className={cn(
                      "max-w-[40%] shrink-0 truncate text-right text-ui-meta text-muted-foreground/38 transition-[margin] duration-120 ease-out",
                      hasTrailingStatusGlyph && "mr-2",
                    )}
                  >
                    {projectLabel}
                  </span>
                ) : null
              }
            />
            <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
              {renderThreadRowTrailingCluster({
                isSubagentThread,
                threadJumpLabel,
                rightMetaChips,
                threadStatus,
                timestampToneClassName: "text-muted-foreground/38",
                hoverActions: renderThreadHoverActions({
                  threadId: thread.id,
                  toneClassName: "text-muted-foreground/42",
                  isPinned: true,
                  compact: isSubagentThread,
                }),
              })}
            </div>
          </div>
        </TooltipTrigger>
        {renderThreadHoverCardPopup(thread, hoverAnchorId, isActive)}
      </Tooltip>
    );
  }

  function renderThreadRow(
    thread: SidebarThreadSummary,
    orderedProjectThreadIds: readonly ThreadId[],
    depth = 0,

    topLevel = false,
    virtualOffset?: number,
  ) {
    const threadTerminalState = selectThreadTerminalState(terminalStateByThreadId, thread.id);
    const isActive = visualActiveSidebarThreadId === thread.id;
    const isPinned = pinnedThreadIdSet.has(thread.id);
    const isSelected = selectedThreadIds.has(thread.id);
    const isHighlighted = isActive || isSelected;
    const threadStatus = resolveThreadStatusForSidebar(thread);
    const pr = prByThreadId.get(thread.id) ?? null;
    const terminalStatus = terminalStatusFromThreadState({
      runningTerminalIds: threadTerminalState.runningTerminalIds,
      terminalAttentionStatesById: threadTerminalState.terminalAttentionStatesById,
    });
    const terminalCount = threadTerminalState.terminalIds.length;
    const secondaryMetaClass = isHighlighted
      ? "text-foreground/54 dark:text-foreground/64"
      : "text-muted-foreground/34";
    const rightMetaChips = resolveThreadRowMetaChips({
      thread,
      threadAutomations: automationsByThreadId.get(thread.id),
    });
    const isSubagentThread = Boolean(thread.parentThreadId);
    const leadingPr = isSubagentThread || thread.forkSourceThreadId ? null : pr;
    const subagentIndentPx = Math.max(0, Math.min(depth - 1, 3) * 10);
    const showCompactMeta = !isSubagentThread;
    const threadJumpLabel = visibleThreadJumpLabelByThreadId.get(thread.id) ?? null;
    const hoverAnchorId = createSidebarThreadHoverAnchorId({
      scope: topLevel ? "chat" : "project",
      threadId: thread.id,
    });

    return (
      <SidebarMenuSubItem
        key={thread.id}
        data-thread-hover-anchor={hoverAnchorId}
        className={cn(
          "group/thread-row w-full",
          virtualOffset === undefined ? null : "absolute top-0 left-0 pb-1",
        )}
        data-thread-item
        style={
          virtualOffset === undefined ? undefined : { transform: `translateY(${virtualOffset}px)` }
        }
      >
        {leadingPr ? (
          <ThreadPrStatusBadge
            pr={leadingPr}
            onOpen={openPrLink}
            className="pointer-events-auto absolute left-1.5 top-1/2 z-30 size-5 -translate-y-1/2"
          />
        ) : null}
        <Tooltip>
          <TooltipTrigger
            {...SIDEBAR_HOVER_CARD_TRIGGER_PROPS}
            render={
              <SidebarMenuSubButton
                render={<div role="button" tabIndex={0} />}
                size="sm"
                isActive={isActive}
                className={cn(
                  resolveThreadRowClassName({
                    isActive,
                    isSelected,
                  }),
                  leadingPr ? "pl-8" : topLevel && !isSubagentThread ? "pl-2" : null,
                  isSubagentThread
                    ? "pr-7.5"
                    : resolveThreadRowTrailingReserveClass({
                        metaChipCount:
                          showCompactMeta && !threadJumpLabel ? rightMetaChips.length : 0,
                        hasTrailingGlyph: Boolean(threadStatus) || Boolean(threadJumpLabel),
                      }),
                )}
                draggable
                onDragStart={(event) => beginThreadDrag(event, thread.id)}
                onDragEnd={endThreadDrag}
                onClick={(event) => {
                  handleThreadClick(event, thread.id, orderedProjectThreadIds);
                }}
                onPointerDown={(event) => primeThreadActivation(event, thread.id)}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openRenameThreadDialog(thread.id);
                }}
                onPointerUp={(event) => handleThreadRenamePointerUp(event, thread.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  activateThreadFromSidebarIntent(thread.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();

                  if (selectedThreadIds.size > 0 && selectedThreadIds.has(thread.id)) {
                    void handleMultiSelectContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                    });
                    return;
                  }
                  if (selectedThreadIds.size > 0) {
                    clearSelection();
                  }
                  void handleThreadContextMenu(thread.id, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              />
            }
          >
            <SidebarThreadRowContent
              thread={thread}
              terminalStatus={terminalStatus}
              terminalCount={terminalCount}
              isActive={isActive}
              variant="standard"
              subagentIndentPx={subagentIndentPx}
              pendingStatusColorClass={
                threadStatus?.label === "Pending Approval" ? threadStatus.colorClass : null
              }
            />
            <div className={cn("absolute top-1/2 flex -translate-y-1/2 items-center", "right-1.5")}>
              {renderThreadRowTrailingCluster({
                isSubagentThread,
                threadJumpLabel,
                rightMetaChips: showCompactMeta ? rightMetaChips : [],
                threadStatus,
                timestampToneClassName: isSubagentThread
                  ? isHighlighted
                    ? "text-foreground/38 dark:text-foreground/46"
                    : "text-muted-foreground/24"
                  : secondaryMetaClass,
                hoverActions: renderThreadHoverActions({
                  threadId: thread.id,
                  toneClassName: secondaryMetaClass,
                  isPinned,
                  compact: isSubagentThread,
                }),
              })}
            </div>
          </TooltipTrigger>
          {renderThreadHoverCardPopup(thread, hoverAnchorId, isActive)}
        </Tooltip>
      </SidebarMenuSubItem>
    );
  }

  function renderProjectThreadActions(project: (typeof sortedProjects)[number]) {
    return (
      <SidebarIconButton
        icon={NewThreadIcon}
        label={`Create new thread in ${project.name}`}
        tooltip={newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"}
        tooltipSide="top"
        data-testid="new-thread-button"
        onMouseEnter={() => {
          prefetchModelsForProjectNewThread(project.id);
        }}
        onFocus={() => {
          prefetchModelsForProjectNewThread(project.id);
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          prefetchModelsForProjectNewThread(project.id);
          void handleNewThread(project.id);
        }}
      />
    );
  }

  function renderProjectThreadList(
    project: (typeof sortedProjects)[number],
    projectSidebarData: SidebarDerivedProjectData,
  ) {
    const { orderedProjectThreadIds, visibleEntries, threadListExtraPages, canShowMoreThreads } =
      projectSidebarData;
    return (
      <>
        {visibleEntries.map((entry) =>
          renderThreadRow(entry.thread, orderedProjectThreadIds, entry.depth),
        )}

        {canShowMoreThreads && (
          <SidebarMenuSubItem className="w-full">
            <SidebarMenuSubButton
              render={<button type="button" />}
              data-thread-selection-safe
              size="sm"
              className="h-7 w-full translate-x-0 justify-start rounded-lg pr-2 pl-8 text-left text-ui text-muted-foreground/79 hover:bg-transparent hover:text-foreground active:bg-transparent active:text-foreground"
              onMouseDown={preventFocusOnMouseDown}
              onClick={() => {
                showMoreThreadsForProject(project.cwd, threadListExtraPages);
              }}
            >
              <span>Show more</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        )}
      </>
    );
  }

  function isSidebarProjectRunning(projectId: ProjectId): boolean {
    return (
      (projectRunsByProjectId[projectId] ?? null) !== null ||
      (projectRunServerByProjectId.get(projectId) ?? null) !== null
    );
  }

  function renderProjectItem(
    project: (typeof sortedProjects)[number],
    dragHandleProps: SortableProjectHandleProps | null,
  ) {
    const isProjectPinned = pinnedProjectIdSet.has(project.id);
    const projectSidebarData = surfaceProjectSidebarDataById.get(project.id);
    if (!projectSidebarData) {
      return null;
    }
    const { allProjectThreadCount, projectStatus } = projectSidebarData;
    const projectFolderIconClassName = isProjectPinned
      ? "opacity-0"
      : sidebarHoverRevealHideClassName("project-header");
    const isProjectRunning = isSidebarProjectRunning(project.id);
    const collapsedProjectStatus = project.expanded ? null : projectStatus;
    // The "open dev server" affordance now lives in the project context menu, so the hover toolbar
    // always reserves space for the three thread actions. The reserve lives on the *name* container
    // (not the button) so only the truncating name yields to the overlay toolbar; the trailing run dot
    // stays put and fades in place instead of sliding left. Focus is read from the group because the
    // name container itself is not focusable — the row's button is.
    const projectToolbarReserveClassName =
      "group-hover/project-header:pr-[4.75rem] group-has-[:focus-visible]/project-header:pr-[4.75rem]";

    const projectRowLabel = resolveSidebarProjectRowLabel(project);

    return (
      <div className="group/collapsible">
        <PreviewCard>
          <PreviewCardTrigger
            {...SIDEBAR_HOVER_CARD_TRIGGER_PROPS}
            render={
              <div
                className="group/project-header relative"
                data-project-hover-anchor={project.id}
              />
            }
          >
            <SidebarMenuButton
              ref={isManualProjectSorting ? dragHandleProps?.setActivatorNodeRef : undefined}
              size="sm"
              className={cn(
                SIDEBAR_HEADER_ROW_CLASS_NAME,
                "hover:bg-[var(--sidebar-accent)] group-hover/project-header:bg-[var(--sidebar-accent)] group-hover/project-header:text-[var(--sidebar-accent-foreground)]",
                isManualProjectSorting ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
              )}
              {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.attributes : {})}
              {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.listeners : {})}
              {...(!isManualProjectSorting && spaces.length > 0
                ? {
                    // Native drag-to-file: drop the row on a space tab to move the project. Manual sort mode is
                    // excluded because dnd-kit owns the drag gesture there for reordering.
                    draggable: true,
                    onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        PROJECT_SPACE_DRAG_MIME,
                        JSON.stringify({ projectId: project.id }),
                      );
                    },
                  }
                : {})}
              onPointerDownCapture={handleProjectTitlePointerDownCapture}
              onClick={(event) => handleProjectTitleClick(event, project.id)}
              onKeyDown={(event) => handleProjectTitleKeyDown(event, project.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                void handleProjectContextMenu(project.id, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <SidebarLeadingIcon
                size="sm"
                tone={SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME}
                className={projectFolderIconClassName}
              >
                <ProjectSidebarIcon
                  cwd={project.cwd}
                  expanded={project.expanded}
                  appearance={project.appearance}
                />
              </SidebarLeadingIcon>
              <div
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 overflow-hidden transition-[padding] duration-120 ease-out",
                  projectToolbarReserveClassName,
                )}
              >
                <span className={SIDEBAR_PROJECT_NAME_CLASS_NAME}>{projectRowLabel}</span>
              </div>
              {}
              {isProjectRunning || collapsedProjectStatus ? (
                <span
                  aria-label={
                    collapsedProjectStatus
                      ? `Project status: ${collapsedProjectStatus.label}`
                      : undefined
                  }
                  title={collapsedProjectStatus?.label}
                  className={cn(
                    "ml-auto flex min-w-[1.625rem] shrink-0 items-center justify-end gap-2 self-center",
                    sidebarHoverRevealHideClassName("project-header"),
                  )}
                >
                  {isProjectRunning ? <ProjectRunIndicatorDot /> : null}
                  {collapsedProjectStatus ? (
                    <SidebarStatusTrailingGlyph status={collapsedProjectStatus} />
                  ) : null}
                </span>
              ) : null}
            </SidebarMenuButton>
            <button
              type="button"
              aria-label={pinActionLabel(project.name, isProjectPinned)}
              aria-pressed={isProjectPinned}
              title={pinActionLabel(project.name, isProjectPinned)}
              className={cn(
                "sidebar-icon-button absolute left-2 top-1/2 z-20 inline-flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm transition-opacity hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
                SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
                isProjectPinned
                  ? "pointer-events-auto opacity-100"
                  : "pointer-events-none opacity-0 md:group-hover/project-header:pointer-events-auto md:group-hover/project-header:opacity-100 md:group-has-[:focus-visible]/project-header:pointer-events-auto md:group-has-[:focus-visible]/project-header:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleProjectPinned(project.id);
              }}
            >
              <PinStatusIcon pinned={isProjectPinned} className="size-3.5" />
            </button>
            <SidebarSectionToolbar placement="overlay" revealOnHover>
              {renderProjectThreadActions(project)}
            </SidebarSectionToolbar>
          </PreviewCardTrigger>
          {renderProjectHoverCardPopup(project, allProjectThreadCount)}
        </PreviewCard>

        <DisclosureRegion
          open={project.expanded}
          contentClassName={SIDEBAR_NESTED_LIST_OFFSET_CLASS_NAME}
        >
          <SidebarMenuSub
            className={cn(
              "mx-0 my-0 w-full translate-x-0 border-l-0 px-0 py-0",
              SIDEBAR_NESTED_LIST_GAP_CLASS_NAME,
            )}
          >
            {renderProjectThreadList(project, projectSidebarData)}
          </SidebarMenuSub>
        </DisclosureRegion>
      </div>
    );
  }

  function renderRailSpacesProjectRow(project: (typeof sortedProjects)[number]) {
    const isProjectRunning = isSidebarProjectRunning(project.id);
    return (
      <SidebarMenuItem key={project.id}>
        <SidebarMenuButton
          size="sm"
          className={cn(
            SIDEBAR_HEADER_ROW_CLASS_NAME,
            SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
            SIDEBAR_ROW_HOVER_CLASS_NAME,
          )}
          onClick={() => openRailSpacesProject(project.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            void handleProjectContextMenu(project.id, {
              x: event.clientX,
              y: event.clientY,
            });
          }}
        >
          <SidebarLeadingIcon size="sm" tone={SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME}>
            <ProjectSidebarIcon
              cwd={project.cwd}
              expanded={false}
              appearance={project.appearance}
            />
          </SidebarLeadingIcon>
          <span className={SIDEBAR_PROJECT_NAME_CLASS_NAME}>
            {resolveSidebarProjectRowLabel(project)}
          </span>
          {isProjectRunning ? <ProjectRunIndicatorDot /> : null}
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  function renderRailSpacesPanel() {
    if (railSpacesProject && railSpacesProjectSidebarData) {
      return (
        <SidebarGroup className="px-1.5 py-1.5">
          <div className="my-1 flex h-7 min-w-0 items-center gap-1.5 ps-1 pe-1.5">
            <SidebarIconButton
              icon={BackArrowIcon}
              label="Back to spaces"
              tooltip="Back to spaces"
              tooltipSide="bottom"
              onClick={closeRailSpacesProject}
            />
            <span className={SIDEBAR_PROJECT_NAME_CLASS_NAME}>
              {resolveSidebarProjectRowLabel(railSpacesProject)}
            </span>
            <SidebarSectionToolbar>
              {renderProjectThreadActions(railSpacesProject)}
            </SidebarSectionToolbar>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuSub
                className={cn(
                  "mx-0 my-0 w-full translate-x-0 border-l-0 px-0 py-0",
                  SIDEBAR_NESTED_LIST_GAP_CLASS_NAME,
                )}
              >
                {renderProjectThreadList(railSpacesProject, railSpacesProjectSidebarData)}
              </SidebarMenuSub>
            </SidebarMenuItem>
          </SidebarMenu>
          {railSpacesProjectSidebarData.visibleEntries.length === 0 ? (
            <div className="px-2 pt-4 text-center text-ui text-muted-foreground/58">
              No threads yet
            </div>
          ) : null}
        </SidebarGroup>
      );
    }
    return (
      <SidebarGroup className="px-1.5 py-1.5">
        {threadsHydrated
          ? railSpacesSections.map((section) => (
              <div key={section.key}>
                {renderListSectionHeader(
                  section.name,
                  <SidebarIconButton
                    icon={AddPlusIcon}
                    label="Add project"
                    onClick={() => {
                      setCreateProjectSpaceId(section.spaceId);
                      setCreateProjectDialogOpen(true);
                    }}
                    tooltip="Add project"
                    tooltipSide="right"
                  />,
                )}
                {section.items.length > 0 ? (
                  <SidebarMenu className="gap-0.5">
                    {section.items.map((project) => renderRailSpacesProjectRow(project))}
                  </SidebarMenu>
                ) : (
                  <SpaceEmptyState
                    space={spaces.find((space) => space.id === section.spaceId) ?? null}
                    unfiledSpaceName={voidSpace.name}
                    hasProjectsElsewhere={allStandardProjectsBase.length > 0}
                    onMoveProjects={() => {
                      if (section.spaceId !== null) openSpaceProjectPicker(section.spaceId);
                    }}
                  />
                )}
              </div>
            ))
          : null}
      </SidebarGroup>
    );
  }
  return {
    ...context,
    renderListSectionHeader,
    renderPinnedThreadsSection,
    renderThreadHoverCardPopup,
    renderThreadRow,
    renderProjectItem,
    renderRailSpacesPanel,
  };
}
