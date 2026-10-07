import { SquarePenIcon } from "~/lib/icons";
import { AssistantSelectionsSummaryChip } from "~/components/chat/AssistantSelectionsSummaryChip";
import {
  USER_MESSAGE_BUBBLE_BORDER_CLASS_NAME,
  USER_MESSAGE_BUBBLE_RADIUS_CLASS_NAME,
  USER_MESSAGE_BUBBLE_SHELL_CHROME_CLASS_NAME,
} from "~/components/chat/chatTypography";
import { CrossTaskOriginLabel } from "~/components/chat/CrossTaskOriginLabel";
import { FileAttachmentChip } from "~/components/chat/FileAttachmentChip";
import { FileCommentsSummaryChip } from "~/components/chat/FileCommentsSummaryChip";
import {
  MESSAGE_ACTION_ICON_CLASS_NAME,
  MessageActionButton,
} from "~/components/chat/MessageActionButton";
import { MessageCopyButton } from "~/components/chat/MessageCopyButton";
import { type MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic.rowTypes";
import { UserMessagePastedTextCard } from "~/components/chat/PastedTextChip";
import { threadFindMarkdownProps } from "~/components/chat/threadFind.logic";
import { hasLeadingUserMedia } from "~/components/chat/userTurnMarker";
import { deriveDisplayedUserMessageState } from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import {
  UserImageAttachmentThumbnail,
  UserMessageBody,
  UserMessageCollapsibleText,
  UserMessageEditForm,
} from "./TimelineMessageContent";
import {
  MESSAGE_HOVER_REVEAL_CLASS_NAME,
  TimelineMessage,
  UserDispatchModeChip,
} from "./timelineSupport";
import type { TimelineController } from "./useTimelineController";
export function renderTimelineUserMessage(
  controller: TimelineController,
  row: Extract<
    MessagesTimelineRow,
    {
      kind: "message";
    }
  >,
) {
  const {
    expandedUserMessagesById,
    editingUserMessageId,
    submittingEditedUserMessageId,
    crossTaskOrigin,
    firstUserMessageId,
    userMessageTypographyStyle,
    normalizedChatFontSizePx,
    setExpandedUserMessagesById,
    findHighlight,
    chatMessageFooterStyle,
  } = controller.state;
  const {
    onEditUserMessage,
    onOpenThread,
    onImageExpand,
    resolvedTheme,
    isRevertingCheckpoint,
    markdownCwd,
    timestampFormat,
  } = controller.props;
  const {
    latestEditableUserMessageId,
    tailContentRowId,
    scrollTailExpansionToEnd,
    ignoreTimelineImageLoad,
  } = controller.navigation;
  const { cancelUserMessageEdit, submitUserMessageEdit, startUserMessageEdit } = controller.actions;
  return (() => {
    const userImages = (row.message.attachments ?? []).filter(
      (
        attachment,
      ): attachment is Extract<
        NonNullable<TimelineMessage["attachments"]>[number],
        {
          type: "image";
        }
      > => attachment.type === "image",
    );
    const assistantSelections = (row.message.attachments ?? []).filter(
      (
        attachment,
      ): attachment is Extract<
        NonNullable<TimelineMessage["attachments"]>[number],
        {
          type: "assistant-selection";
        }
      > => attachment.type === "assistant-selection",
    );
    const userFiles = (row.message.attachments ?? []).filter(
      (
        attachment,
      ): attachment is Extract<
        NonNullable<TimelineMessage["attachments"]>[number],
        {
          type: "file";
        }
      > => attachment.type === "file",
    );
    const displayedUserMessage = deriveDisplayedUserMessageState(row.message.text, {
      hideImageOnlyBootstrapPrompt:
        userImages.length > 0 || userFiles.length > 0 || assistantSelections.length > 0,
    });
    const renderedAssistantSelections =
      assistantSelections.length > 0
        ? assistantSelections
        : displayedUserMessage.assistantSelections.map((selection, index) => ({
            type: "assistant-selection" as const,
            id: `fallback-selection-${row.message.id}-${index}`,
            assistantMessageId: selection.assistantMessageId,
            text: selection.text,
          }));
    const terminalContexts = displayedUserMessage.contexts;
    const renderedFileComments = displayedUserMessage.fileComments;
    const renderedPastedTexts = displayedUserMessage.pastedTexts;
    const renderedPullRequestContexts = displayedUserMessage.pullRequestContexts;
    const userMessageText = displayedUserMessage.visibleText;
    const userMessageExpanded = expandedUserMessagesById[row.message.id] ?? false;
    const showUserText = userMessageText.trim().length > 0 || terminalContexts.length > 0;
    const isEditingThisMessage = editingUserMessageId === row.message.id;
    const isSubmittingThisEdit = submittingEditedUserMessageId === row.message.id;
    const showEditUserMessage =
      Boolean(onEditUserMessage) &&
      row.message.id === latestEditableUserMessageId &&
      displayedUserMessage.copyText.trim().length > 0;
    const hasLeadingMedia = hasLeadingUserMedia({
      imageCount: userImages.length,
      fileCount: userFiles.length,
      assistantSelectionCount: renderedAssistantSelections.length,
      fileCommentCount: renderedFileComments.length,
      pastedTextCount: renderedPastedTexts.length,
      pullRequestContextCount: renderedPullRequestContexts.length,
    });
    const isTailContentRow = row.id === tailContentRowId;
    const showCrossTaskOrigin = crossTaskOrigin !== null && row.message.id === firstUserMessageId;
    return (
      <div className="flex w-full flex-col gap-3">
        {showCrossTaskOrigin ? (
          <CrossTaskOriginLabel
            origin={crossTaskOrigin}
            {...(onOpenThread
              ? {
                  onOpenSourceThread: onOpenThread,
                }
              : {})}
          />
        ) : null}
        <div className="flex w-full justify-end">
          <div
            className={cn(
              "group flex flex-col items-end gap-px",
              isEditingThisMessage ? "w-full max-w-full" : "max-w-[80%]",
            )}
          >
            {}
            {/* The cross-task origin label already attributes this turn to another Glade thread, so suppress the
             dispatch chip here to avoid a duplicate "Sent by …" marker. */}
            {showCrossTaskOrigin ? null : (
              <UserDispatchModeChip
                dispatchMode={row.message.dispatchMode}
                dispatchOrigin={row.message.dispatchOrigin}
                hasLeadingMedia={hasLeadingMedia}
              />
            )}
            {renderedAssistantSelections.length > 0 && (
              <div className="mb-1 flex max-w-[240px] flex-wrap justify-end gap-1.5 self-end">
                <AssistantSelectionsSummaryChip selections={renderedAssistantSelections} />
              </div>
            )}
            {renderedFileComments.length > 0 && (
              <div className="mb-1 flex max-w-[240px] flex-wrap justify-end gap-1.5 self-end">
                <FileCommentsSummaryChip comments={renderedFileComments} />
              </div>
            )}
            {renderedPastedTexts.length > 0 && (
              <div className="mb-1 flex max-w-full flex-col items-end gap-1.5 self-end">
                {renderedPastedTexts.map((pasted) => (
                  <UserMessagePastedTextCard
                    key={pasted.index}
                    text={pasted.text}
                    metrics={{
                      lineCount: pasted.lineCount,
                      charCount: pasted.charCount,
                    }}
                  />
                ))}
              </div>
            )}
            {renderedPullRequestContexts.length > 0 && (
              <div className="mb-1 flex max-w-full flex-col items-end gap-1.5 self-end">
                {renderedPullRequestContexts.map((context) => (
                  <p key={context.index} className="whitespace-pre-wrap text-chat">
                    {context.text}
                  </p>
                ))}
              </div>
            )}
            {userFiles.length > 0 && (
              <div className="mb-1 flex max-w-[280px] flex-wrap justify-end gap-1.5 self-end">
                {userFiles.map((file) => (
                  <FileAttachmentChip key={file.id} file={file} />
                ))}
              </div>
            )}
            {userImages.length > 0 && (
              <div
                className={cn(
                  "flex max-w-[240px] flex-wrap justify-end gap-2 self-end",
                  showUserText && "mb-1",
                )}
              >
                {userImages.map((image) => (
                  <UserImageAttachmentThumbnail
                    key={image.id}
                    image={image}
                    userImages={userImages}
                    onImageExpand={onImageExpand}
                    onTimelineImageLoad={
                      isTailContentRow ? scrollTailExpansionToEnd : ignoreTimelineImageLoad
                    }
                    resolvedTheme={resolvedTheme}
                  />
                ))}
              </div>
            )}
            {isEditingThisMessage ? (
              <UserMessageEditForm
                key={row.message.id}
                initialValue={displayedUserMessage.copyText}
                disabled={isSubmittingThisEdit || isRevertingCheckpoint}
                chatTypographyStyle={userMessageTypographyStyle}
                borderClassName={USER_MESSAGE_BUBBLE_BORDER_CLASS_NAME}
                onCancel={cancelUserMessageEdit}
                onSubmit={(text) => void submitUserMessageEdit(row.message.id, text)}
              />
            ) : showUserText ? (
              <div
                className={cn(
                  "w-max max-w-full min-w-0 self-end bg-[var(--app-user-message-background)]",
                  USER_MESSAGE_BUBBLE_RADIUS_CLASS_NAME,
                  USER_MESSAGE_BUBBLE_BORDER_CLASS_NAME,
                  USER_MESSAGE_BUBBLE_SHELL_CHROME_CLASS_NAME,
                )}
                data-chat-find-document-id={row.message.id}
              >
                <UserMessageCollapsibleText
                  text={userMessageText}
                  expanded={userMessageExpanded}
                  chatFontSizePx={normalizedChatFontSizePx}
                  onToggle={() => {
                    setExpandedUserMessagesById((previous) => ({
                      ...previous,
                      [row.message.id]: !(previous[row.message.id] ?? false),
                    }));
                  }}
                >
                  <UserMessageBody
                    text={userMessageText}
                    mentionReferences={row.message.mentions ?? []}
                    terminalContexts={terminalContexts}
                    chatTypographyStyle={userMessageTypographyStyle}
                    resolvedTheme={resolvedTheme}
                    markdownCwd={markdownCwd}
                    {...threadFindMarkdownProps(findHighlight, row.message.id)}
                  />
                </UserMessageCollapsibleText>
              </div>
            ) : null}
            {!isEditingThisMessage && (
              <div
                className="flex items-center justify-end gap-2 pr-0.5 font-system-ui font-normal text-muted-foreground/45"
                style={chatMessageFooterStyle}
              >
                <p className={cn("tabular-nums", MESSAGE_HOVER_REVEAL_CLASS_NAME)}>
                  {formatDayAwareTimestamp(row.message.createdAt, timestampFormat)}
                </p>
                <div className="flex items-center">
                  {displayedUserMessage.copyText && (
                    <MessageCopyButton
                      text={displayedUserMessage.copyText}
                      className={MESSAGE_HOVER_REVEAL_CLASS_NAME}
                    />
                  )}
                  {showEditUserMessage && (
                    <MessageActionButton
                      label="Edit message"
                      tooltip="Edit and resend"
                      disabled={isRevertingCheckpoint}
                      className={cn(
                        MESSAGE_HOVER_REVEAL_CLASS_NAME,
                        "disabled:text-muted-foreground/35",
                      )}
                      onClick={() => startUserMessageEdit(row.message.id)}
                    >
                      <SquarePenIcon className={MESSAGE_ACTION_ICON_CLASS_NAME} />
                    </MessageActionButton>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  })();
}
