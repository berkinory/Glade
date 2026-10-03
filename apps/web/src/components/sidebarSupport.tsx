import {
  ChatBubbleIcon,
  CircleQuestionIcon,
  GiftIcon,
  KeyboardIcon,
  BellIcon,
  type LucideIcon,
  WorktreeIcon,
} from "~/lib/icons";
import { createCentralIconComponent } from "~/lib/central-icons";
import { GoRepoForked } from "react-icons/go";
import { useEffect, lazy, useState, type ComponentType, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";
import { WS_GITHUB_PROJECT_PROVISIONING_CAPABILITY } from "@glade/contracts/transport/ws/wsCompatibility";
import { type SidebarProjectSortOrder } from "../appSettings";
import { shortcutLabelForCommand, threadJumpCommandForIndex } from "../keybindings";
import { onNativeApiServerCapabilitiesChange, readNativeApiServerCapability } from "../nativeApi";
import { resolveThreadEnvironmentPresentation } from "../lib/threadEnvironment";
import { type Thread } from "../types";
import { SidebarIconButton, sidebarIconButtonSlotClass } from "./SidebarIconButton";
import { SidebarGlyph, sidebarGlyphClass } from "./sidebarGlyphs";
import { type SidebarThreadTerminalStatus } from "./SidebarThreadRowContent";
import ReleaseHistoryDialog from "./ReleaseHistoryDialog";
import { CHANGELOG_ENTRIES } from "../whatsNew/changelog";
import { sortEntriesByVersionDesc } from "../whatsNew/logic";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY,
  type SidebarActionBadge,
  shouldShowDebugFeatureFlagsMenu,
} from "./Sidebar.logic.statusTypes";
import { cn } from "~/lib/utils";
import { sidebarHoverRevealHideClassName, SIDEBAR_ROW_FOCUS_CLASS_NAME } from "../sidebarRowStyles";
import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import {
  SIDEBAR_CONTEXT_MENU_ICON_CLASS_NAME,
  SIDEBAR_CONTEXT_MENU_ITEM_CLASS_NAME,
  SIDEBAR_CONTEXT_MENU_PANEL_CLASS_NAME,
  SidebarContextMenuIcon,
} from "./sidebarContextMenuStyles";

export const ExpandAllIcon = createCentralIconComponent("expand-45");

export const CollapseAllIcon = createCentralIconComponent("minimize-45");

const SortFilterIcon = createCentralIconComponent("filter-2");

export const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

export const subscribeGitHubProvisioningCapability = (listener: () => void) =>
  onNativeApiServerCapabilitiesChange(listener);

export const readGitHubProvisioningCapability = () =>
  readNativeApiServerCapability(WS_GITHUB_PROJECT_PROVISIONING_CAPABILITY);

export const readGitHubProvisioningServerCapability = () => false;

export const THREAD_PREVIEW_LIMIT = 5;

export const THREAD_PREVIEW_PAGE_SIZE = 5;

export const preventFocusOnMouseDown = (event: React.MouseEvent) => {
  event.preventDefault();
};

const SIDEBAR_SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  manual: "Manual",
};

export const EMPTY_THREAD_JUMP_LABELS = new Map<ThreadId, string>();

export const ADD_PROJECT_SNAPSHOT_CATCH_UP_MAX_ATTEMPTS = 6;

export const ADD_PROJECT_SNAPSHOT_CATCH_UP_DELAY_MS = 50;

export const GITHUB_CANCEL_RECOVERY_MAX_ATTEMPTS = 40;

export const GITHUB_CANCEL_RECOVERY_DELAY_MS = 250;

export const DebugFeatureFlagsMenu = import.meta.env.DEV
  ? lazy(() =>
      import("./DebugFeatureFlagsMenu").then((module) => ({
        default: module.DebugFeatureFlagsMenu,
      })),
    )
  : null;

export type ProjectContextMenuId =
  | "open-in-finder"
  | "copy-path"
  | "relocate"
  | "rename"
  | "toggle-pin"
  | "archive-threads"
  | "delete-threads"
  | "delete";

export type ProjectContextMenuState = {
  projectId: ProjectId;
  position: { x: number; y: number };
};

export const PROJECT_CONTEXT_MENU_PANEL_CLASS_NAME = SIDEBAR_CONTEXT_MENU_PANEL_CLASS_NAME;

export const PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME = SIDEBAR_CONTEXT_MENU_ITEM_CLASS_NAME;

