import type { AgentActivityDetail } from "~/components/chat/agentActivity.logic";
import {
  BotIcon,
  AlertCircleIcon,
  CircleCheckIcon,
  CornerDownRightIcon,
  GitForkIcon,
} from "~/lib/icons";
import type { IconComponent } from "~/lib/iconComponent";
import { Spinner } from "~/components/ui/spinner";
import { ThreadId, type MessageId, type TurnId } from "@glade/contracts/core/baseSchemas";
import { type EditorId } from "@glade/contracts/settings/editor";
import { type ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { type ComponentProps, type ReactNode, type RefObject } from "react";
import { type TimestampFormat } from "~/appSettings";
import { type CrossTaskOrigin } from "~/components/chat/CrossTaskOriginLabel";
import { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import { type ForkSourceReference } from "~/components/chat/ForkSourceDivider";
import {
  type CollapsedTurnItem,
  type MessagesTimelineRow,
} from "~/components/chat/MessagesTimeline.logic.rowTypes";
import { type ActiveTrailSnapshot } from "~/components/chat/messageTrail.logic";
import { type ThreadFindHighlight, type ThreadFindMatch } from "~/components/chat/threadFind.logic";
import { resolveUserTurnMarker, type UserTurnMarkerKind } from "~/components/chat/userTurnMarker";
import type { WorkingLabel } from "~/components/ChatView.logic.dispatch";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import {
  type TurnDiffSummary,
  type WorktreeSetupResolutionAction,
  type WorktreeSetupSnapshot,
  type WorktreeSetupStep,
} from "~/types";
import { deriveTimelineEntries } from "~/workLog.timeline";
import { UI_MOTION_LONG_MS } from "~/lib/uiMotion";
export const MAX_VISIBLE_INLINE_TOOL_ENTRIES = 4;
export const EMPTY_EDITOR_KEYBINDINGS: ResolvedKeybindingsConfig = [];
export const EMPTY_AVAILABLE_EDITORS: ReadonlyArray<EditorId> = [];
export const MAX_VISIBLE_CHANGED_FILES = 5;
export const BOTTOM_CONTENT_INSET_PX = 64;
export const MESSAGE_HOVER_REVEAL_CLASS_NAME =
  "opacity-0 transition-opacity pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto";
export const JUMP_HIGHLIGHT_DURATION_MS = 1200;
export const FIND_FINE_SCROLL_RETRY_TIMEOUT_MS = 900;
export const FIND_FINE_SCROLL_MAX_RETRY_FRAMES = 90;
export const MESSAGE_SEND_ENTER_ANIMATION_MS = UI_MOTION_LONG_MS;
export const MESSAGE_SEND_ENTER_CLEANUP_BUFFER_MS = 60;
export const TRAIL_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 0,
} as const;
export const EMPTY_MESSAGE_ID_SET: ReadonlySet<MessageId> = new Set();
export function scrollLegendListToEnd(listRef: RefObject<LegendListRef | null>): void {
  void listRef.current?.scrollToEnd?.({
    animated: false,
  });
}
export function scrollLegendListToIndex(
  listRef: RefObject<LegendListRef | null>,
  params: Parameters<LegendListRef["scrollToIndex"]>[0],
): void {
  void listRef.current?.scrollToIndex(params);
}
export function readLegendListState(
  listRef: RefObject<LegendListRef | null>,
): ReturnType<NonNullable<LegendListRef["getState"]>> | undefined {
  return listRef.current?.getState?.();
}
export interface MessagesTimelineController {
  scrollToMessage: (
    messageId: MessageId,
    options?: {
      segmentIndex?: number;
      fineScrollFind?: boolean;
    },
  ) => void;
  setActiveFindMatch: (match: ThreadFindMatch | null) => void;
}
const USER_TURN_MARKER_PRESENTATION: Record<
  UserTurnMarkerKind,
  {
    readonly Icon: IconComponent;
    readonly label: string;
  }
> = {
  agent: {
    Icon: BotIcon,
    label: "Sent by agent",
  },
  steer: {
    Icon: CornerDownRightIcon,
    label: "Steering conversation",
  },
};
export function UserDispatchModeChip({
  dispatchMode,
  dispatchOrigin,
  hasLeadingMedia,
}: {
  dispatchMode: TimelineMessage["dispatchMode"];
  dispatchOrigin: TimelineMessage["dispatchOrigin"];
  hasLeadingMedia: boolean;
}) {
  const markerKind = resolveUserTurnMarker({
    dispatchMode,
    dispatchOrigin,
  });
  if (!markerKind) {
    return null;
  }
  const { Icon, label } = USER_TURN_MARKER_PRESENTATION[markerKind];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 self-end px-0 text-ui-sm font-normal tracking-[0.01em] text-muted-foreground/78",
        hasLeadingMedia ? "mb-3" : "mb-1.5",
      )}
    >
      <Icon className="size-3 shrink-0 text-muted-foreground/75" />
      <span>{label}</span>
    </div>
  );
}
export function cssAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
export function getMonotonicTimeMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
function WorktreeSetupStepGlyph({ status }: { status: WorktreeSetupStep["status"] }) {
  if (status === "done") {
    return <CircleCheckIcon className="size-2.5 text-[var(--color-text-foreground)]" />;
  }
  if (status === "active") {
    return <Spinner variant="working" className="size-2.5 text-[var(--color-text-foreground)]" />;
  }
  if (status === "error") {
    return <AlertCircleIcon className="size-2.5 text-destructive" />;
  }
  return <span className="block size-2 rounded-full border border-[color:var(--color-border)]" />;
}
export function WorktreeSetupCard({
  steps,
  pendingAction,
  onResolve,
}: {
  steps: ReadonlyArray<WorktreeSetupStep>;
  pendingAction?: WorktreeSetupResolutionAction | null | undefined;
  onResolve?: ((action: WorktreeSetupResolutionAction) => void) | undefined;
}) {
  const canResolve =
    onResolve !== undefined &&
    steps.every((step) => step.status !== "error") &&
    !steps.some((step) => step.id === "start-session" && step.status !== "pending");
  return (
    <div className="w-fit max-w-full rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-primary)] px-3.5 py-3 font-system-ui shadow-xs">
      <div className="flex items-center gap-2">
        <GitForkIcon className="size-3.5 shrink-0 text-[var(--color-text-foreground-tertiary)]" />
        <span className="inline-flex items-center gap-2 text-ui-lg font-medium text-[var(--color-text-foreground-secondary)]">
          <Spinner variant="working" aria-hidden="true" className="size-3.5" />
          Preparing worktree...
        </span>
      </div>
      <ol className="mt-2 flex flex-col">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <li key={step.id} className="relative flex items-center gap-2.5 py-[3px]">
              {isLast ? null : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-[6.5px] top-1/2 h-full w-px",
                    step.status === "done"
                      ? "bg-[var(--color-text-foreground)]"
                      : "bg-[color:var(--color-border)]",
                  )}
                />
              )}
              <span className="relative z-10 flex size-3.5 shrink-0 items-center justify-center rounded-full bg-[var(--color-background-elevated-primary)]">
                <WorktreeSetupStepGlyph status={step.status} />
              </span>
              <span
                className={cn(
                  "text-ui-lg leading-5",
                  step.status === "active" || step.status === "done"
                    ? "text-[var(--color-text-foreground)]"
                    : step.status === "error"
                      ? "text-destructive"
                      : "text-[var(--color-text-foreground-tertiary)] opacity-70",
                )}
              >
                {step.label}
                {step.status === "error" ? " — failed" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {canResolve ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button
            size="xs"
            variant="outline"
            disabled={pendingAction != null}
            onClick={() => onResolve("work-locally")}
          >
            {pendingAction === "work-locally" ? "Switching to local..." : "Work locally"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={pendingAction != null}
            onClick={() => onResolve("cancel")}
          >
            {pendingAction === "cancel" ? "Cancelling..." : "Cancel"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
export interface MessagesTimelineProps {
  hasMessages: boolean;
  isWorking: boolean;
  workingLabel?: WorkingLabel | undefined;
  activeTurnInProgress: boolean;
  worktreeSetup?: WorktreeSetupSnapshot | null;
  worktreeSetupPendingAction?: WorktreeSetupResolutionAction | null;
  onResolveWorktreeSetup?: (action: WorktreeSetupResolutionAction) => void;
  followLiveOutput?: boolean;
  emptyStateContent?: ReactNode;
  listRef?: RefObject<LegendListRef | null>;
  controllerRef?: RefObject<MessagesTimelineController | null>;
  pinnedMessageIds?: ReadonlySet<MessageId>;
  onTogglePinMessage?: (messageId: MessageId) => void;
  onForkFromMessage?: (messageId: MessageId) => void;
  forkProvider?: "codex" | "claudeAgent";
  enteringUserMessageIds?: ReadonlySet<MessageId>;
  tailAnchorMessageId?: MessageId | null;
  tailAnchorScrollInFlightRef?: RefObject<boolean> | undefined;
  crossTaskOrigin?: CrossTaskOrigin | null;
  forkSource?: ForkSourceReference | null;
  handoffSource?: ForkSourceReference | null;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  messageChangeSignal?: unknown;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  expandedWorkGroups?: Record<string, boolean>;
  onToggleWorkGroup?: (groupId: string) => void;
  getAgentActivityDetail?: (activityId: string) => AgentActivityDetail | undefined;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onOpenThread?: (threadId: ThreadId) => void;
  computerControlEnabled?: boolean;
  onEnableComputerControl?: () => void;
  onUndoTurnFiles?: (turnCounts: readonly number[]) => void;
  onRespondToAsyncUserInput?: (messageId: MessageId, answers: readonly string[]) => Promise<void>;
  onEditUserMessage?: (messageId: MessageId, text: string) => boolean | Promise<boolean>;
  // The timeline must not re-derive this from its own rows: they are createdAt-sorted and include
  // optimistic/filtered entries, so a row-derived target can point at a message the server rejects.
  editableUserMessageId?: MessageId | null;
  activeTurnId?: TurnId | null;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onIsAtEndChange?: (isAtEnd: boolean) => void;
  onNavigate?: () => void;
  onTrailHighlightsChange?: (snapshot: ActiveTrailSnapshot) => void;
  onMessagesClickCapture?: ComponentProps<typeof LegendList>["onClickCapture"];
  onMessagesMouseUp?: ComponentProps<typeof LegendList>["onMouseUp"];
  onMessagesPointerCancel?: ComponentProps<typeof LegendList>["onPointerCancel"];
  onMessagesPointerDown?: ComponentProps<typeof LegendList>["onPointerDown"];
  onMessagesPointerUp?: ComponentProps<typeof LegendList>["onPointerUp"];
  onMessagesScroll?: ComponentProps<typeof LegendList>["onScroll"];
  onMessagesTouchEnd?: ComponentProps<typeof LegendList>["onTouchEnd"];
  onMessagesTouchMove?: ComponentProps<typeof LegendList>["onTouchMove"];
  onMessagesTouchStart?: ComponentProps<typeof LegendList>["onTouchStart"];
  onMessagesWheel?: ComponentProps<typeof LegendList>["onWheel"];
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  chatFontSizePx?: number;
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  keybindings?: ResolvedKeybindingsConfig;
  availableEditors?: ReadonlyArray<EditorId>;
  contentInsetRightPx?: number | undefined;
  contentInsetBottomPx?: number | undefined;
  contentInsetBottomClearancePx?: number | undefined;
  findHighlight?: ThreadFindHighlight | null;
}
export type TimelineMessage = Extract<
  MessagesTimelineRow,
  {
    kind: "message";
  }
>["message"];
export type SettledTurnCollapseTransition = {
  open: boolean;
  items: readonly CollapsedTurnItem[];
};
export type SettledTurnCollapseTimer = {
  closeFrame: number | null;
  cleanupTimeout: number | null;
};
