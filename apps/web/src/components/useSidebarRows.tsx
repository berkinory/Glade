import { Spinner } from "~/components/ui/spinner";
import { SquarePenIcon } from "~/lib/icons";
import { SidebarDraftIndicator } from "./SidebarDraftIndicator";
import { ProjectHostChip } from "./ProjectHostChip";
import { SIDEBAR_TRAILING_ICON_FORCE_CLASS } from "./sidebarGlyphs";
import { useTerminalStateStore } from "../terminalStateStore";
import { useSidebarStateStore } from "../sidebarStateStore";
import { ThreadPrStatusBadge } from "~/components/pullRequest/ThreadPrStatusBadge";
import { PinStatusIcon, pinActionLabel } from "~/lib/pin";
import { type DragEvent as ReactDragEvent, type ReactNode } from "react";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
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
import { sidebarGlyphClass } from "./sidebarGlyphs";
import { SidebarMetaChipStack } from "./SidebarMetaChip";
import { SidebarRowHoverActions } from "./SidebarRowHoverActions";
import { SidebarSectionToolbar } from "./SidebarSectionToolbar";
import { SidebarStatusTrailingGlyph } from "./SidebarStatusTrailingGlyph";
import { ThreadArchiveActionButton } from "./ThreadArchiveActionButton";
import { ThreadPinToggleButton } from "./ThreadPinToggleButton";
import { SidebarThreadRowContent } from "./SidebarThreadRowContent";
import { selectThreadTerminalState } from "../terminalStateStore";
import { DisclosureRegion } from "./ui/DisclosureRegion";
import { ShortcutKbd } from "./ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarMenuButton,
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
import { resolveThreadRowClassName, type SidebarDerivedProjectData } from "./Sidebar.logic.status";
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
  SIDEBAR_THREAD_HOVER_ACTION_TONE_CLASS_NAME,
  SIDEBAR_SECTION_LABEL_CLASS_NAME,
} from "../sidebarRowStyles";
import { PROJECT_SPACE_DRAG_MIME } from "./SpaceSwitcher";
import type { useSidebarPanelEffects } from "./useSidebarPanelEffects";
import {
  preventFocusOnMouseDown,
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
    homeDir,
    handleNewThread,
    newThreadShortcutLabel,
    visualActiveSidebarThreadId,
    projectById,
    resolveThreadStatusForSidebar,
    pinnedThreadIdSet,
    toggleThreadPinned,
    archiveThreadWithUndo,
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
    handleProjectContextMenuAction,
    handleProjectContextMenu,
    handleProjectTitlePointerDownCapture,
    sortedProjects,
    pinnedProjectIdSet,
    surfaceProjectSidebarDataById,
    handleThreadClick,
    prByThreadId,
    isManualProjectSorting,
    visibleThreadJumpLabelByThreadId,
    handleProjectTitleClick,
    handleProjectTitleKeyDown,
    showMoreThreadsForProject,
  } = context;
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const selectedThreadIds = useSidebarStateStore((state) => state.selectedThreadIds);
  const clearSelection = useSidebarStateStore((state) => state.clearSelection);
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
    isPinned: boolean;
    includePinToggle?: boolean;
    compact?: boolean;
  }) {
    const compact = input.compact === true;
    const includePinToggle = input.includePinToggle !== false;
    return (
      <SidebarRowHoverActions threadId={input.threadId}>
        <div
          className={cn(
            "pointer-events-auto inline-flex items-center gap-2",
            !compact && SIDEBAR_TRAILING_ICON_FORCE_CLASS,
          )}
        >
          {includePinToggle ? (
            <ThreadPinToggleButton
              pinned={input.isPinned}
              presentation="inline"
              toneClassName={SIDEBAR_THREAD_HOVER_ACTION_TONE_CLASS_NAME}
              onToggle={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleThreadPinned(input.threadId);
              }}
            />
          ) : null}
          {renderThreadArchiveAction(input.threadId, SIDEBAR_THREAD_HOVER_ACTION_TONE_CLASS_NAME, {
            compact,
          })}
        </div>
      </SidebarRowHoverActions>
    );
  }
  function renderThreadRowTrailingCluster(input: {
    isSubagentThread: boolean;
    threadJumpLabel: string | null;
    metadata: { chips: ThreadMetaChip[]; projectLabel?: string };
    threadStatus: ReturnType<typeof resolveThreadStatusForSidebar>;
    timestampToneClassName?: string;
    hoverActions: ReactNode;
    draftIndicator: ReactNode;
    pr: ReactNode;
  }) {
    if (input.isSubagentThread) {
      return input.threadStatus?.pulse ? (
        <span role="img" aria-label="Subagent working" className="inline-flex shrink-0">
          <Spinner variant="subagent" className="size-3" aria-hidden="true" />
        </span>
      ) : null;
    }
    // The jump shortcut owns the slot while it is visible; otherwise the shared rule decides which
    // status glyph shows here.
    const trailingStatus = resolveThreadStatusTrailingIndicator({
      status: input.threadStatus,
      slotOccupied: Boolean(input.threadJumpLabel),
    });
    return (
      <div className="flex min-w-0 shrink-0 items-center gap-1">
        <div className="relative grid min-w-0 items-center">
          <div className="col-start-1 row-start-1 flex min-w-0 items-center justify-end gap-1">
            {!input.threadJumpLabel && input.metadata.chips.length > 0 ? (
              <div className={THREAD_ROW_META_CHIP_HOVER_FADE_CLASS_NAME}>
                <SidebarMetaChipStack chips={input.metadata.chips} />
              </div>
            ) : null}
            {input.threadJumpLabel ? (
              <ShortcutKbd
                shortcutLabel={input.threadJumpLabel}
                className={cn("max-w-[8em]", THREAD_ROW_META_CHIP_HOVER_FADE_CLASS_NAME)}
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
            {input.draftIndicator}
            {input.metadata.projectLabel ? (
              <span
                aria-label={input.metadata.projectLabel}
                className={cn(
                  "max-w-[8em] shrink-0 truncate text-right text-ui-xs text-muted-foreground/38",
                  sidebarHoverRevealHideClassName("thread-row"),
                )}
              >
                {input.metadata.projectLabel}
              </span>
            ) : null}
          </div>
          {input.hoverActions}
        </div>
        {input.pr}
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
    const project = projectById.get(thread.projectId);
    const projectLabel = resolveThreadProjectLabel(project);
    const rightMetaChips = resolveThreadRowMetaChips({
      thread,
    });
    const threadStatus = resolveThreadStatusForSidebar(thread);
    const isSubagentThread = Boolean(thread.parentThreadId);
    const pr = prByThreadId.get(thread.id) ?? null;
    const threadJumpLabel = visibleThreadJumpLabelByThreadId.get(thread.id) ?? null;
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
          <div
            role="button"
            tabIndex={0}
            data-thread-item
            data-sidebar-thread-id={thread.id}
            className={cn(
              SIDEBAR_HEADER_ROW_CLASS_NAME,
              "relative gap-1.5 transition-colors",
              "pr-2",
              isActive
                ? SIDEBAR_ROW_ACTIVE_CLASS_NAME
                : cn(SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME, SIDEBAR_ROW_HOVER_CLASS_NAME),
            )}
            onPointerDown={(event) => primeThreadActivation(event, thread.id)}
            onClick={() => activateThreadFromSidebarIntent(thread.id)}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!isSubagentThread) openRenameThreadDialog(thread.id);
            }}
            onPointerUp={(event) =>
              !isSubagentThread && handleThreadRenamePointerUp(event, thread.id)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activateThreadFromSidebarIntent(thread.id);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (isSubagentThread) return;
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
              projectBadge={
                project?.kind === "project" ? (
                  <ProjectSidebarIcon
                    cwd={project.cwd}
                    expanded={false}
                    appearance={project.appearance}
                    glyphClassName="size-2.5"
                  />
                ) : null
              }
            />
            <div className="flex min-w-0 shrink-0 items-center">
              {renderThreadRowTrailingCluster({
                pr: pr ? <ThreadPrStatusBadge pr={pr} onOpen={openPrLink} /> : null,
                draftIndicator: <SidebarDraftIndicator threadId={thread.id} isActive={isActive} />,
                isSubagentThread,
                threadJumpLabel,
                metadata: {
                  chips: rightMetaChips,
                  ...(project?.kind === "project" ? { projectLabel } : {}),
                },
                threadStatus,
                timestampToneClassName: "text-muted-foreground/38",
                hoverActions: isSubagentThread
                  ? null
                  : renderThreadHoverActions({
                      threadId: thread.id,
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
    });
    const isSubagentThread = Boolean(thread.parentThreadId);
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
        data-sidebar-thread-id={thread.id}
        style={
          virtualOffset === undefined
            ? undefined
            : {
                transform: `translateY(${virtualOffset}px)`,
              }
        }
      >
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
                  topLevel && !isSubagentThread ? "pl-2" : null,
                  "pr-2",
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
                  if (!isSubagentThread) openRenameThreadDialog(thread.id);
                }}
                onPointerUp={(event) =>
                  !isSubagentThread && handleThreadRenamePointerUp(event, thread.id)
                }
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
                  if (isSubagentThread) return;
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
            />
            <div className="flex min-w-0 shrink-0 items-center">
              {renderThreadRowTrailingCluster({
                pr: pr ? <ThreadPrStatusBadge pr={pr} onOpen={openPrLink} /> : null,
                draftIndicator: <SidebarDraftIndicator threadId={thread.id} isActive={isActive} />,
                isSubagentThread,
                threadJumpLabel,
                metadata: { chips: showCompactMeta ? rightMetaChips : [] },
                threadStatus,
                timestampToneClassName: isSubagentThread
                  ? isHighlighted
                    ? "text-foreground/38 dark:text-foreground/46"
                    : "text-muted-foreground/24"
                  : secondaryMetaClass,
                hoverActions: isSubagentThread
                  ? null
                  : renderThreadHoverActions({
                      threadId: thread.id,
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
        icon={SquarePenIcon}
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
    const collapsedProjectStatus = project.expanded ? null : projectStatus;
    const projectFolderIconClassName = sidebarHoverRevealHideClassName("project-header");
    const projectToolbarReserveClassName =
      "group-hover/project-header:pr-8 group-has-[:focus-visible]/project-header:pr-8";
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
                        JSON.stringify({
                          projectId: project.id,
                        }),
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
                  glyphClassName={sidebarGlyphClass("leading")}
                />
                {isProjectPinned ? (
                  <span className="absolute -right-1 -bottom-1 flex size-2.5 items-center justify-center rounded-sm bg-sidebar">
                    <PinStatusIcon pinned className="size-2.5" />
                  </span>
                ) : null}
              </SidebarLeadingIcon>
              <div
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 overflow-hidden transition-[padding] duration-100 ease-out",
                  projectToolbarReserveClassName,
                )}
              >
                <span className={SIDEBAR_PROJECT_NAME_CLASS_NAME}>{projectRowLabel}</span>
              </div>
              <ProjectHostChip project={project} />
              {collapsedProjectStatus ? (
                <span
                  aria-label={`Project status: ${collapsedProjectStatus.label}`}
                  title={collapsedProjectStatus.label}
                  className={cn(
                    "ml-auto flex min-w-[1.625rem] shrink-0 items-center justify-end self-center",
                    sidebarHoverRevealHideClassName("project-header"),
                  )}
                >
                  <SidebarStatusTrailingGlyph status={collapsedProjectStatus} />
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
                "pointer-events-none opacity-0 md:group-hover/project-header:pointer-events-auto md:group-hover/project-header:opacity-100 md:group-has-[:focus-visible]/project-header:pointer-events-auto md:group-has-[:focus-visible]/project-header:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
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

        {projectSidebarData.visibleEntries.length > 0 || projectSidebarData.canShowMoreThreads ? (
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
        ) : null}
      </div>
    );
  }
  return {
    renderListSectionHeader,
    renderPinnedThreadsSection,
    renderThreadHoverCardPopup,
    renderThreadRow,
    renderProjectItem,
  };
}