export const PROJECT_CONTEXT_MENU_ICON_CLASS_NAME = SIDEBAR_CONTEXT_MENU_ICON_CLASS_NAME;

export function ProjectContextMenuIcon({ icon }: { icon: LucideIcon }) {
  return <SidebarContextMenuIcon icon={icon} />;
}

export type DebugFeatureFlagsWindow = Window & {
  gladeShowFeatureFlags?: () => void;
  gladeHideFeatureFlags?: () => void;
};

export function readDebugFeatureFlagsMenuVisibility(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return shouldShowDebugFeatureFlagsMenu({
      isDev: import.meta.env.DEV,
      hostname: window.location.hostname,
      storageValue: window.localStorage.getItem(DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY),
    });
  } catch {
    return false;
  }
}

export function threadJumpLabelMapsEqual(
  left: ReadonlyMap<ThreadId, string>,
  right: ReadonlyMap<ThreadId, string>,
): boolean {
  if (left === right) {
    return true;
  }
  if (left.size !== right.size) {
    return false;
  }
  for (const [threadId, label] of left) {
    if (right.get(threadId) !== label) {
      return false;
    }
  }
  return true;
}

export function buildThreadJumpLabelMap(input: {
  keybindings: ResolvedKeybindingsConfig;
  platform: string;
  terminalOpen: boolean;
  threadJumpCommandByThreadId: ReadonlyMap<
    ThreadId,
    NonNullable<ReturnType<typeof threadJumpCommandForIndex>>
  >;
}): ReadonlyMap<ThreadId, string> {
  if (input.threadJumpCommandByThreadId.size === 0) {
    return EMPTY_THREAD_JUMP_LABELS;
  }

  const shortcutLabelOptions = {
    platform: input.platform,
    context: {
      terminalFocus: false,
      terminalOpen: input.terminalOpen,
    },
  } as const;
  const mapping = new Map<ThreadId, string>();
  for (const [threadId, command] of input.threadJumpCommandByThreadId) {
    const label = shortcutLabelForCommand(input.keybindings, command, shortcutLabelOptions);
    if (label) {
      mapping.set(threadId, label);
    }
  }
  return mapping.size > 0 ? mapping : EMPTY_THREAD_JUMP_LABELS;
}

function WorktreeBadgeGlyph({ className }: { className?: string }) {
  return <WorktreeIcon aria-hidden="true" className={sidebarGlyphClass("meta", className)} />;
}

export const THREAD_ROW_META_CHIP_HOVER_FADE_CLASS_NAME = cn(
  "flex shrink-0 items-center",
  sidebarHoverRevealHideClassName("thread-row"),
);

export function threadRowStatusSlotClassName(
  isSubagentThread: boolean,
  toneClassName?: string,
): string {
  return cn(
    "flex w-[15px] shrink-0 items-center justify-center leading-none tabular-nums",
    sidebarHoverRevealHideClassName("thread-row"),
    isSubagentThread ? "text-ui-xs" : "text-[length:calc(var(--app-font-size-ui-meta,11px)+0.5px)]",
    toneClassName ?? (isSubagentThread ? "text-muted-foreground/26" : "text-muted-foreground/38"),
  );
}

function resolveWorktreeBadgeLabel(
  thread: Pick<Thread, "envMode" | "worktreePath">,
): string | null {
  return resolveThreadEnvironmentPresentation({
    envMode: thread.envMode,
    worktreePath: thread.worktreePath,
  }).worktreeBadgeLabel;
}

export type ThreadMetaChip = {
  id: "fork" | "worktree";
  tooltip: string;
  icon: ReactNode;
};

export function resolveThreadRowMetaChips(input: {
  thread: Pick<Thread, "forkSourceThreadId" | "envMode" | "worktreePath">;
}): ThreadMetaChip[] {
  const chips: ThreadMetaChip[] = [];

  if (input.thread.forkSourceThreadId) {
    chips.push({
      id: "fork",
      tooltip: "Forked thread",
      icon: (
        <SidebarGlyph
          icon={GoRepoForked}
          variant="meta"
          className="text-emerald-600 dark:text-emerald-300/90"
        />
      ),
    });
  }

  const worktreeBadgeLabel = resolveWorktreeBadgeLabel(input.thread);
  if (worktreeBadgeLabel) {
    chips.push({
      id: "worktree",
      tooltip: worktreeBadgeLabel,
      icon: <WorktreeBadgeGlyph className="text-muted-foreground/55" />,
    });
  }

  return chips;
}

