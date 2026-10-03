import { CentralIcon } from "~/lib/central-icons";
import { useShallow } from "zustand/react/shallow";
import { useComposerDraftStore } from "~/composerDraftStore";
import { hasUnsentComposerDraft } from "~/composerDraftDomain";
import { useSidebarStateStore } from "~/sidebarStateStore";
import { ProjectSidebarIcon } from "./ProjectSidebarIcon";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import type { OrchestrationThreadPullRequest } from "@glade/contracts/orchestration/threadEntities";
import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { resolveThreadEnvironmentMode } from "@glade/shared/threads/threadEnvironment";

import {
  AddPlusIcon,
  CircleCheckIcon,
  GitBranchIcon,
  NewThreadIcon,
  SortIcon,
  Undo2Icon,
  WorktreeIcon,
} from "~/lib/icons";
import { beginThreadDrag, endThreadDrag } from "~/lib/threadDrag";
import { cn } from "~/lib/utils";
import {
  SIDEBAR_ROW_ACTIVE_CLASS_NAME,
  SIDEBAR_ROW_FOCUS_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
  SIDEBAR_SECTION_LABEL_CLASS_NAME,
  sidebarHoverRevealHideClassName,
} from "../sidebarRowStyles";
import { resolveThreadPullRequestFallback } from "../hooks/useThreadPullRequests";
import type { Project, SidebarThreadSummary } from "../types";
import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { FolderClosed } from "./FolderClosed";
import { ProviderIcon } from "./ProviderIcon";
import { PrStateChip } from "./pullRequest/PrStateChip";
import {
  createSidebarThreadHoverAnchorId,
  resolveThreadDisplayBranch,
  resolveThreadProjectLabel,
  resolveThreadStatusTrailingIndicator,
  type ThreadStatusPill,
} from "./Sidebar.logic.statusTypes";
import { resolveSidebarThreadListPaging } from "./Sidebar.logic.status";
import {
  buildActivityViewModel,
  collectActivityScopeOptions,
  collectUnreadActivityThreads,
  collectVisibleActivityThreadIds,
  groupActivityThreadsByProject,
  isThreadSettledForActivity,
  resolveActivityScope,
  splitActivityThreadsByDateBucket,
  splitRecentActivityThreads,
  type ActivityGroupMode,
  type ActivityProjectGroup,
  type ActivityScopeOption,
  type ActivityScopeSelection,
} from "./SidebarActivityView.logic";
import { SIDEBAR_TRAILING_ICON_CLASS, sidebarGlyphClass } from "./sidebarGlyphs";
import { SIDEBAR_HOVER_CARD_TRIGGER_PROPS } from "./sidebarHoverCardStyles";
import {
  createSidebarThreadRowGestures,
  type SidebarRowContextMenuPosition,
} from "./sidebarThreadRowGestures";
import { SidebarIconButton } from "./SidebarIconButton";
import { SidebarSectionToolbar } from "./SidebarSectionToolbar";
import { SidebarStatusTrailingGlyph } from "./SidebarStatusTrailingGlyph";
import { ThreadArchiveActionButton } from "./ThreadArchiveActionButton";
import { ThreadPinToggleButton } from "./ThreadPinToggleButton";
import { DisclosureChevron } from "./ui/DisclosureChevron";
import { DisclosureRegion } from "./ui/DisclosureRegion";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipTrigger } from "./ui/tooltip";

const ACTIVITY_LIST_BASE_LIMIT = 20;
const ACTIVITY_LIST_PAGE_SIZE = 20;
const EMPTY_PROJECT_GROUPS: ActivityProjectGroup[] = [];

