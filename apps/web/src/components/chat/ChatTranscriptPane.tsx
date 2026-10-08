import { ArrowDown02Icon } from "~/lib/icons";
import { type MessageId, type ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import { type LegendListRef } from "@legendapp/list/react";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type RefObject,
  type TouchEventHandler,
  type WheelEventHandler,
} from "react";
import { type TimestampFormat } from "../../appSettings";
import { type TurnDiffSummary, type WorktreeSetupSnapshot } from "../../types";
import { cn } from "~/lib/utils";
import { ELEVATED_HOVER_SURFACE_CLASS_NAME } from "~/surfaceStyles";
import { DISCLOSURE_CONTENT_MOTION_CLASS } from "~/lib/disclosureMotion";
import { type ExpandedImagePreview } from "./ExpandedImagePreview";
import { ChatEmptyStateHero } from "./ChatEmptyStateHero";
import { MessagesTimeline } from "./MessagesTimeline";
import type { MessagesTimelineController } from "./timeline/timelineSupport";
import { composerOverlayAffordanceBottomPx } from "./composerOverlay";
import { MessageTrail } from "./MessageTrail";
import { createActiveTrailStore, deriveMessageTrailItems } from "./messageTrail.logic";
import { createThreadFindHighlightStore, type ThreadFindHighlightStore } from "./threadFind.logic";
interface ChatTranscriptPaneProps {
  activeThreadId: string;
  activeTurnId?: TurnId | null;
  activeTurnInProgress: boolean;
  contentInsetRightPx?: ComponentProps<typeof MessagesTimeline>["contentInsetRightPx"];
  contentInsetBottomPx?: ComponentProps<typeof MessagesTimeline>["contentInsetBottomPx"];
  contentInsetBottomClearancePx?: ComponentProps<
    typeof MessagesTimeline
  >["contentInsetBottomClearancePx"];
  chatFontSizePx: number;
  emptyStateContent?: ReactNode;
  emptyStateProjectName: string | undefined;
  hasMessages: boolean;
  isRevertingCheckpoint: boolean;
  isWorking: boolean;
  workingLabel?: ComponentProps<typeof MessagesTimeline>["workingLabel"];
  followLiveOutput: boolean;
  listRef: RefObject<LegendListRef | null>;
  timelineControllerRef?: RefObject<MessagesTimelineController | null>;
  pinnedMessageIds?: ReadonlySet<MessageId>;
  onTogglePinMessage?: (messageId: MessageId) => void;
  onForkFromMessage?: (messageId: MessageId) => void;
  forkProvider?: "codex" | "claudeAgent";
  enteringUserMessageIds?: ComponentProps<typeof MessagesTimeline>["enteringUserMessageIds"];
  tailAnchorMessageId?: ComponentProps<typeof MessagesTimeline>["tailAnchorMessageId"];
  tailAnchorScrollInFlightRef?: ComponentProps<
    typeof MessagesTimeline
  >["tailAnchorScrollInFlightRef"];
  crossTaskOrigin?: ComponentProps<typeof MessagesTimeline>["crossTaskOrigin"];
  forkSource?: ComponentProps<typeof MessagesTimeline>["forkSource"];
  handoffSource?: ComponentProps<typeof MessagesTimeline>["handoffSource"];
  markdownCwd: string | undefined;
  onExpandTimelineImage: (preview: ExpandedImagePreview) => void;
  onMessagesClickCapture: MouseEventHandler<HTMLDivElement>;
  onMessagesMouseUp: MouseEventHandler<HTMLDivElement>;
  onMessagesPointerCancel: PointerEventHandler<HTMLDivElement>;
  onMessagesPointerDown: PointerEventHandler<HTMLDivElement>;
  onMessagesPointerUp: PointerEventHandler<HTMLDivElement>;
  onMessagesScroll: ComponentProps<typeof MessagesTimeline>["onMessagesScroll"];
  onMessagesTouchEnd: TouchEventHandler<HTMLDivElement>;
  onMessagesTouchMove: TouchEventHandler<HTMLDivElement>;
  onMessagesTouchStart: TouchEventHandler<HTMLDivElement>;
  onMessagesWheel: WheelEventHandler<HTMLDivElement>;
  onIsAtEndChange: (isAtEnd: boolean) => void;
  onNavigate?: () => void;
  getAgentActivityDetail?: ComponentProps<typeof MessagesTimeline>["getAgentActivityDetail"];
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onOpenThread: (threadId: ThreadId) => void;
  onUndoTurnFiles?: ComponentProps<typeof MessagesTimeline>["onUndoTurnFiles"];
  onRespondToAsyncUserInput?: ComponentProps<typeof MessagesTimeline>["onRespondToAsyncUserInput"];
  onEditUserMessage?: (messageId: MessageId, text: string) => boolean | Promise<boolean>;
  editableUserMessageId?: MessageId | null;
  onScrollToBottom: () => void;
  resolvedTheme: "light" | "dark";
  scrollButtonVisible: boolean;
  timelineEntries: ComponentProps<typeof MessagesTimeline>["timelineEntries"];
  messageChangeSignal?: ComponentProps<typeof MessagesTimeline>["messageChangeSignal"];
  timestampFormat: TimestampFormat;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  workspaceRoot: string | undefined;
  keybindings?: ComponentProps<typeof MessagesTimeline>["keybindings"];
  availableEditors?: ComponentProps<typeof MessagesTimeline>["availableEditors"];
  worktreeSetup: WorktreeSetupSnapshot | null;
  worktreeSetupPendingAction?: ComponentProps<
    typeof MessagesTimeline
  >["worktreeSetupPendingAction"];
  onResolveWorktreeSetup?: ComponentProps<typeof MessagesTimeline>["onResolveWorktreeSetup"];
  turnFailureRecovery?: ComponentProps<typeof MessagesTimeline>["turnFailureRecovery"];
  findHighlightStore?: ThreadFindHighlightStore | null;
}
export function ChatTranscriptPane({
  activeThreadId,
  activeTurnId,
  activeTurnInProgress,
  contentInsetRightPx,
  contentInsetBottomPx,
  contentInsetBottomClearancePx,
  chatFontSizePx,
  emptyStateContent,
  emptyStateProjectName,
  hasMessages,
  isRevertingCheckpoint,
  isWorking,
  workingLabel,
  followLiveOutput,
  listRef,
  timelineControllerRef,
  pinnedMessageIds,
  onTogglePinMessage,
  onForkFromMessage,
  forkProvider,
  enteringUserMessageIds,
  tailAnchorMessageId,
  tailAnchorScrollInFlightRef,
  crossTaskOrigin,
  forkSource,
  handoffSource,
  markdownCwd,
  onExpandTimelineImage,
  onMessagesClickCapture,
  onMessagesMouseUp,
  onMessagesPointerCancel,
  onMessagesPointerDown,
  onMessagesPointerUp,
  onMessagesScroll,
  onMessagesTouchEnd,
  onMessagesTouchMove,
  onMessagesTouchStart,
  onMessagesWheel,
  onIsAtEndChange,
  onNavigate,
  getAgentActivityDetail,
  onOpenTurnDiff,
  onOpenThread,
  onUndoTurnFiles,
  onEditUserMessage,
  onRespondToAsyncUserInput,
  editableUserMessageId,
  onScrollToBottom,
  resolvedTheme,
  scrollButtonVisible,
  timelineEntries,
  messageChangeSignal,
  timestampFormat,
  turnDiffSummaryByAssistantMessageId,
  workspaceRoot,
  keybindings,
  availableEditors,
  worktreeSetup,
  worktreeSetupPendingAction,
  onResolveWorktreeSetup,
  turnFailureRecovery,
  findHighlightStore: findHighlightStoreProp,
}: ChatTranscriptPaneProps) {
  const scrollButtonFrameStyle: CSSProperties | undefined =
    contentInsetRightPx || contentInsetBottomPx
      ? {
          ...(contentInsetRightPx
            ? {
                paddingRight: contentInsetRightPx,
              }
            : {}),
          ...(contentInsetBottomPx
            ? {
                bottom: composerOverlayAffordanceBottomPx(contentInsetBottomPx),
              }
            : {}),
        }
      : undefined;

  // Current + visible highlights are pushed up from MessagesTimeline as the viewport scrolls. They
  // flow through a stable store (not pane state) so scroll updates re-render only the trail, not the
  // memoized timeline; reset on thread switch so stale highlights can't linger.
  const trailItems = deriveMessageTrailItems(timelineEntries);
  const [activeTrailStore] = useState(() => createActiveTrailStore());
  const [fallbackFindHighlightStore] = useState(() => createThreadFindHighlightStore());
  const findHighlightStore = findHighlightStoreProp ?? fallbackFindHighlightStore;
  const findHighlight = useSyncExternalStore(
    findHighlightStore.subscribe,
    findHighlightStore.get,
    findHighlightStore.get,
  );
  useEffect(() => {
    activeTrailStore.set(null);
  }, [activeThreadId, activeTrailStore]);
  const handleTrailSelect = (messageId: MessageId) => {
    timelineControllerRef?.current?.scrollToMessage(messageId);
  };
  return (
    <div
      data-chat-transcript-pane="true"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">
          <MessagesTimeline
            key={activeThreadId}
            hasMessages={hasMessages}
            isWorking={isWorking}
            {...(workingLabel
              ? {
                  workingLabel,
                }
              : {})}
            worktreeSetup={worktreeSetup}
            worktreeSetupPendingAction={worktreeSetupPendingAction ?? null}
            {...(onResolveWorktreeSetup
              ? {
                  onResolveWorktreeSetup,
                }
              : {})}
            turnFailureRecovery={turnFailureRecovery ?? null}
            activeTurnId={activeTurnId ?? null}
            activeTurnInProgress={activeTurnInProgress}
            listRef={listRef}
            {...(timelineControllerRef
              ? {
                  controllerRef: timelineControllerRef,
                }
              : {})}
            {...(pinnedMessageIds
              ? {
                  pinnedMessageIds,
                }
              : {})}
            {...(onTogglePinMessage
              ? {
                  onTogglePinMessage,
                }
              : {})}
            {...(onForkFromMessage
              ? {
                  onForkFromMessage,
                }
              : {})}
            {...(forkProvider
              ? {
                  forkProvider,
                }
              : {})}
            {...(enteringUserMessageIds
              ? {
                  enteringUserMessageIds,
                }
              : {})}
            tailAnchorMessageId={tailAnchorMessageId ?? null}
            {...(tailAnchorScrollInFlightRef
              ? {
                  tailAnchorScrollInFlightRef,
                }
              : {})}
            {...(crossTaskOrigin
              ? {
                  crossTaskOrigin,
                }
              : {})}
            {...(forkSource
              ? {
                  forkSource,
                }
              : {})}
            {...(handoffSource
              ? {
                  handoffSource,
                }
              : {})}
            timelineEntries={timelineEntries}
            messageChangeSignal={messageChangeSignal}
            turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
            onOpenTurnDiff={onOpenTurnDiff}
            onOpenThread={onOpenThread}
            {...(onUndoTurnFiles
              ? {
                  onUndoTurnFiles,
                }
              : {})}
            {...(onEditUserMessage
              ? {
                  onEditUserMessage,
                }
              : {})}
            {...(onRespondToAsyncUserInput
              ? {
                  onRespondToAsyncUserInput,
                }
              : {})}
            editableUserMessageId={editableUserMessageId ?? null}
            isRevertingCheckpoint={isRevertingCheckpoint}
            onImageExpand={onExpandTimelineImage}
            followLiveOutput={followLiveOutput}
            onIsAtEndChange={onIsAtEndChange}
            {...(onNavigate
              ? {
                  onNavigate,
                }
              : {})}
            onTrailHighlightsChange={activeTrailStore.set}
            onMessagesScroll={onMessagesScroll}
            onMessagesClickCapture={onMessagesClickCapture}
            onMessagesMouseUp={onMessagesMouseUp}
            onMessagesWheel={onMessagesWheel}
            onMessagesPointerDown={onMessagesPointerDown}
            onMessagesPointerUp={onMessagesPointerUp}
            onMessagesPointerCancel={onMessagesPointerCancel}
            onMessagesTouchStart={onMessagesTouchStart}
            onMessagesTouchMove={onMessagesTouchMove}
            onMessagesTouchEnd={onMessagesTouchEnd}
            markdownCwd={markdownCwd}
            resolvedTheme={resolvedTheme}
            chatFontSizePx={chatFontSizePx}
            timestampFormat={timestampFormat}
            workspaceRoot={workspaceRoot}
            {...(keybindings
              ? {
                  keybindings,
                }
              : {})}
            {...(availableEditors
              ? {
                  availableEditors,
                }
              : {})}
            contentInsetRightPx={contentInsetRightPx}
            contentInsetBottomPx={contentInsetBottomPx}
            contentInsetBottomClearancePx={contentInsetBottomClearancePx}
            {...(getAgentActivityDetail
              ? {
                  getAgentActivityDetail,
                }
              : {})}
            findHighlight={findHighlight}
            emptyStateContent={
              emptyStateContent === undefined ? (
                <ChatEmptyStateHero projectName={emptyStateProjectName} />
              ) : (
                emptyStateContent
              )
            }
          />
        </div>

        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center py-1",
            DISCLOSURE_CONTENT_MOTION_CLASS,
            scrollButtonVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
          )}
          style={scrollButtonFrameStyle}
        >
          <button
            type="button"
            onClick={onScrollToBottom}
            data-scroll-anchor-ignore
            aria-label="Scroll to bottom"
            aria-hidden={!scrollButtonVisible}
            tabIndex={scrollButtonVisible ? 0 : -1}
            className={cn(
              "flex size-8 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)] text-[var(--color-text-foreground)] backdrop-blur-md hover:cursor-pointer",
              ELEVATED_HOVER_SURFACE_CLASS_NAME,
              scrollButtonVisible ? "pointer-events-auto" : "pointer-events-none",
            )}
          >
            <ArrowDown02Icon className="size-3.5" />
          </button>
        </div>

        <MessageTrail
          items={trailItems}
          contentInsetRightPx={contentInsetRightPx}
          activeStore={activeTrailStore}
          onSelect={handleTrailSelect}
        />
      </div>
    </div>
  );
}