export function terminalStatusFromThreadState(input: {
  runningTerminalIds: string[];
  terminalAttentionStatesById: Record<string, "attention" | "review">;
}): SidebarThreadTerminalStatus | null {
  const terminalAttentionStates = Object.values(input.terminalAttentionStatesById ?? {});
  if (terminalAttentionStates.includes("attention")) {
    return {
      label: "Terminal input needed",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      pulse: false,
    };
  }
  if ((input.runningTerminalIds?.length ?? 0) > 0) {
    return {
      label: "Terminal process running",
      colorClass: "text-teal-600 dark:text-teal-300/90",
      pulse: true,
    };
  }
  if (terminalAttentionStates.includes("review")) {
    return {
      label: "Terminal task completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      pulse: false,
    };
  }
  return null;
}

export type SortableProjectHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

export function ProjectSortMenu({
  projectSortOrder,
  onProjectSortOrderChange,
}: {
  projectSortOrder: SidebarProjectSortOrder;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
}) {
  return (
    <Menu>
      <SidebarIconButton
        render={<MenuTrigger />}
        icon={SortFilterIcon}
        label="Sort projects"
        tooltip="Sort projects"
        tooltipSide="right"
      />
      <ComposerPickerMenuPopup align="end" side="bottom" className="min-w-44">
        <MenuGroup>
          <div className="px-2 py-1 sm:text-ui leading-snug font-medium text-muted-foreground">
            Sort projects
          </div>
          <MenuRadioGroup
            value={projectSortOrder}
            onValueChange={(value) => {
              onProjectSortOrderChange(value as SidebarProjectSortOrder);
            }}
          >
            {(Object.entries(SIDEBAR_SORT_LABELS) as Array<[SidebarProjectSortOrder, string]>).map(
              ([value, label]) => (
                <MenuRadioItem key={value} value={value}>
                  {label}
                </MenuRadioItem>
              ),
            )}
          </MenuRadioGroup>
        </MenuGroup>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

const HELP_MENU_RELEASE_ENTRIES = sortEntriesByVersionDesc(CHANGELOG_ENTRIES).slice(0, 3);

export function SidebarHelpMenu({
  onOpenShortcuts,
  onOpenFeedback,
}: {
  onOpenShortcuts: () => void;
  onOpenFeedback: () => void;
}) {
  const [releaseHistory, setReleaseHistory] = useState<{
    readonly open: boolean;
    readonly version: string | null;
    readonly openCount: number;
  }>({ open: false, version: null, openCount: 0 });

  const openReleaseHistory = (version: string | null) => {
    setReleaseHistory((prev) => ({ open: true, version, openCount: prev.openCount + 1 }));
  };

  return (
    <>
      <Menu>
        <SidebarIconButton
          render={<MenuTrigger />}
          icon={CircleQuestionIcon}
          label="Help"
          tooltip="Help"
        />
        <ComposerPickerMenuPopup align="end" side="top" className="w-64 min-w-64">
          <MenuGroup>
            <div className="px-2 py-1 sm:text-ui leading-snug font-medium text-muted-foreground">
              What’s new
            </div>
            {HELP_MENU_RELEASE_ENTRIES.map((entry) => (
              <MenuItem
                key={entry.version}
                className={SIDEBAR_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() => openReleaseHistory(entry.version)}
              >
                <span className="min-w-0 flex-1 truncate">Version {entry.version}</span>
                <span className="shrink-0 text-[var(--color-text-foreground-secondary)] tabular-nums">
                  {entry.date}
                </span>
              </MenuItem>
            ))}
            <MenuItem
              className={SIDEBAR_CONTEXT_MENU_ITEM_CLASS_NAME}
              onClick={() => openReleaseHistory(null)}
            >
              <SidebarContextMenuIcon icon={GiftIcon} />
              <span>Full changelog</span>
            </MenuItem>
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuItem className={SIDEBAR_CONTEXT_MENU_ITEM_CLASS_NAME} onClick={onOpenShortcuts}>
              <SidebarContextMenuIcon icon={KeyboardIcon} />
              <span>Keyboard shortcuts</span>
            </MenuItem>
            <MenuItem className={SIDEBAR_CONTEXT_MENU_ITEM_CLASS_NAME} onClick={onOpenFeedback}>
              <SidebarContextMenuIcon icon={ChatBubbleIcon} />
              <span>Send feedback</span>
            </MenuItem>
          </MenuGroup>
        </ComposerPickerMenuPopup>
      </Menu>
      <ReleaseHistoryDialog
        key={releaseHistory.openCount}
        open={releaseHistory.open}
        onOpenChange={(open) => {
          setReleaseHistory((prev) => ({ ...prev, open }));
        }}
        defaultExpandedVersion={releaseHistory.version}
      />
    </>
  );
}

export type SidebarNavItemDescriptor = {
  readonly icon: ComponentType<{ className?: string }>;
  readonly iconClassName?: string;
  readonly label: string;
  readonly active: boolean;
  readonly badge: SidebarActionBadge | null;
  readonly onClick: () => void;
  readonly onMouseEnter?: () => void;
  readonly onFocus?: () => void;
};

export function SortableProjectItem({
  projectId,
  disabled: disabledProp,
  children,
}: {
  projectId: ProjectId;
  disabled?: boolean;
  children: (handleProps: SortableProjectHandleProps) => React.ReactNode;
}) {
  const disabled = disabledProp ?? false;
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: projectId, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

const ACTIVITY_ONBOARDING_STORAGE_KEY = "glade:activity-onboarding:v1";

const ACTIVITY_ONBOARDING_DURATION_MS = 8_000;

function shouldShowActivityOnboarding(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ACTIVITY_ONBOARDING_STORAGE_KEY) !== "seen";
  } catch {
    return true;
  }
}

export function SidebarActivityBellButton({
  active,
  showUnreadDot,
  shortcutLabel,
  onClick,
}: {
  active: boolean;
  showUnreadDot: boolean;
  shortcutLabel: string | null;
  onClick: () => void;
}) {
  const [onboardingVisible, setOnboardingVisible] = useState(shouldShowActivityOnboarding);
  const [tooltipOpen, setTooltipOpen] = useState(onboardingVisible);

  useEffect(() => {
    if (!onboardingVisible) return;
    try {
      window.localStorage.setItem(ACTIVITY_ONBOARDING_STORAGE_KEY, "seen");
    } catch {}
    const timeout = window.setTimeout(() => {
      setOnboardingVisible(false);
      setTooltipOpen(false);
    }, ACTIVITY_ONBOARDING_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [onboardingVisible]);

  const dismissOnboarding = () => {
    setOnboardingVisible(false);
    setTooltipOpen(false);
  };

  return (
    <Tooltip
      open={tooltipOpen}
      onOpenChange={(open) => {
        if (onboardingVisible && !open) return;
        setTooltipOpen(open);
      }}
    >
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={active ? "Switch to classic view" : "Switch to activity view"}
            aria-pressed={active}
            onClick={() => {
              dismissOnboarding();
              onClick();
            }}
            className={cn(
              "relative inline-flex shrink-0 cursor-pointer items-center justify-center transition-colors",
              sidebarIconButtonSlotClass("header"),
              SIDEBAR_ROW_FOCUS_CLASS_NAME,
              active
                ? "bg-[color-mix(in_srgb,var(--color-text-accent)_15%,transparent)] text-[var(--color-text-accent)]"
                : "sidebar-icon-button text-muted-foreground/75 hover:text-foreground",
            )}
          />
        }
      >
        <BellIcon className={sidebarGlyphClass("leading")} />
        {showUnreadDot ? (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-[var(--color-text-accent)] ring-2 ring-[var(--sidebar-background,var(--background))]"
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup
        side={onboardingVisible ? "right" : "bottom"}
        align={onboardingVisible ? "start" : "center"}
        sideOffset={onboardingVisible ? 8 : 4}
        className={cn(
          onboardingVisible &&
            "max-w-64 border-[var(--color-text-accent)] bg-[var(--color-text-accent)] text-white shadow-lg",
        )}
        viewportClassName={cn(onboardingVisible && "px-3 py-2.5")}
      >
        {onboardingVisible ? (
          <div className="text-left">
            <div className="text-ui leading-snug font-semibold">Activity</div>
            <div className="mt-0.5 text-ui-sm leading-4 text-white/85">
              See running tasks, completed work, and anything that needs your attention.
            </div>
          </div>
        ) : (
          `Activity view${shortcutLabel ? ` (${shortcutLabel})` : ""}`
        )}
      </TooltipPopup>
    </Tooltip>
  );
}