function stopRowActivation(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function ActivityThreadRow({
  thread,
  project,
  isActive,
  isSettled,
  isPinned,
  pr,
  status,
  onOpen,
  onOpenPullRequest,
  onSetSettled,
  onTogglePinned,
  onArchive,
  onRename,
  onRenamePointerUp,
  onContextMenu,
  renderHoverCard,
}: {
  thread: SidebarThreadSummary;
  project: Project | undefined;
  isActive: boolean;
  isSettled: boolean;
  isPinned: boolean;
  pr: OrchestrationThreadPullRequest | null;
  status: ThreadStatusPill | null;
  onOpen: () => void;
  onOpenPullRequest: (event: MouseEvent<HTMLElement>, pr: OrchestrationThreadPullRequest) => void;
  onSetSettled: (settled: boolean) => void;
  onTogglePinned: () => void;
  onArchive: () => void;
  onRename: (threadId: ThreadId) => void;
  onRenamePointerUp: (event: ReactPointerEvent<HTMLElement>, threadId: ThreadId) => void;
  onContextMenu: (threadId: ThreadId, position: SidebarRowContextMenuPosition) => void;
  renderHoverCard: (anchorId: string) => ReactNode;
}) {
  const isLocalDraft = useComposerDraftStore((state) => {
    const draft = state.draftThreadsByThreadId[thread.id];
    return Boolean(draft && !draft.promotedTo);
  });
  const provider = thread.session?.provider ?? thread.modelSelection.provider;
  const branch = resolveThreadDisplayBranch(thread);
  const isWorktree =
    resolveThreadEnvironmentMode({
      envMode: thread.envMode,
      worktreePath: thread.worktreePath,
    }) === "worktree";
  const hasDraft = useComposerDraftStore((state) =>
    hasUnsentComposerDraft(state.draftsByThreadId[thread.id]),
  );
  const hoverAnchorId = createSidebarThreadHoverAnchorId({
    scope: "activity",
    threadId: thread.id,
  });
  const actionToneClassName = "text-muted-foreground/42";

  const trailingStatus = resolveThreadStatusTrailingIndicator({ status, isActive });

  const rowGestures = createSidebarThreadRowGestures({
    threadId: thread.id,
    onRename: isLocalDraft ? () => {} : onRename,
    onRenamePointerUp: isLocalDraft ? () => {} : onRenamePointerUp,
    onContextMenu: isLocalDraft ? () => {} : onContextMenu,
  });

  return (
    <Tooltip>
      <TooltipTrigger
        {...SIDEBAR_HOVER_CARD_TRIGGER_PROPS}
        render={
          <div
            data-thread-hover-anchor={hoverAnchorId}
            className="group/activity-row relative"
            data-thread-item
            data-sidebar-thread-id={thread.id}
            {...rowGestures}
          />
        }
      >
        <button
          type="button"
          onClick={onOpen}
          draggable
          onDragStart={(event) => beginThreadDrag(event, thread.id)}
          onDragEnd={endThreadDrag}
          data-testid={`activity-thread-${thread.id}`}
          className={cn(
            "flex w-full min-w-0 cursor-pointer flex-col gap-1 rounded-lg px-2.5 py-2 text-left select-none",
            SIDEBAR_ROW_FOCUS_CLASS_NAME,
            isActive ? SIDEBAR_ROW_ACTIVE_CLASS_NAME : SIDEBAR_ROW_HOVER_CLASS_NAME,
            isSettled && "opacity-55 transition-opacity hover:opacity-85",
          )}
        >
          <span
            className={cn(
              "flex min-w-0 items-center gap-1.5 overflow-hidden pr-5 transition-[padding] duration-100 ease-out",

              "group-hover/activity-row:pr-[4.25rem] group-focus-within/activity-row:pr-[4.25rem]",
            )}
          >
            <ProviderIcon
              provider={provider}
              className="size-3 shrink-0 translate-y-px"
              fallback={
                <span className="size-3 shrink-0 rounded-full border border-dashed border-muted-foreground/40" />
              }
            />
            <span
              className={cn(
                "min-w-0 shrink truncate text-ui leading-5 font-normal",
                isActive ? "text-foreground" : SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
              )}
            >
              {thread.title}
            </span>
            {hasDraft ? (
              <span
                aria-label="Unsent draft"
                title="Unsent draft"
                className="shrink-0 text-muted-foreground"
              >
                <CentralIcon name="pencil" className="size-3" />
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            {isWorktree ? (
              <WorktreeIcon
                className={sidebarGlyphClass("meta", "translate-y-px text-muted-foreground/70")}
                aria-hidden
              />
            ) : project ? (
              <ProjectSidebarIcon
                cwd={project.cwd}
                appearance={project.appearance}
                expanded={false}
                variant="favicon"
                glyphClassName={sidebarGlyphClass("meta")}
              />
            ) : (
              <FolderClosed className={sidebarGlyphClass("meta")} aria-hidden />
            )}

            <span className="min-w-0 truncate text-ui-sm text-muted-foreground/80">
              {resolveThreadProjectLabel(project)}
            </span>
            <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
              {pr ? (
                <PrStateChip
                  pr={pr}
                  className="[&_svg]:size-2.5"
                  onOpen={(event) => onOpenPullRequest(event, pr)}
                />
              ) : null}
              {branch ? (
                <span className="flex min-w-0 items-center gap-1 text-ui-sm text-muted-foreground/70">
                  <GitBranchIcon
                    className={sidebarGlyphClass("meta", "translate-y-px")}
                    aria-hidden
                  />
                  <span className="max-w-36 truncate">{branch}</span>
                </span>
              ) : null}
            </span>
          </span>
        </button>
        {trailingStatus ? (
          <span
            data-slot="activity-completion-status"
            className={cn(
              "pointer-events-none absolute top-1 right-1 inline-flex size-5 items-center justify-center",
              sidebarHoverRevealHideClassName("activity-row"),
            )}
          >
            <SidebarStatusTrailingGlyph status={trailingStatus} />
          </span>
        ) : null}
        {!isLocalDraft ? (
          <span
            className="absolute top-1 right-1 inline-flex items-center gap-1 opacity-0 transition-opacity group-hover/activity-row:opacity-100 group-focus-within/activity-row:opacity-100"
            // Double-clicking an action button toggles it twice; it must not also open the row's rename dialog.
            // Pointer-up is the touch/pen double-tap signal, so keep action taps out of that detector too.
            onDoubleClick={stopRowActivation}
            onPointerUp={(event) => event.stopPropagation()}
          >
            <ThreadPinToggleButton
              pinned={isPinned}
              presentation="inline"
              toneClassName={actionToneClassName}
              onToggle={(event) => {
                stopRowActivation(event);
                onTogglePinned();
              }}
            />
            <ThreadArchiveActionButton
              threadId={thread.id}
              toneClassName={actionToneClassName}
              onArchive={onArchive}
            />
            <SidebarIconButton
              icon={isSettled ? Undo2Icon : CircleCheckIcon}
              label={isSettled ? "Undo" : "Done"}
              title={isSettled ? "Undo" : "Done"}
              iconClassName={SIDEBAR_TRAILING_ICON_CLASS}
              className={cn("hover:text-foreground/89", actionToneClassName)}
              onMouseDown={stopRowActivation}
              onClick={(event) => {
                stopRowActivation(event);
                onSetSettled(!isSettled);
              }}
            />
          </span>
        ) : null}
      </TooltipTrigger>
      {renderHoverCard(hoverAnchorId)}
    </Tooltip>
  );
}

function ActivitySectionLabel({
  label,
  onContextMenu,
}: {
  label: string;

  onContextMenu?: (position: SidebarRowContextMenuPosition) => void;
}) {
  return (
    <div
      data-slot="activity-section-label"
      className="mb-1.5 px-2"
      {...(onContextMenu
        ? {
            onContextMenu: (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              onContextMenu({ x: event.clientX, y: event.clientY });
            },
          }
        : {})}
    >
      <span className={SIDEBAR_SECTION_LABEL_CLASS_NAME}>{label}</span>
    </div>
  );
}

function ActivityCollapsibleSection({
  label,
  open,
  onToggle,
  children,
  className,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <button
        type="button"
        className={cn(
          "flex h-7 w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-2 py-0.5",
          SIDEBAR_ROW_FOCUS_CLASS_NAME,
        )}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={cn("min-w-0 truncate", SIDEBAR_SECTION_LABEL_CLASS_NAME)}>{label}</span>
        <DisclosureChevron open={open} className="text-muted-foreground/58" />
      </button>
      <DisclosureRegion open={open}>
        <div className="flex flex-col gap-0.5 pt-0.5">{children}</div>
      </DisclosureRegion>
    </div>
  );
}

function ActivityScopeMenu({
  options,
  projectById,
  scopeSelection,
  onChangeScopeSelection,
}: {
  options: ReadonlyArray<ActivityScopeOption>;
  projectById: ReadonlyMap<ProjectId, Project>;
  scopeSelection: ActivityScopeSelection;
  onChangeScopeSelection: (selection: ActivityScopeSelection) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const scopeLabel =
    scopeSelection === null
      ? "All activity"
      : scopeSelection === "chats"
        ? "Glade"
        : resolveThreadProjectLabel(projectById.get(scopeSelection));

  return (
    <Menu onOpenChange={(open) => setMenuOpen(open)}>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Filter activity by project"
            className={cn(
              "flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md text-left",
              SIDEBAR_ROW_FOCUS_CLASS_NAME,
            )}
          />
        }
      >
        <span
          className={cn(
            "min-w-0 truncate",
            SIDEBAR_SECTION_LABEL_CLASS_NAME,
            scopeSelection !== null && "text-foreground/85",
          )}
        >
          {scopeLabel}
        </span>
        <DisclosureChevron open={menuOpen} className="text-muted-foreground/55" />
      </MenuTrigger>
      <ComposerPickerMenuPopup align="start" side="bottom" className="min-w-44">
        <MenuGroup>
          <div className="px-2 py-1 sm:text-ui leading-snug font-medium text-muted-foreground">
            Activity scope
          </div>
          <MenuRadioGroup
            value={scopeSelection ?? "all"}
            onValueChange={(value) => {
              onChangeScopeSelection(
                value === "all" ? null : value === "chats" ? "chats" : (value as ProjectId),
              );
            }}
          >
            <MenuRadioItem value="all">All activity</MenuRadioItem>
            {options.map((option) => (
              <MenuRadioItem
                key={option.kind === "project" ? option.projectId : "chats"}
                value={option.kind === "project" ? option.projectId : "chats"}
              >
                <span className="min-w-0 flex-1 truncate">
                  {option.kind === "project"
                    ? resolveThreadProjectLabel(projectById.get(option.projectId))
                    : "Glade"}
                </span>
                <span className="ml-2 shrink-0 tabular-nums text-muted-foreground/60">
                  {option.threadCount}
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

function ActivityFilterMenu({
  groupMode,
  onChangeGroupMode,
  markAllReadDisabled,
  onMarkAllRead,
}: {
  groupMode: ActivityGroupMode;
  onChangeGroupMode: (mode: ActivityGroupMode) => void;
  markAllReadDisabled: boolean;
  onMarkAllRead: () => void;
}) {
  return (
    <Menu>
      <SidebarIconButton
        icon={SortIcon}
        label="Activity options"
        tooltip="Activity options"
        tooltipSide="bottom"
        render={<MenuTrigger />}
      />
      <ComposerPickerMenuPopup align="end" side="bottom" className="min-w-44">
        <MenuGroup>
          <div className="px-2 py-1 sm:text-ui leading-snug font-medium text-muted-foreground">
            Group by
          </div>
          <MenuRadioGroup
            value={groupMode}
            onValueChange={(value) => onChangeGroupMode(value as ActivityGroupMode)}
          >
            <MenuRadioItem value="time">Time</MenuRadioItem>
            <MenuRadioItem value="project">Project</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem disabled={markAllReadDisabled} onClick={onMarkAllRead}>
          Mark all as read
        </MenuItem>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

function ActivityShowMoreRow({
  canShowMore,
  canShowLess,
  onShowMore,
  onShowLess,
}: {
  canShowMore: boolean;
  canShowLess: boolean;
  onShowMore: () => void;
  onShowLess: () => void;
}) {
  if (!canShowMore && !canShowLess) return null;
  const buttonClassName =
    "h-7 cursor-pointer rounded-lg px-2.5 text-left text-ui text-muted-foreground/79 hover:text-foreground";
  return (
    <div className="flex w-full items-center gap-1">
      {canShowMore ? (
        <button type="button" className={cn(buttonClassName, "flex-1")} onClick={onShowMore}>
          Show more
        </button>
      ) : null}
      {canShowLess ? (
        <button
          type="button"
          className={cn(buttonClassName, canShowMore ? "flex-none" : "flex-1")}
          onClick={onShowLess}
        >
          Show less
        </button>
      ) : null}
    </div>
  );
}

export function SidebarActivityView({
  threads,
  projectById,
  activeThreadId,
  pinnedThreadIdSet,
  settledOverrideByThreadId,
  threadsHydrated,
  resolveThreadStatus,
  onOpenThread,
  onOpenThreadPullRequest,
  onSetThreadSettled,
  onToggleThreadPinned,
  onArchiveThread,
  onMarkThreadRead,
  onRenameThread,
  onThreadRenamePointerUp,
  onThreadContextMenu,
  onProjectContextMenu,
  renderThreadHoverCard,
  prByThreadId,
  onVisibleThreadIdsChange,
  onCreateChat,
  onAddProject,
}: {
  threads: readonly SidebarThreadSummary[];
  projectById: ReadonlyMap<ProjectId, Project>;
  activeThreadId: ThreadId | null;
  pinnedThreadIdSet: ReadonlySet<ThreadId>;
  settledOverrideByThreadId: ReadonlyMap<ThreadId, boolean>;
  threadsHydrated: boolean;
  prByThreadId: ReadonlyMap<ThreadId, OrchestrationThreadPullRequest | null>;
  onVisibleThreadIdsChange: (threadIds: readonly ThreadId[]) => void;
  resolveThreadStatus: (thread: SidebarThreadSummary) => ThreadStatusPill | null;
  onOpenThread: (threadId: ThreadId) => void;

  onOpenThreadPullRequest: (
    event: MouseEvent<HTMLElement>,
    thread: SidebarThreadSummary,
    pr: OrchestrationThreadPullRequest,
  ) => void;
  onSetThreadSettled: (threadId: ThreadId, settled: boolean) => void;
  onToggleThreadPinned: (threadId: ThreadId) => void;
  onArchiveThread: (threadId: ThreadId) => void;

  onMarkThreadRead: (threadId: ThreadId, completedAt?: string) => void;

  onRenameThread: (threadId: ThreadId) => void;

  onThreadRenamePointerUp: (event: ReactPointerEvent<HTMLElement>, threadId: ThreadId) => void;

  onThreadContextMenu: (threadId: ThreadId, position: SidebarRowContextMenuPosition) => void;

  onProjectContextMenu: (projectId: ProjectId, position: SidebarRowContextMenuPosition) => void;

  renderThreadHoverCard: (thread: SidebarThreadSummary, anchorId: string) => ReactNode;

  onCreateChat: () => void;

  onAddProject: () => void;
}) {
  const scopeSelection = useSidebarStateStore((state) => state.activityScope);
  const setScopeSelection = useSidebarStateStore((state) => state.setActivityScope);
  const draftIds = useComposerDraftStore(
    useShallow((state) =>
      Object.entries(state.draftsByThreadId)
        .filter(([, draft]) => hasUnsentComposerDraft(draft))
        .map(([id]) => id as ThreadId),
    ),
  );
  const draftThreadIds = new Set(draftIds);
  const [groupMode, setGroupMode] = useState<ActivityGroupMode>("time");
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [earlierExtraPages, setEarlierExtraPages] = useState(0);
  const [settledOpen, setSettledOpen] = useState(false);
  const [settledExtraPages, setSettledExtraPages] = useState(0);
  const [projectExtraPagesByKey, setProjectExtraPagesByKey] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );

  const isRealProject = (projectId: ProjectId) => projectById.get(projectId)?.kind === "project";

  const scopeOptions = collectActivityScopeOptions(threads, isRealProject, draftThreadIds);
  if (
    scopeSelection &&
    scopeSelection !== "chats" &&
    projectById.has(scopeSelection) &&
    !scopeOptions.some((option) => option.kind === "project" && option.projectId === scopeSelection)
  ) {
    scopeOptions.push({ kind: "project", projectId: scopeSelection, threadCount: 0 });
  }
  const unreadThreads = collectUnreadActivityThreads(threads);

  const { scope: activeScope, projectFilterIds } = resolveActivityScope(
    scopeSelection,
    scopeOptions,
  );
  useEffect(() => {
    if (threadsHydrated && scopeSelection !== activeScope) setScopeSelection(activeScope);
  }, [activeScope, scopeSelection, setScopeSelection, threadsHydrated]);

  const model = buildActivityViewModel({
    threads,
    pinnedThreadIdSet,
    draftThreadIds,
    settledOverrideByThreadId,
    projectFilterIds,
  });
  const scopedPinnedThreads = model.pinned;

  const nowMs = Math.floor(Date.now() / 60_000) * 60_000;
  const { recent: recentThreads, rest: remainingActiveThreads } = splitRecentActivityThreads(
    model.active,
    { nowMs },
  );
  const dateBuckets = splitActivityThreadsByDateBucket(remainingActiveThreads, nowMs);
  const projectGroups =
    groupMode === "project"
      ? groupActivityThreadsByProject(model.active, isRealProject)
      : EMPTY_PROJECT_GROUPS;

  const earlierPaging = resolveSidebarThreadListPaging({
    totalCount: dateBuckets.earlier.length,
    baseLimit: ACTIVITY_LIST_BASE_LIMIT,
    pageSize: ACTIVITY_LIST_PAGE_SIZE,
    requestedExtraPages: earlierExtraPages,
  });
  const settledPaging = resolveSidebarThreadListPaging({
    totalCount: model.settled.length,
    baseLimit: ACTIVITY_LIST_BASE_LIMIT,
    pageSize: ACTIVITY_LIST_PAGE_SIZE,
    requestedExtraPages: settledExtraPages,
  });
  const pagedProjectGroups = projectGroups.map((group) => {
    const paging = resolveSidebarThreadListPaging({
      totalCount: group.threads.length,
      baseLimit: ACTIVITY_LIST_BASE_LIMIT,
      pageSize: ACTIVITY_LIST_PAGE_SIZE,
      requestedExtraPages: projectExtraPagesByKey.get(group.key) ?? 0,
    });
    return {
      group,
      paging,
      threads: group.threads.slice(0, paging.previewLimit),
    };
  });

  const ordinaryVisibleThreadIds = collectVisibleActivityThreadIds({
    groupMode,
    pinnedOpen,
    pinned: scopedPinnedThreads,
    recent: recentThreads,
    today: dateBuckets.today,
    yesterday: dateBuckets.yesterday,
    earlierOpen,
    earlier: dateBuckets.earlier.slice(0, earlierPaging.previewLimit),
    projectGroups: pagedProjectGroups.map((group) => group.threads),
    settledOpen,
    settled: model.settled.slice(0, settledPaging.previewLimit),
  });
  const revealedThread =
    activeThreadId &&
    !ordinaryVisibleThreadIds.includes(activeThreadId) &&
    !model.drafts.some((thread) => thread.id === activeThreadId)
      ? threads.find(
          (thread) =>
            thread.id === activeThreadId &&
            !thread.archivedAt &&
            (projectFilterIds === null || projectFilterIds.has(thread.projectId)),
        )
      : undefined;
  const visibleThreadIds = [
    ...new Set([
      ...(pinnedOpen ? scopedPinnedThreads.map((thread) => thread.id) : []),
      ...model.drafts.map((thread) => thread.id),
      ...(revealedThread ? [revealedThread.id] : []),
      ...ordinaryVisibleThreadIds,
    ]),
  ];
  const visibleThreadIdsFingerprint = visibleThreadIds.join("\0");
  const visibleThreadIdsRef = useRef(visibleThreadIds);
  useEffect(() => {
    visibleThreadIdsRef.current = visibleThreadIds;
  });
  useEffect(() => {
    onVisibleThreadIdsChange(visibleThreadIdsRef.current);
  }, [onVisibleThreadIdsChange, visibleThreadIdsFingerprint]);
  useEffect(
    () => () => {
      onVisibleThreadIdsChange([]);
    },
    [onVisibleThreadIdsChange],
  );

  const markAllRead = () => {
    for (const thread of unreadThreads) {
      onMarkThreadRead(thread.id, thread.latestTurn?.completedAt ?? undefined);
    }
  };

  const renderRow = (thread: SidebarThreadSummary, isSettled: boolean) => (
    <ActivityThreadRow
      key={thread.id}
      thread={thread}
      project={projectById.get(thread.projectId)}
      isActive={activeThreadId === thread.id}
      isSettled={isSettled}
      isPinned={pinnedThreadIdSet.has(thread.id)}
      pr={
        prByThreadId.has(thread.id)
          ? (prByThreadId.get(thread.id) ?? null)
          : resolveThreadPullRequestFallback({
              branch: thread.branch,
              hasDedicatedWorktree: thread.worktreePath !== null,
              lastKnownPr: thread.lastKnownPr ?? null,
            })
      }
      status={resolveThreadStatus(thread)}
      onOpen={() => onOpenThread(thread.id)}
      onOpenPullRequest={(event, pr) => onOpenThreadPullRequest(event, thread, pr)}
      onSetSettled={(settled) => {
        if (settled) onMarkThreadRead(thread.id, thread.latestTurn?.completedAt ?? undefined);
        onSetThreadSettled(thread.id, settled);
      }}
      onTogglePinned={() => onToggleThreadPinned(thread.id)}
      onArchive={() => onArchiveThread(thread.id)}
      onRename={onRenameThread}
      onRenamePointerUp={onThreadRenamePointerUp}
      onContextMenu={onThreadContextMenu}
      renderHoverCard={(anchorId) => renderThreadHoverCard(thread, anchorId)}
    />
  );
  const renderActiveRow = (thread: SidebarThreadSummary) =>
    renderRow(thread, isThreadSettledForActivity(thread, settledOverrideByThreadId));

  const isEmpty =
    model.active.length === 0 &&
    model.settled.length === 0 &&
    model.drafts.length === 0 &&
    !revealedThread &&
    scopedPinnedThreads.length === 0;
  const emptyLabel =
    activeScope === null
      ? "No activity yet"
      : activeScope === "chats"
        ? "No activity in Glade chats"
        : "No activity for this project";

  return (
    <div className="flex flex-col gap-3">
      {scopedPinnedThreads.length > 0 ? (
        <ActivityCollapsibleSection
          label="Pinned"
          open={pinnedOpen}
          onToggle={() => setPinnedOpen((open) => !open)}
        >
          {scopedPinnedThreads.map((thread) =>
            renderRow(thread, isThreadSettledForActivity(thread, settledOverrideByThreadId)),
          )}
        </ActivityCollapsibleSection>
      ) : null}

      {model.drafts.length > 0 ? (
        <div>
          <ActivitySectionLabel label="Drafts" />
          <div className="flex flex-col gap-0.5">{model.drafts.map(renderActiveRow)}</div>
        </div>
      ) : null}
      {revealedThread ? (
        <div>
          <ActivitySectionLabel label="Open chat" />
          {renderActiveRow(revealedThread)}
        </div>
      ) : null}
      <div className="group/project-header relative flex h-7 items-center gap-1 px-2 py-0.5">
        <ActivityScopeMenu
          options={scopeOptions}
          projectById={projectById}
          scopeSelection={activeScope}
          onChangeScopeSelection={setScopeSelection}
        />
        <SidebarSectionToolbar revealOnHover className="mr-0">
          <SidebarIconButton
            icon={NewThreadIcon}
            label="Start new chat in last used project"
            tooltip="New chat"
            tooltipSide="bottom"
            onClick={onCreateChat}
          />
          <SidebarIconButton
            icon={AddPlusIcon}
            label="Add project"
            tooltip="Add project"
            tooltipSide="bottom"
            onClick={onAddProject}
          />
        </SidebarSectionToolbar>
        <ActivityFilterMenu
          groupMode={groupMode}
          onChangeGroupMode={setGroupMode}
          markAllReadDisabled={unreadThreads.length === 0}
          onMarkAllRead={markAllRead}
        />
      </div>

      {isEmpty ? (
        <div className="px-2 pt-4 text-center text-ui text-muted-foreground/58">
          {threadsHydrated ? emptyLabel : "Loading activity..."}
        </div>
      ) : groupMode === "project" ? (
        pagedProjectGroups.map(({ group, paging, threads: visibleThreads }) => (
          <div key={group.key}>
            <ActivitySectionLabel
              label={
                group.kind === "chats"
                  ? "Glade"
                  : resolveThreadProjectLabel(projectById.get(group.projectId))
              }
              {...(group.kind === "project"
                ? {
                    onContextMenu: (position: SidebarRowContextMenuPosition) =>
                      onProjectContextMenu(group.projectId, position),
                  }
                : {})}
            />
            <div className="flex flex-col gap-0.5">
              {visibleThreads.map(renderActiveRow)}
              <ActivityShowMoreRow
                canShowMore={paging.canShowMore}
                canShowLess={paging.canShowLess}
                onShowMore={() => {
                  setProjectExtraPagesByKey((current) => {
                    const next = new Map(current);
                    next.set(group.key, paging.effectiveExtraPages + 1);
                    return next;
                  });
                }}
                onShowLess={() => {
                  setProjectExtraPagesByKey((current) => {
                    const next = new Map(current);
                    const extraPages = Math.max(0, paging.effectiveExtraPages - 1);
                    if (extraPages === 0) next.delete(group.key);
                    else next.set(group.key, extraPages);
                    return next;
                  });
                }}
              />
            </div>
          </div>
        ))
      ) : (
        <>
          {recentThreads.length > 0 ? (
            <div>
              <ActivitySectionLabel label="Recent" />
              <div className="flex flex-col gap-0.5">{recentThreads.map(renderActiveRow)}</div>
            </div>
          ) : null}
          {dateBuckets.today.length > 0 ? (
            <div>
              <ActivitySectionLabel label="Today" />
              <div className="flex flex-col gap-0.5">{dateBuckets.today.map(renderActiveRow)}</div>
            </div>
          ) : null}
          {dateBuckets.yesterday.length > 0 ? (
            <div>
              <ActivitySectionLabel label="Yesterday" />
              <div className="flex flex-col gap-0.5">
                {dateBuckets.yesterday.map(renderActiveRow)}
              </div>
            </div>
          ) : null}
          {dateBuckets.earlier.length > 0 ? (
            <ActivityCollapsibleSection
              label="Earlier"
              open={earlierOpen}
              onToggle={() => setEarlierOpen((open) => !open)}
            >
              {dateBuckets.earlier.slice(0, earlierPaging.previewLimit).map(renderActiveRow)}
              <ActivityShowMoreRow
                canShowMore={earlierPaging.canShowMore}
                canShowLess={earlierPaging.canShowLess}
                onShowMore={() => setEarlierExtraPages(earlierPaging.effectiveExtraPages + 1)}
                onShowLess={() =>
                  setEarlierExtraPages(Math.max(0, earlierPaging.effectiveExtraPages - 1))
                }
              />
            </ActivityCollapsibleSection>
          ) : null}
        </>
      )}

      {model.settled.length > 0 ? (
        <ActivityCollapsibleSection
          label="Done"
          open={settledOpen}
          onToggle={() => setSettledOpen((open) => !open)}
        >
          {model.settled
            .slice(0, settledPaging.previewLimit)
            .map((thread) => renderRow(thread, true))}
          <ActivityShowMoreRow
            canShowMore={settledPaging.canShowMore}
            canShowLess={settledPaging.canShowLess}
            onShowMore={() => setSettledExtraPages(settledPaging.effectiveExtraPages + 1)}
            onShowLess={() =>
              setSettledExtraPages(Math.max(0, settledPaging.effectiveExtraPages - 1))
            }
          />
        </ActivityCollapsibleSection>
      ) : null}
    </div>
  );
}
