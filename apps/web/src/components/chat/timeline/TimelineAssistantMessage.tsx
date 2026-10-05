import { PlusMinusSquare01Icon, WorkflowCircle04Icon, PinIcon, UndoIcon } from "~/lib/icons";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { pluralize } from "@glade/shared/text/text";
import { AsyncUserInputCard } from "~/components/chat/AsyncUserInputCard";
import { DiffStatLabel } from "~/components/chat/DiffStatLabel";
import { EditedFileRow } from "~/components/chat/EditedFileRow";
import { GladeThreadCreationCard } from "~/components/chat/GladeThreadCreationCard";
import {
  MESSAGE_ACTION_ICON_CLASS_NAME,
  MessageActionButton,
} from "~/components/chat/MessageActionButton";
import { MessageCopyButton } from "~/components/chat/MessageCopyButton";
import {
  capOpenWorkEntryRenderChunks,
  chunkCollapsedTurnItems,
  isFoldedWorkEntryChunk,
  planWorkEntryRenderChunks,
  resolveAssistantMessageCopyState,
  resolveAssistantMessageDisplayText,
  resolveWorkEntryChunkFold,
  type CollapsedTurnChunk,
  type CollapsedTurnItem,
  type MessagesTimelineRow,
} from "~/components/chat/MessagesTimeline.logic.rowTypes";
import { ReviewChangesButton } from "~/components/chat/ReviewChangesButton";
import { threadFindMarkdownProps } from "~/components/chat/threadFind.logic";
import {
  EditedFileRowContent,
  prefersCompactWorkEntryRow,
  TimelineWorkEntryRow,
} from "~/components/chat/TimelineWorkEntryRow";
import { summarizeToolCallGroup } from "~/components/chat/toolCallGroup.logic";
import { ToolCallGroupSummaryRow } from "~/components/chat/ToolCallGroupSummaryRow";
import ChatMarkdown from "~/components/ChatMarkdown";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { disclosureContentClassName } from "~/lib/disclosureMotion";
import { pinActionLabel } from "~/lib/pin";
import { cn } from "~/lib/utils";
import { MUTED_LABEL_TEXT_CLASS_NAME } from "~/surfaceStyles";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { isFileChangeWorkLogEntry, type WorkLogEntry } from "~/workLog.types";
import { MAX_VISIBLE_CHANGED_FILES, MAX_VISIBLE_INLINE_TOOL_ENTRIES } from "./timelineSupport";
import { collectAbsoluteFilePathsFromWorkEntries } from "./timelineTransitions";
import type { TimelineController } from "./useTimelineController";
export function renderTimelineAssistantMessage(
  controller: TimelineController,
  row: Extract<
    MessagesTimelineRow,
    {
      kind: "message";
    }
  >,
) {
  const {
    expandedWorkGroupsState,
    expandedCollapsedWork,
    settledTurnCollapseTransitions,
    appTypographyScale,
    normalizedChatFontSizePx,
    lastLiveWorkGroupId,
    toolGroupSummaryOverrides,
    setToolGroupSummaryOpen,
    handleToggleWorkGroup,
    chatTypographyStyle,
    findHighlight,
    setCollapsedWorkExpanded,
    expandedFileChangesByTurnId,
    expandedFileListByTurnId,
    editorKeybindings,
    installedEditors,
    chatMessageFooterStyle,
  } = controller.state;
  const {
    activeTurnInProgress,
    pinnedMessageIds,
    onTogglePinMessage,
    onForkFromMessage,
    timestampFormat,
    markdownCwd,
    onImageExpand,
    onOpenTurnDiff,
    getAgentActivityDetail,
    computerControlEnabled,
    onEnableComputerControl,
    isWorking,
    onRespondToAsyncUserInput,
    onOpenThread,
    onUndoTurnFiles,
    workspaceRoot,
    resolvedTheme,
  } = controller.props;
  const { tailContentRowId, scrollTailExpansionToEnd } = controller.navigation;
  const { toggleFileChangesExpanded, toggleFileListExpanded } = controller.actions;
  return (() => {
    const messageText = resolveAssistantMessageDisplayText(row);
    const buildWorkDisplay = (workEntries: WorkLogEntry[], workGroupId: string | null) => {
      const displayEntries = workEntries.filter((entry) => !entry.gladeThreadCreation);
      const toolEntries = displayEntries.filter((entry) => entry.tone === "tool");
      const statusEntries = displayEntries.filter((entry) => entry.tone !== "tool");
      const toolGroupId = toolEntries.length > 0 ? workGroupId : null;
      const toolExpanded =
        toolGroupId !== null ? (expandedWorkGroupsState[toolGroupId] ?? false) : false;
      const visibleToolEntries =
        toolExpanded || toolEntries.length <= MAX_VISIBLE_INLINE_TOOL_ENTRIES
          ? toolEntries
          : activeTurnInProgress
            ? toolEntries.slice(-MAX_VISIBLE_INLINE_TOOL_ENTRIES)
            : toolEntries.slice(0, MAX_VISIBLE_INLINE_TOOL_ENTRIES);
      const hasGenericFileChangeEntry = toolEntries.some(
        (workEntry) =>
          isFileChangeWorkLogEntry(workEntry) && (workEntry.changedFiles?.length ?? 0) === 0,
      );
      const isRenderableToolEntry = (workEntry: WorkLogEntry) =>
        !(
          hasGenericFileChangeEntry &&
          isFileChangeWorkLogEntry(workEntry) &&
          (workEntry.changedFiles?.length ?? 0) === 0
        );
      return {
        toolEntries,
        statusEntries,
        toolGroupId,
        toolExpanded,
        orderedRenderableEntries: displayEntries.filter(isRenderableToolEntry),
        renderableToolEntries: toolEntries.filter(isRenderableToolEntry),
        visibleRenderableToolEntries: visibleToolEntries.filter(isRenderableToolEntry),
        hiddenToolCount: toolEntries.length - visibleToolEntries.length,
        hasGenericFileChangeEntry,
      };
    };
    const leadingWorkDisplay = buildWorkDisplay(
      row.leadingWorkEntries ?? [],
      row.leadingWorkGroupId ?? null,
    );
    const inlineWorkDisplay = buildWorkDisplay(
      row.inlineWorkEntries ?? [],
      row.inlineWorkGroupId ?? null,
    );
    const assistantCopyState = resolveAssistantMessageCopyState({
      text: row.message.text ?? null,
      showCopyButton: row.showAssistantCopyButton,
      streaming: row.assistantCopyStreaming,
    });
    const messagePinned = pinnedMessageIds?.has(row.message.id) ?? false;
    const showPinToggle =
      Boolean(onTogglePinMessage) && (assistantCopyState.visible || messagePinned);
    const showForkAction =
      Boolean(onForkFromMessage) &&
      assistantCopyState.visible &&
      Boolean(
        controller.props.forkProvider === "codex"
          ? row.message.turnId
          : row.message.providerMessageId,
      );
    const turnSummary = row.assistantTurnDiffSummary;
    const fileDiffStatByPath = new Map(
      (turnSummary?.files ?? []).map((file) => [
        file.path,
        {
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
        },
      ]),
    );
    const inlineEditedFilesFromTurnSummary =
      (leadingWorkDisplay.hasGenericFileChangeEntry ||
        inlineWorkDisplay.hasGenericFileChangeEntry) &&
      (turnSummary?.files.length ?? 0) > 0
        ? turnSummary!.files
        : [];
    const isTerminalAssistantMessage = row.showAssistantCopyButton && !row.assistantTurnInProgress;
    const assistantMeta = [
      isTerminalAssistantMessage
        ? formatDayAwareTimestamp(row.message.createdAt, timestampFormat)
        : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" • ");
    const allTurnWorkEntries = [
      ...(row.leadingWorkEntries ?? []),
      ...(row.inlineWorkEntries ?? []),
      ...(row.collapsedTurnItems ?? []).flatMap((item) =>
        item.kind === "work" ? [item.entry] : [],
      ),
    ];
    const knownAbsoluteFilePaths = collectAbsoluteFilePathsFromWorkEntries(allTurnWorkEntries);
    const gladeThreadCreationRecaps = [
      ...new Map(
        allTurnWorkEntries.flatMap((entry) =>
          entry.gladeThreadCreation
            ? [[entry.gladeThreadCreation.operationId, entry.gladeThreadCreation] as const]
            : [],
        ),
      ).values(),
    ];
    const collapsedComputerActionEntries = [
      ...new Map(
        (row.collapsedTurnItems ?? []).flatMap((item) =>
          item.kind === "work" &&
          (item.entry.computerSetupRequired || item.entry.computerControlDenied)
            ? [[item.entry.computerSetupRequired ? "setup" : "denied", item.entry] as const]
            : [],
        ),
      ).values(),
    ];
    const collapsedTurnItems = row.collapsedTurnItems?.filter(
      (item) =>
        item.kind !== "work" ||
        !(
          item.entry.gladeThreadCreation ||
          item.entry.computerSetupRequired ||
          item.entry.computerControlDenied
        ),
    );
    const hasCollapsedWork = Boolean(collapsedTurnItems && collapsedTurnItems.length > 0);
    const isCollapsedWorkExpanded = hasCollapsedWork
      ? (expandedCollapsedWork[row.message.id] ?? false)
      : false;
    const settledCollapseTransition = isCollapsedWorkExpanded
      ? undefined
      : settledTurnCollapseTransitions[row.message.id];
    const isTailContentRow = row.id === tailContentRowId;
    const renderWorkDisplay = (
      display: typeof leadingWorkDisplay,
      placement: "leading" | "inline",
    ) => {
      const renderInlineToolRow = (workEntry: WorkLogEntry) => (
        <TimelineWorkEntryRow
          key={`${placement}-tool-row:${row.message.id}:${workEntry.id}`}
          workEntry={workEntry}
          chatMetaFontSizePx={appTypographyScale.chatMetaPx}
          textFontSizePx={normalizedChatFontSizePx}
          density="compact"
          fileDiffStatByPath={fileDiffStatByPath}
          markdownCwd={markdownCwd}
          onImageExpand={onImageExpand}
          onOpenTurnDiff={onOpenTurnDiff}
          activityDetail={getAgentActivityDetail?.(workEntry.id)}
          {...(computerControlEnabled !== undefined
            ? {
                computerControlEnabled,
              }
            : {})}
          {...(onEnableComputerControl
            ? {
                onEnableComputerControl,
              }
            : {})}
          {...(turnSummary?.turnId
            ? {
                turnId: turnSummary.turnId,
              }
            : {})}
          timestampFormat={timestampFormat}
        />
      );
      const isLiveGroup =
        display.toolGroupId !== null &&
        display.toolGroupId === lastLiveWorkGroupId &&
        (activeTurnInProgress || isWorking);
      const plannedRenderChunks = planWorkEntryRenderChunks(display.orderedRenderableEntries, {
        tailIsLive: placement === "inline" && isLiveGroup,
      });
      const cappedRenderPlan = capOpenWorkEntryRenderChunks(plannedRenderChunks, {
        expanded: display.toolExpanded,
        maxVisibleEntries: MAX_VISIBLE_INLINE_TOOL_ENTRIES,
        keep: activeTurnInProgress ? "last" : "first",
        shouldCapEntry: (workEntry) => workEntry.tone === "tool",
      });
      const renderChunks = cappedRenderPlan.chunks;
      const collapseAsSummary = renderChunks.some(isFoldedWorkEntryChunk);
      return (
        <>
          {!hasCollapsedWork && collapseAsSummary && display.renderableToolEntries.length > 0 && (
            <div className={placement === "leading" ? "mb-1.5" : "mt-1.5"}>
              <div className="space-y-px">
                {renderChunks.map((chunk) => {
                  const fold = resolveWorkEntryChunkFold(chunk);
                  if (!fold) {
                    return chunk.entries
                      .filter((workEntry) => workEntry.tone === "tool")
                      .map(renderInlineToolRow);
                  }
                  const summaryRowKey = `${placement}:${row.message.id}:${chunk.id}`;
                  const summaryOverrideKey = `${summaryRowKey}${fold.keySuffix}`;
                  return (
                    <ToolCallGroupSummaryRow
                      key={`inline-tool-summary:${summaryRowKey}`}
                      summary={fold.summary}
                      liveEntry={chunk.liveEntry}
                      open={toolGroupSummaryOverrides[summaryOverrideKey] ?? false}
                      onToggle={(open) => setToolGroupSummaryOpen(summaryOverrideKey, open)}
                      fontSizePx={normalizedChatFontSizePx}
                      renderChildren={() => (
                        <div className="space-y-px pt-0.5">
                          {fold.entries.map(renderInlineToolRow)}
                        </div>
                      )}
                    />
                  );
                })}
              </div>
              {display.toolGroupId && cappedRenderPlan.hasOverflow && (
                <div className="py-0.5">
                  <button
                    type="button"
                    className={cn(
                      "transition-colors duration-100 hover:text-foreground",
                      MUTED_LABEL_TEXT_CLASS_NAME,
                    )}
                    style={{
                      fontSize: `${normalizedChatFontSizePx}px`,
                    }}
                    onClick={() => handleToggleWorkGroup(display.toolGroupId!)}
                  >
                    {display.toolExpanded
                      ? "Show less"
                      : `+${cappedRenderPlan.hiddenEntryCount} more tool calls`}
                  </button>
                </div>
              )}
            </div>
          )}
          {!hasCollapsedWork &&
            !collapseAsSummary &&
            display.visibleRenderableToolEntries.length > 0 && (
              <div className={placement === "leading" ? "mb-1.5" : "mt-1.5"}>
                <div className="space-y-px">
                  {display.visibleRenderableToolEntries.map(renderInlineToolRow)}
                </div>
                {display.toolGroupId &&
                  display.toolEntries.length > MAX_VISIBLE_INLINE_TOOL_ENTRIES && (
                    <div className="py-0.5">
                      <button
                        type="button"
                        className={cn(
                          "transition-colors duration-100 hover:text-foreground",
                          MUTED_LABEL_TEXT_CLASS_NAME,
                        )}
                        style={{
                          fontSize: `${normalizedChatFontSizePx}px`,
                        }}
                        onClick={() => handleToggleWorkGroup(display.toolGroupId!)}
                      >
                        {display.toolExpanded
                          ? "Show less"
                          : `+${display.hiddenToolCount} more tool calls`}
                      </button>
                    </div>
                  )}
              </div>
            )}
          {!hasCollapsedWork && display.statusEntries.length > 0 && (
            <div
              className={cn(
                "space-y-0.5",
                placement === "leading"
                  ? row.assistantTurnInProgress
                    ? "mb-0.5"
                    : "mb-2"
                  : "mt-2",
              )}
            >
              {display.statusEntries.map((workEntry) => (
                <TimelineWorkEntryRow
                  key={`${placement}-status-row:${row.message.id}:${workEntry.id}`}
                  workEntry={workEntry}
                  chatMetaFontSizePx={appTypographyScale.chatMetaPx}
                  textFontSizePx={normalizedChatFontSizePx}
                  density={prefersCompactWorkEntryRow(workEntry) ? "compact" : "default"}
                  markdownCwd={markdownCwd}
                  onImageExpand={onImageExpand}
                  activityDetail={getAgentActivityDetail?.(workEntry.id)}
                  {...(computerControlEnabled !== undefined
                    ? {
                        computerControlEnabled,
                      }
                    : {})}
                  {...(onEnableComputerControl
                    ? {
                        onEnableComputerControl,
                      }
                    : {})}
                  timestampFormat={timestampFormat}
                />
              ))}
            </div>
          )}
        </>
      );
    };
    const renderCollapsedTurnItem = (item: CollapsedTurnItem, keyPrefix: string) =>
      item.kind === "work" ? (
        <TimelineWorkEntryRow
          key={`${keyPrefix}:work:${row.message.id}:${item.id}`}
          workEntry={item.entry}
          chatMetaFontSizePx={appTypographyScale.chatMetaPx}
          textFontSizePx={normalizedChatFontSizePx}
          density={prefersCompactWorkEntryRow(item.entry) ? "compact" : "default"}
          markdownCwd={markdownCwd}
          onImageExpand={onImageExpand}
          activityDetail={getAgentActivityDetail?.(item.entry.id)}
          {...(computerControlEnabled !== undefined
            ? {
                computerControlEnabled,
              }
            : {})}
          {...(onEnableComputerControl
            ? {
                onEnableComputerControl,
              }
            : {})}
          timestampFormat={timestampFormat}
        />
      ) : (
        <div
          key={`${keyPrefix}:narration:${row.message.id}:${item.id}`}
          className={MUTED_LABEL_TEXT_CLASS_NAME}
          data-chat-find-narration-id={item.message.id}
          data-chat-find-document-id={item.message.id}
        >
          <ChatMarkdown
            text={item.message.text}
            cwd={markdownCwd}
            isStreaming={false}
            style={chatTypographyStyle}
            onImageExpand={onImageExpand}
            knownAbsoluteFilePaths={knownAbsoluteFilePaths}
            {...threadFindMarkdownProps(findHighlight, item.message.id)}
          />
        </div>
      );
    const renderCollapsedTurnChunk = (chunk: CollapsedTurnChunk, keyPrefix: string) => {
      if (chunk.kind === "item") {
        return renderCollapsedTurnItem(chunk.item, keyPrefix);
      }
      const summary = summarizeToolCallGroup(chunk.entries);
      if (!summary) {
        return chunk.entries.map((entry) =>
          renderCollapsedTurnItem(
            {
              kind: "work",
              id: entry.id,
              entry,
            },
            keyPrefix,
          ),
        );
      }
      const summaryOverrideKey = `turn:${row.message.id}:${chunk.id}`;
      return (
        <ToolCallGroupSummaryRow
          key={`${keyPrefix}:tool-group:${row.message.id}:${chunk.id}`}
          summary={summary}
          open={toolGroupSummaryOverrides[summaryOverrideKey] ?? false}
          onToggle={(open) => setToolGroupSummaryOpen(summaryOverrideKey, open)}
          fontSizePx={normalizedChatFontSizePx}
          renderChildren={() => (
            <div className="space-y-0.5 pt-0.5">
              {chunk.entries.map((entry) =>
                renderCollapsedTurnItem(
                  {
                    kind: "work",
                    id: entry.id,
                    entry,
                  },
                  keyPrefix,
                ),
              )}
            </div>
          )}
        />
      );
    };
    return (
      <>
        {settledCollapseTransition && (
          <div
            aria-hidden="true"
            inert
            className="pointer-events-none mb-3 select-none"
            data-settled-turn-collapse-transition="true"
          >
            <DisclosureRegion
              open={settledCollapseTransition.open}
              contentClassName="space-y-1.5 pb-2.5"
            >
              {chunkCollapsedTurnItems(settledCollapseTransition.items).map((chunk) =>
                renderCollapsedTurnChunk(chunk, "settling-turn-close"),
              )}
            </DisclosureRegion>
          </div>
        )}
        {hasCollapsedWork && (
          <div className="mb-3">
            <Collapsible
              className="group/collapsed-work"
              open={isCollapsedWorkExpanded}
              onOpenChange={(open) => {
                setCollapsedWorkExpanded(row.message.id, open);
              }}
            >
              <CollapsibleTrigger
                className={cn(
                  "-ml-0.5 inline-flex items-center gap-1 pb-2 text-left transition-colors duration-100 hover:text-foreground",
                  MUTED_LABEL_TEXT_CLASS_NAME,
                )}
                style={{
                  fontSize: chatTypographyStyle.fontSize,
                }}
              >
                <span>
                  {row.collapsedWorkElapsed ? `Worked for ${row.collapsedWorkElapsed}` : "Details"}
                </span>
                <DisclosureChevron
                  open={isCollapsedWorkExpanded}
                  className="text-muted-foreground/70"
                />
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div
                  className={disclosureContentClassName(
                    isCollapsedWorkExpanded,
                    "mb-2.5 space-y-1.5",
                  )}
                >
                  {chunkCollapsedTurnItems(collapsedTurnItems!).map((chunk) =>
                    renderCollapsedTurnChunk(chunk, "collapsed-panel"),
                  )}
                </div>
              </CollapsiblePanel>
            </Collapsible>
            <div className="h-px w-full bg-border" />
          </div>
        )}
        <div className="group min-w-0 py-0.5">
          {renderWorkDisplay(leadingWorkDisplay, "leading")}
          {row.message.asyncUserInput ? (
            <AsyncUserInputCard
              key={row.message.id}
              messageId={row.message.id}
              input={row.message.asyncUserInput}
              onRespond={onRespondToAsyncUserInput}
            />
          ) : messageText !== null ? (
            <div
              data-assistant-message-id={row.message.id}
              data-chat-find-document-id={row.message.id}
            >
              <ChatMarkdown
                text={messageText}
                cwd={markdownCwd}
                isStreaming={Boolean(row.message.streaming)}
                style={chatTypographyStyle}
                onImageExpand={onImageExpand}
                knownAbsoluteFilePaths={knownAbsoluteFilePaths}
                {...threadFindMarkdownProps(findHighlight, row.message.id)}
              />
            </div>
          ) : null}
          {renderWorkDisplay(inlineWorkDisplay, "inline")}
          {inlineEditedFilesFromTurnSummary.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {inlineEditedFilesFromTurnSummary.map((file) => (
                <button
                  key={`inline-summary-edit:${row.message.id}:${file.path}`}
                  type="button"
                  className="group/file-row flex w-full max-w-full items-center gap-2 px-0 py-1.5 text-left transition-colors duration-100 focus-visible:outline-none"
                  title={file.path}
                  onClick={() => onOpenTurnDiff(turnSummary!.turnId, file.path)}
                >
                  <EditedFileRowContent
                    filePath={file.path}
                    additions={file.additions}
                    deletions={file.deletions}
                    fontSizePx={normalizedChatFontSizePx}
                    compact={false}
                  />
                </button>
              ))}
            </div>
          )}
          {collapsedComputerActionEntries.map((workEntry) => (
            <div key={`computer-action:${row.message.id}:${workEntry.id}`} className="mt-2">
              <TimelineWorkEntryRow
                workEntry={workEntry}
                chatMetaFontSizePx={appTypographyScale.chatMetaPx}
                textFontSizePx={normalizedChatFontSizePx}
                density="compact"
                markdownCwd={markdownCwd}
                onImageExpand={onImageExpand}
                {...(computerControlEnabled !== undefined
                  ? {
                      computerControlEnabled,
                    }
                  : {})}
                {...(onEnableComputerControl
                  ? {
                      onEnableComputerControl,
                    }
                  : {})}
                timestampFormat={timestampFormat}
              />
            </div>
          ))}
          {!row.assistantTurnInProgress && row.showAssistantCopyButton
            ? gladeThreadCreationRecaps.map((creation) => (
                <div key={creation.operationId} className="mt-2 mb-4">
                  <GladeThreadCreationCard
                    creation={creation}
                    {...(onOpenThread
                      ? {
                          onOpenThread: (createdThreadId) =>
                            onOpenThread(ThreadId.makeUnsafe(createdThreadId)),
                        }
                      : {})}
                  />
                </div>
              ))
            : null}
          {(() => {
            if (
              !turnSummary ||
              row.assistantTurnInProgress ||
              !allTurnWorkEntries.some((entry) => entry.tone === "tool")
            ) {
              return null;
            }
            const checkpointFiles = turnSummary.files;
            if (checkpointFiles.length === 0) return null;
            const fileChangesExpanded = expandedFileChangesByTurnId[turnSummary.turnId] ?? true;
            const fileListExpanded = expandedFileListByTurnId[turnSummary.turnId] ?? false;
            const fileListHasMounted = Object.hasOwn(expandedFileListByTurnId, turnSummary.turnId);
            const checkpointTurnCount = turnSummary.checkpointTurnCount;
            const checkpointTurnCounts =
              turnSummary.checkpointTurnCounts ??
              (checkpointTurnCount === undefined ? [] : [checkpointTurnCount]);
            const canUndo =
              turnSummary.status !== "missing" &&
              turnSummary.status !== "error" &&
              turnSummary.checkpointRef !== undefined &&
              !turnSummary.checkpointRef.startsWith("provider-diff:") &&
              checkpointTurnCounts.length > 0 &&
              onUndoTurnFiles !== undefined;
            const totalAdditions = checkpointFiles.reduce(
              (sum, file) => sum + (file.additions ?? 0),
              0,
            );
            const totalDeletions = checkpointFiles.reduce(
              (sum, file) => sum + (file.deletions ?? 0),
              0,
            );
            const editedFilesLabel = `Edited ${checkpointFiles.length} ${pluralize(checkpointFiles.length, "file")}`;
            const firstCheckpointFiles = checkpointFiles.slice(0, MAX_VISIBLE_CHANGED_FILES);
            const overflowCheckpointFiles = checkpointFiles.slice(MAX_VISIBLE_CHANGED_FILES);
            const renderCheckpointFileRow = (
              file: (typeof checkpointFiles)[number],
              withFirstReset: boolean,
            ) => {
              const additions = file.additions ?? 0;
              const deletions = file.deletions ?? 0;
              const fileKind = file.kind ?? "modified";
              return (
                <EditedFileRow
                  key={file.path}
                  file={{
                    path: file.path,
                    kind: fileKind,
                    additions,
                    deletions,
                    workspaceRoot,
                  }}
                  editorConfig={{
                    keybindings: editorKeybindings,
                    availableEditors: installedEditors,
                  }}
                  appearance={{
                    theme: resolvedTheme,
                    fontSize: chatTypographyStyle.fontSize,
                    withFirstReset,
                  }}
                  onReview={() => onOpenTurnDiff(turnSummary.turnId, file.path)}
                />
              );
            };
            return (
              <div className="mt-2 mb-1 overflow-hidden rounded-[0.65rem] border border-[color:var(--color-border-light)] dark:border-[color:color-mix(in_srgb,var(--color-border-light)_55%,transparent)]">
                <div
                  className={cn(
                    "flex items-center justify-between gap-3 bg-[color:color-mix(in_srgb,var(--app-user-message-background)_40%,transparent)] px-3 py-1.5",
                    fileChangesExpanded && "border-b border-[color:var(--color-border-light)]",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <PlusMinusSquare01Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
                    <div className="min-w-0">
                      <div
                        className="truncate font-normal text-foreground/92"
                        style={{
                          fontSize: chatTypographyStyle.fontSize,
                        }}
                      >
                        {editedFilesLabel}
                      </div>
                      {totalAdditions + totalDeletions > 0 ? (
                        <div
                          className="font-system-ui tabular-nums"
                          style={{
                            fontSize: chatTypographyStyle.fontSize,
                          }}
                        >
                          <DiffStatLabel additions={totalAdditions} deletions={totalDeletions} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canUndo && (
                      <button
                        type="button"
                        className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                        style={{
                          fontSize: chatTypographyStyle.fontSize,
                        }}
                        onClick={() => onUndoTurnFiles(checkpointTurnCounts)}
                      >
                        Undo
                        <UndoIcon className="size-3" />
                      </button>
                    )}
                    <ReviewChangesButton
                      style={{
                        fontSize: chatTypographyStyle.fontSize,
                      }}
                      onClick={() => onOpenTurnDiff(turnSummary.turnId)}
                    />
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground/80"
                      aria-expanded={fileChangesExpanded}
                      aria-label={
                        fileChangesExpanded
                          ? "Collapse changed files list"
                          : "Expand changed files list"
                      }
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!fileChangesExpanded && isTailContentRow) {
                          scrollTailExpansionToEnd();
                        }
                        toggleFileChangesExpanded(turnSummary.turnId);
                      }}
                      data-scroll-anchor-ignore={isTailContentRow ? true : undefined}
                    >
                      <DisclosureChevron
                        open={fileChangesExpanded}
                        className="dark:text-muted-foreground/50"
                      />
                    </button>
                  </div>
                </div>
                <DisclosureRegion open={fileChangesExpanded}>
                  {firstCheckpointFiles.map((file) => renderCheckpointFileRow(file, true))}
                  {overflowCheckpointFiles.length > 0 && fileListHasMounted ? (
                    <DisclosureRegion open={fileListExpanded}>
                      {overflowCheckpointFiles.map((file) => renderCheckpointFileRow(file, false))}
                    </DisclosureRegion>
                  ) : null}
                  {overflowCheckpointFiles.length > 0 ? (
                    <button
                      type="button"
                      className="flex w-full items-center justify-start gap-1.5 border-t border-[color:var(--color-border-light)] bg-transparent px-3 py-2 font-system-ui font-normal text-muted-foreground transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground"
                      style={{
                        fontSize: chatTypographyStyle.fontSize,
                      }}
                      aria-expanded={fileListExpanded}
                      onClick={() => toggleFileListExpanded(turnSummary.turnId)}
                    >
                      <DisclosureChevron open={fileListExpanded} />
                      <span>
                        {fileListExpanded
                          ? "Show less"
                          : `Show ${overflowCheckpointFiles.length} more ${pluralize(overflowCheckpointFiles.length, "file")}`}
                      </span>
                    </button>
                  ) : null}
                </DisclosureRegion>
              </div>
            );
          })()}
          {(showPinToggle ||
            showForkAction ||
            assistantCopyState.visible ||
            assistantMeta.length > 0) && (
            <div
              className="mt-0.5 flex items-center gap-2 font-system-ui font-normal text-muted-foreground [&>button+button]:-ml-2 [&>button:first-child]:-ml-[0.4375em]"
              style={chatMessageFooterStyle}
            >
              {assistantCopyState.visible ? (
                <MessageCopyButton text={assistantCopyState.text ?? ""} />
              ) : null}
              {showForkAction ? (
                <MessageActionButton
                  label="Fork thread from this turn"
                  tooltip="Fork from here"
                  onClick={() => onForkFromMessage?.(row.message.id)}
                >
                  <WorkflowCircle04Icon className={MESSAGE_ACTION_ICON_CLASS_NAME} />
                </MessageActionButton>
              ) : null}
              {showPinToggle ? (
                <MessageActionButton
                  label={pinActionLabel("message", messagePinned)}
                  tooltip={messagePinned ? "Unpin from panel" : "Pin to panel"}
                  aria-pressed={messagePinned}
                  className={messagePinned ? "text-foreground" : undefined}
                  onClick={() => onTogglePinMessage?.(row.message.id)}
                >
                  <PinIcon className={MESSAGE_ACTION_ICON_CLASS_NAME} />
                </MessageActionButton>
              ) : null}
              {assistantMeta.length > 0 ? <p className="tabular-nums">{assistantMeta}</p> : null}
            </div>
          )}
        </div>
      </>
    );
  })();
}
