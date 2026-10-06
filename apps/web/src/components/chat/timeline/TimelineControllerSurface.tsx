import { VisualReplyCard } from "~/components/visual-replies/VisualReplyCard";
import { Spinner } from "~/components/ui/spinner";
import { LegendList } from "@legendapp/list/react";
import {
  CHAT_COLUMN_FRAME_CLASS_NAME,
  CHAT_COLUMN_GUTTER_CLASS_NAME,
  ENVIRONMENT_CONTENT_INSET_MOTION_CLASS,
} from "~/components/chat/composerPickerStyles";
import {
  planWorkEntryRenderChunks,
  type MessagesTimelineRow,
} from "~/components/chat/MessagesTimeline.logic.rowTypes";

import { threadFindMarkdownProps } from "~/components/chat/threadFind.logic";
import {
  prefersCompactWorkEntryRow,
  TimelineWorkEntryRow,
} from "~/components/chat/TimelineWorkEntryRow";
import { ToolCallGroupSummaryRow } from "~/components/chat/ToolCallGroupSummaryRow";
import ChatMarkdown from "~/components/ChatMarkdown";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { cn } from "~/lib/utils";
import { MUTED_LABEL_TEXT_CLASS_NAME } from "~/surfaceStyles";
import { type WorkLogEntry } from "~/workLog.types";
import { renderTimelineAssistantMessage } from "./TimelineAssistantMessage";
import { TRAIL_VIEWABILITY_CONFIG, WorktreeSetupCard } from "./timelineSupport";
import { renderTimelineUserMessage } from "./TimelineUserMessage";
import type { TimelineController } from "./useTimelineController";
export function TimelineControllerSurface({ controller }: { controller: TimelineController }) {
  const {
    observeTimelineRow,
    highlightedMessageId,
    enteringMessageRowIds,
    forkDividerBeforeRowId,
    forkSourceDivider,
    appTypographyScale,
    normalizedChatFontSizePx,
    lastLiveWorkGroupId,
    toolGroupSummaryOverrides,
    setToolGroupSummaryOpen,
    chatTypographyStyle,
    findHighlight,
    workingLabel,
    worktreeSetupPendingAction,
    rows,
    canRenderForkSourceDivider,
    timelineRootRef,
    resolvedListRef,
    timelineExtraData,
    tailAnchorMessageId,
    hasInheritedTailAnchor,
    anchoredEndSpace,
    followLiveOutput,
    tailAnchorSlideInFlight,
    listFooter,
    listScrollStyle,
  } = controller.state;
  const {
    markdownCwd,
    timestampFormat,
    onImageExpand,
    getAgentActivityDetail,
    computerControlEnabled,
    onEnableComputerControl,
    activeTurnInProgress,
    isWorking,

    onResolveWorktreeSetup,
    hasMessages,
    emptyStateContent,
    onMessagesClickCapture,
    onMessagesMouseUp,
    onMessagesPointerUp,
    onTrailHighlightsChange,
    onMessagesTouchEnd,
  } = controller.props;
  const {
    handleMessagesPointerCancel,
    handleMessagesPointerDown,
    handleListScroll,
    handleViewableItemsChanged,
    handleMessagesTouchMove,
    handleMessagesTouchStart,
    handleMessagesWheel,
  } = controller.navigation;

  const renderRowContent = (row: MessagesTimelineRow) => (
    <div
      ref={observeTimelineRow}
      className={cn(
        CHAT_COLUMN_FRAME_CLASS_NAME,
        "px-1 transition-colors duration-100",
        row.kind === "working" ||
          (row.kind === "message" &&
            row.message.role === "assistant" &&
            row.assistantTurnInProgress)
          ? "pb-1"
          : row.kind === "work" ||
              (row.kind === "message" && row.message.role === "assistant") ||
              row.kind === "message-segment"
            ? "pb-2"
            : "pb-4",
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
        (row.kind === "message" || row.kind === "message-segment") &&
          row.message.id === highlightedMessageId
          ? "rounded-xl bg-[var(--color-background-elevated-secondary)]"
          : null,
        enteringMessageRowIds.has(row.id) ? "chat-message-send-enter" : null,
      )}
      data-timeline-row-kind={row.kind}
      data-message-id={
        row.kind === "message" || row.kind === "message-segment" ? row.message.id : undefined
      }
      data-message-role={
        row.kind === "message" || row.kind === "message-segment" ? row.message.role : undefined
      }
    >
      {forkDividerBeforeRowId === row.id ? forkSourceDivider : null}
      {row.kind === "visual-reply" && <VisualReplyCard reply={row.reply} activityId={row.id} />}
      {row.kind === "work" &&
        (() => {
          const groupId = row.id;

          const groupedEntries = row.groupedEntries.filter(
            (workEntry) => !workEntry.gladeThreadCreation,
          );
          if (groupedEntries.length === 0) {
            return null;
          }
          const renderEntryRow = (workEntry: WorkLogEntry) => (
            <TimelineWorkEntryRow
              key={`work-row:${workEntry.id}`}
              workEntry={workEntry}
              chatMetaFontSizePx={appTypographyScale.chatMetaPx}
              textFontSizePx={normalizedChatFontSizePx}
              density={prefersCompactWorkEntryRow(workEntry) ? "compact" : "default"}
              markdownCwd={markdownCwd}
              onImageExpand={onImageExpand}
              activityDetail={getAgentActivityDetail?.(workEntry.id)}
              {...(computerControlEnabled !== undefined ? { computerControlEnabled } : {})}
              {...(onEnableComputerControl ? { onEnableComputerControl } : {})}
              timestampFormat={timestampFormat}
            />
          );
          const isLiveGroup =
            groupId === lastLiveWorkGroupId && (activeTurnInProgress || isWorking);
          const renderChunks = planWorkEntryRenderChunks(groupedEntries, {
            tailIsLive: isLiveGroup,
          });
          if (renderChunks.some((chunk) => chunk.summary !== null)) {
            return (
              <div>
                <div className="space-y-0.5">
                  {renderChunks.map((chunk) => {
                    const summary = chunk.summary;
                    if (!summary) return chunk.entries.map(renderEntryRow);
                    const summaryKey = `${groupId}:${chunk.id}`;
                    return (
                      <ToolCallGroupSummaryRow
                        key={`tool-summary:${groupId}:${chunk.id}`}
                        summary={summary}
                        live={chunk.live}
                        open={toolGroupSummaryOverrides[summaryKey] ?? chunk.live}
                        onToggle={(open) => setToolGroupSummaryOpen(summaryKey, open)}
                        fontSizePx={normalizedChatFontSizePx}
                        renderChildren={() => (
                          <div className="space-y-0.5 pt-0.5">
                            {chunk.entries.map(renderEntryRow)}
                          </div>
                        )}
                      />
                    );
                  })}
                </div>
              </div>
            );
          }
          return <div className="space-y-0.5">{groupedEntries.map(renderEntryRow)}</div>;
        })()}

      {row.kind === "message-segment" &&
        (() => {
          const segmentText =
            row.message.textSegments?.[row.segmentIndex]?.text ?? row.message.text;
          if (segmentText.trim().length === 0) {
            return null;
          }
          return (
            <div
              className="chat-message-segment flex flex-col gap-1.5 pl-[2px] pr-[2px]"
              data-chat-find-document-id={row.message.id}
              data-chat-find-segment-index={row.segmentIndex}
            >
              <div className={MUTED_LABEL_TEXT_CLASS_NAME}>
                <ChatMarkdown
                  text={segmentText}
                  cwd={markdownCwd}
                  isStreaming={false}
                  style={chatTypographyStyle}
                  onImageExpand={onImageExpand}
                  {...threadFindMarkdownProps(findHighlight, row.message.id, row.segmentIndex)}
                />
              </div>
            </div>
          );
        })()}
      {row.kind === "message" &&
        row.message.role === "user" &&
        renderTimelineUserMessage(controller, row)}

      {row.kind === "message" &&
        row.message.role === "assistant" &&
        renderTimelineAssistantMessage(controller, row)}

      {row.kind === "working" && (
        <div
          className={cn(
            "flex items-center gap-2 pt-0.5 font-system-ui",
            MUTED_LABEL_TEXT_CLASS_NAME,
          )}
          style={{ fontSize: `${appTypographyScale.chatPx}px` }}
        >
          <Spinner variant="working" aria-hidden="true" className="size-3.5" />
          {workingLabel}
        </div>
      )}

      {row.kind === "worktree-setup" && (
        <DisclosureRegion open={row.open}>
          <div className="pt-0.5 pb-1">
            <WorktreeSetupCard
              steps={row.steps}
              pendingAction={worktreeSetupPendingAction}
              onResolve={onResolveWorktreeSetup}
            />
          </div>
        </DisclosureRegion>
      )}
    </div>
  );

  const hasRenderableTranscriptContent =
    hasMessages || rows.length > 0 || canRenderForkSourceDivider;

  if (!hasRenderableTranscriptContent && !isWorking) {
    if (emptyStateContent) {
      return <div className="flex h-full items-center justify-center">{emptyStateContent}</div>;
    }
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-ui leading-snug text-muted-foreground/30">
          Send a message to start the conversation.
        </p>
      </div>
    );
  }

  return (
    <div ref={timelineRootRef} className="contents" data-messages-timeline-root="true">
      <LegendList<MessagesTimelineRow>
        ref={resolvedListRef}
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => renderRowContent(item)}
        estimatedItemSize={90}
        extraData={timelineExtraData}
        initialScrollAtEnd={tailAnchorMessageId === null || hasInheritedTailAnchor}
        {...(anchoredEndSpace ? { anchoredEndSpace } : {})}
        maintainScrollAtEnd={followLiveOutput && !tailAnchorSlideInFlight}
        maintainScrollAtEndThreshold={0.1}
        {...(!followLiveOutput
          ? { maintainVisibleContentPosition: true }
          : tailAnchorMessageId !== null
            ? { maintainVisibleContentPosition: false }
            : {})}
        onClickCapture={onMessagesClickCapture}
        onMouseUp={onMessagesMouseUp}
        onPointerCancel={handleMessagesPointerCancel}
        onPointerDown={handleMessagesPointerDown}
        onPointerUp={onMessagesPointerUp}
        onScroll={handleListScroll}
        {...(onTrailHighlightsChange
          ? {
              onViewableItemsChanged: handleViewableItemsChanged,
              viewabilityConfig: TRAIL_VIEWABILITY_CONFIG,
            }
          : {})}
        onTouchEnd={onMessagesTouchEnd}
        onTouchMove={handleMessagesTouchMove}
        onTouchStart={handleMessagesTouchStart}
        onWheel={handleMessagesWheel}
        data-chat-scroll-container="true"
        // LegendList sets overflow inline, overriding the transcript CSS.
        showsHorizontalScrollIndicator={false}
        ListFooterComponent={listFooter}
        className={cn(
          "h-full overscroll-y-contain py-3 [scrollbar-gutter:stable] sm:py-4",
          "scroll-fade-y transcript-scroll-fade",
          ENVIRONMENT_CONTENT_INSET_MOTION_CLASS,
          CHAT_COLUMN_GUTTER_CLASS_NAME,
        )}
        {...(listScrollStyle ? { style: listScrollStyle } : {})}
      />
    </div>
  );
}
