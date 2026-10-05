import { useQuery } from "@tanstack/react-query";
import { providerComposerCapabilitiesQueryOptions } from "~/lib/providerDiscoveryReactQuery";
import { Spinner } from "~/components/ui/spinner";
import { pendingRequestInstanceKey } from "@glade/shared/threads/threadSummary";
import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { useCallback } from "react";
import { ComposerPromptEditor } from "~/components/ComposerPromptEditor";
import { Button } from "~/components/ui/button";
import { ChatComposerFooter } from "~/components/chat/ChatComposerFooter";
import { ComposerBranchMismatchBanner } from "~/components/chat/ComposerBranchMismatchBanner";
import { ComposerColumnFrame } from "~/components/chat/ComposerColumnFrame";
import { ComposerCommandMenu } from "~/components/chat/ComposerCommandMenu";
import { ComposerComputerControlEffortHint } from "~/components/chat/ComposerComputerControlEffortHint";
import { ComposerExpiredUserInputNotice } from "~/components/chat/ComposerExpiredUserInputNotice";
import { ComposerExtrasPanel } from "~/components/chat/ComposerExtrasPanel";

import { ComposerLiveChangesHeader } from "~/components/chat/ComposerLiveChangesHeader";
import { ComposerLocalDirectoryMenu } from "~/components/chat/ComposerLocalDirectoryMenu";
import { ComposerPendingApprovalPanel } from "~/components/chat/ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "~/components/chat/ComposerPendingUserInputPanel";
import { ComposerQueuedHeader } from "~/components/chat/ComposerQueuedHeader";
import { ComposerReferenceAttachments } from "~/components/chat/ComposerReferenceAttachments";
import { ComposerSubagentStrip } from "~/components/chat/ComposerSubagentStrip";
import { collectRunningSubagentStripItems } from "~/components/chat/ComposerSubagentStrip.logic";
import { ContextWindowMeter } from "~/components/chat/ContextWindowMeter";
import { COMPUTER_CONTROL_HINT_EFFORT } from "~/components/chat/composerComputerControlHint";
import { WorkflowRunCard } from "~/components/chat/WorkflowRunCard";
import {
  COMPOSER_COMMAND_MENU_FLOATING_WRAPPER_CLASS_NAME,
  COMPOSER_EDITOR_PADDING_CLASS_NAME,
  COMPOSER_INPUT_SHELL_CLASS_NAME,
  COMPOSER_INPUT_SURFACE_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import { collapseExpandedComposerCursor } from "~/composer-logic";
import { cn } from "~/lib/utils";

import { buildNextProviderOptions } from "~/providerModelOptions";
import { backgroundSubagent, stopSubagent, stopWorkflowTask } from "../chatTaskActions";
import { useChatThreadContext } from "../ChatThreadContext";
import type { createChatPresentation } from "./chatPresentation";
import { COMPOSER_EXTRAS_PANEL_ID } from "./chatViewSupport";
import type { ChatController } from "./useChatController";
export function ChatComposerSurface({
  controller,
  presentation,
  onNavigateToThread,
  onOpenTurnDiff,
}: {
  controller: ChatController;
  presentation: ReturnType<typeof createChatPresentation>;
  onNavigateToThread: (threadId: ThreadId) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  const { threadId } = useChatThreadContext();
  const nativeControls = useQuery(
    providerComposerCapabilitiesQueryOptions(
      controller.session.activeThread?.modelSelection.provider ??
        controller.provider.selectedProvider,
    ),
  ).data?.nativeSubagentControls;
  const {
    shouldRenderChatPaneContent,
    activeTurnLiveDiffState,
    settledThreadBranchMismatch,
    composerOverlayOpen,
    composerExtrasPanelOpen,
    composerMenuItems,
    activeComposerMenuItem,
    nonPersistedComposerImageIdSet,
  } = controller.discovery;
  const {
    isCenteredEmptyLanding,
    threadWorkspaceCwd,
    isComposerApprovalState,
    isLocalFolderBrowserOpen,
    mentionTriggerQuery,
    localFolderBrowseRootPath,
    isComposerMenuLoading,
    effectiveComposerTriggerKind,
    canCollapsePastedTextToDraft,
    isComposerEditorDisabled,
    isNativeSubagent,
    setIsContextWindowMeterOpen,
    standaloneClaudeCompactDisabledReason,
    isRequestingClaudeCompaction,
    onCompactClaudeContext,
    isAbandoningLegacyCacheHold,
    onAbandonLegacyCacheHold,
  } = controller.transcript;
  const {
    composerFormRef,
    paneScopeId,
    taskListSidebarOpen,
    setTaskListSidebarOpen,
    workflowRunCardCompact,
    setWorkflowRunCardCompact,
    subagentStripCompact,
    setSubagentStripCompact,
    queuedComposerTurns,
    activeThread,
    promptRef,
    setComposerCursor,
    setIsComposerExtrasPanelOpen,
    localDirectoryMenuRef,
    resolvedTheme,
    composerCommandPicker,
    composerAssistantSelections,
    composerBrowserAnnotations,
    composerFileComments,
    composerPastedTexts,
    composerPullRequestContexts,
    composerFiles,
    composerImages,
    setExpandedImage,
    clearComposerAssistantSelectionsFromDraft,
    removeComposerBrowserAnnotationFromDraft,
    clearComposerFileCommentsFromDraft,
    removeComposerPastedTextFromDraft,
    showComposerPastedTextInField,
    removeComposerPullRequestContextFromDraft,
    composerEditorRef,
    prompt,
    composerCursor,
    composerTerminalContexts,
    removeComposerTerminalContextFromDraft,
    isComposerFooterCompact,

    composerSendState,
    setComposerDraftProviderModelOptions,
    updateSettings,
    removeComposerImageFromDraft,
    discardPromptHistoryNavigationForComposerMutation,
    removeComposerDraftFile,
    markWorkflowRunPaused,
    markWorkflowRunDismissed,
  } = controller.session;
  const {
    onSend,
    onResumeWorkflowRun,
    onSteerQueuedComposerTurn,
    removeQueuedComposerTurn,
    onEditQueuedComposerTurn,

    composerTraitSelection,
    selectedProviderModelOptions,
    toggleFastMode,

    handleSelectLocalDirectoryMention,
    handleNavigateLocalFolder,
    onComposerMenuItemHighlighted,
    onSelectComposerItem,
    onPromptChange,
    onComposerCommandKey,
    composerPickerControls,
    runtimeUsageContextWindow,
    composerFooterControlsPlan,
    contextWindowSelectionStatus,
  } = controller.submission;
  const {
    reportChatActionFailure,
    scheduleComposerFocus,
    isPreparingComposerImages,
    pendingComposerImageCount,
    addPastedTextToDraft,
    isVoiceRecording,
    isVoiceTranscribing,
    showVoiceNotesControl,
    voiceRecordingDurationLabel,
    voiceWaveformLevels,
    cancelComposerVoiceRecording,
    submitComposerVoiceRecording,
  } = controller.composer;
  const composerEffortOptionId = composerTraitSelection.primarySelectDescriptor?.id ?? "effort";
  const { selectedProvider, selectedModelForPickerWithCustomFallback } = controller.provider;
  const applyComputerControlEffortHint = useCallback(() => {
    setComposerDraftProviderModelOptions(
      threadId,
      selectedProvider,
      buildNextProviderOptions(selectedProvider, selectedProviderModelOptions, {
        [composerEffortOptionId]: COMPUTER_CONTROL_HINT_EFFORT,
      }),
      { model: selectedModelForPickerWithCustomFallback, persistSticky: true },
    );
    updateSettings({ dismissedComputerControlEffortHint: true });
    scheduleComposerFocus();
  }, [
    composerEffortOptionId,
    scheduleComposerFocus,
    selectedModelForPickerWithCustomFallback,
    selectedProvider,
    selectedProviderModelOptions,
    setComposerDraftProviderModelOptions,
    threadId,
    updateSettings,
  ]);
  const dismissComputerControlEffortHint = useCallback(() => {
    updateSettings({ dismissedComputerControlEffortHint: true });
    scheduleComposerFocus();
  }, [scheduleComposerFocus, updateSettings]);
  const {
    workflowRunState,
    composerSubagentStripItems,
    activePendingApproval,
    pendingApprovals,
    respondingRequestKeys,
    onRespondToApproval,
    pendingUserInputs,
    userInputSubmissionVersion,
    activePendingIsResponding,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    onToggleActivePendingUserInputOption,
    onAdvanceActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,
    onCancelActivePendingUserInput,
    expiredQuestionDrafts,
    composerProviderState,
    serverConfigQuery,
    activePendingProgress,
    selectedComposerMentions,
    hasLiveTurn,
    phase,
    activeTaskList,
    stripSourceThreadId,
    stripSourceRuntimeActive,

    activePendingResolvedAnswers,
    isSendBusy,
    isConnecting,
    isPreparingWorktree,
  } = controller.provider;
  const {
    isThreadDragOverComposer,
    threadMentionDropzoneProps,
    addComposerAttachments,
    onComposerPaste,
    onInterruptFromStopControl,
  } = controller.actions;
  const removeComposerFile = (fileId: string) => {
    discardPromptHistoryNavigationForComposerMutation();
    removeComposerDraftFile(threadId, fileId);
  };
  const toggleComposerVoiceRecording = () => {
    if (isVoiceTranscribing) return;
    if (isVoiceRecording) void submitComposerVoiceRecording();
    else void controller.composer.startComposerVoiceRecording();
  };
  const { isServerThread, activeCumulativeCostUsd, activeThreadId } = controller.workspace;
  const onPauseWorkflowRun = async () => {
    if (!workflowRunState || !activeThreadId) return;
    markWorkflowRunPaused(activeThreadId, workflowRunState.workflowTaskId);
    if (activeThread) await stopWorkflowTask(activeThread.id, workflowRunState.workflowTaskId);
  };
  const onDismissWorkflowRun = () => {
    if (workflowRunState && activeThreadId) {
      markWorkflowRunDismissed(activeThreadId, workflowRunState.workflowTaskId);
    }
  };
  const {
    showComposerLiveChangesHeader,
    renderActiveTaskListCard,
    showComposerActiveTaskListCard,
    showComposerSubagentStrip,
    showComposerWorkflowRunCard,

    showComposerComputerControlEffortHint,
    emptyLandingControls,
    relocateComposerLeadingControls,
    renderComposerLeadingControls,
  } = presentation;
  const heldMessageId = activeThread?.claudeCacheReview?.messageId;
  const heldMessage = activeThread?.messages.find((message) => message.id === heldMessageId);
  if (isNativeSubagent && !activePendingApproval && pendingUserInputs.length === 0) {
    const parentThreadId = activeThread?.parentThreadId;
    return parentThreadId ? (
      <div className="flex w-full justify-center py-3">
        <Button variant="ghost" size="sm" onClick={() => onNavigateToThread(parentThreadId)}>
          Back to main chat
        </Button>
      </div>
    ) : null;
  }
  return shouldRenderChatPaneContent ? (
    <div
      className={cn(isCenteredEmptyLanding ? "w-full overflow-visible" : "contents")}
      data-empty-landing-composer-block={isCenteredEmptyLanding ? "true" : undefined}
    >
      <form
        ref={composerFormRef}
        onSubmit={(...args: Parameters<typeof onSend>) => {
          void onSend(...args).catch(reportChatActionFailure);
        }}
        className="relative z-10 w-full overflow-visible"
        data-chat-composer-form="true"
        data-chat-pane-scope={paneScopeId}
      >
        <ComposerColumnFrame>
          {}
          <div>
            {showComposerLiveChangesHeader ? (
              <ComposerLiveChangesHeader
                fileCount={activeTurnLiveDiffState.fileCount}
                additions={activeTurnLiveDiffState.additions}
                deletions={activeTurnLiveDiffState.deletions}
                onReview={
                  activeTurnLiveDiffState.turnId
                    ? () => onOpenTurnDiff(activeTurnLiveDiffState.turnId as TurnId)
                    : undefined
                }
              />
            ) : null}
            {renderActiveTaskListCard(showComposerLiveChangesHeader)}
            {workflowRunState ? (
              <WorkflowRunCard
                workflowRun={workflowRunState}
                compact={workflowRunCardCompact}
                onCompactChange={setWorkflowRunCardCompact}
                onOpenThread={onNavigateToThread}
                onStop={() => {
                  if (activeThread) {
                    void stopWorkflowTask(activeThread.id, workflowRunState.workflowTaskId).catch(
                      reportChatActionFailure,
                    );
                  }
                }}
                onPause={(...args: Parameters<typeof onPauseWorkflowRun>) => {
                  void onPauseWorkflowRun(...args).catch(reportChatActionFailure);
                }}
                onResume={(...args: Parameters<typeof onResumeWorkflowRun>) => {
                  void onResumeWorkflowRun(...args).catch(reportChatActionFailure);
                }}
                onDismiss={onDismissWorkflowRun}
                attachedToPrevious={showComposerLiveChangesHeader || showComposerActiveTaskListCard}
              />
            ) : null}
            {showComposerSubagentStrip && !isNativeSubagent ? (
              <ComposerSubagentStrip
                items={composerSubagentStripItems}
                compact={subagentStripCompact}
                onCompactChange={setSubagentStripCompact}
                onOpenThread={onNavigateToThread}
                onBackgroundItem={
                  nativeControls?.background && stripSourceRuntimeActive
                    ? (item) => {
                        if (stripSourceThreadId) {
                          void backgroundSubagent(stripSourceThreadId, item.providerThreadId).catch(
                            reportChatActionFailure,
                          );
                        }
                      }
                    : undefined
                }
                onStopItem={
                  nativeControls?.interrupt && stripSourceRuntimeActive
                    ? (item) => {
                        if (stripSourceThreadId) {
                          void stopSubagent(stripSourceThreadId, item.providerThreadId).catch(
                            reportChatActionFailure,
                          );
                        }
                      }
                    : undefined
                }
                onStopAll={
                  nativeControls?.interrupt && stripSourceRuntimeActive
                    ? () => {
                        if (stripSourceThreadId) {
                          void Promise.all(
                            collectRunningSubagentStripItems(composerSubagentStripItems).map(
                              (item) => stopSubagent(stripSourceThreadId, item.providerThreadId),
                            ),
                          ).catch(reportChatActionFailure);
                        }
                      }
                    : undefined
                }
                attachedToPrevious={
                  showComposerLiveChangesHeader ||
                  showComposerActiveTaskListCard ||
                  showComposerWorkflowRunCard
                }
              />
            ) : null}
            <ComposerQueuedHeader
              queuedTurns={queuedComposerTurns}
              onSteer={(...args: Parameters<typeof onSteerQueuedComposerTurn>) => {
                void onSteerQueuedComposerTurn(...args).catch(reportChatActionFailure);
              }}
              onRemove={removeQueuedComposerTurn}
              onEdit={onEditQueuedComposerTurn}
              cwd={threadWorkspaceCwd ?? undefined}
              attachedToPrevious={
                showComposerLiveChangesHeader ||
                showComposerActiveTaskListCard ||
                showComposerWorkflowRunCard ||
                showComposerSubagentStrip
              }
            />

            {showComposerComputerControlEffortHint ? (
              <ComposerComputerControlEffortHint
                onApply={applyComputerControlEffortHint}
                onDismiss={dismissComputerControlEffortHint}
                attachedToPrevious={
                  showComposerLiveChangesHeader ||
                  showComposerActiveTaskListCard ||
                  showComposerWorkflowRunCard ||
                  showComposerSubagentStrip ||
                  queuedComposerTurns.length > 0
                }
              />
            ) : null}
            {settledThreadBranchMismatch ? (
              <div className="pb-2">
                <ComposerBranchMismatchBanner {...settledThreadBranchMismatch} />
              </div>
            ) : null}
            {}
            {activePendingApproval ? (
              <div className="pb-2">
                <ComposerPendingApprovalPanel
                  approval={activePendingApproval}
                  pendingCount={pendingApprovals.length}
                  isResponding={respondingRequestKeys.includes(
                    pendingRequestInstanceKey(
                      activePendingApproval.requestId,
                      activePendingApproval.lifecycleGeneration,
                    ),
                  )}
                  onRespond={onRespondToApproval}
                />
              </div>
            ) : pendingUserInputs.length > 0 ? (
              <div className="pb-2">
                <ComposerPendingUserInputPanel
                  pendingUserInputs={pendingUserInputs}
                  submissionVersion={userInputSubmissionVersion}
                  isResponding={activePendingIsResponding}
                  answers={activePendingDraftAnswers}
                  questionIndex={activePendingQuestionIndex}
                  onToggleOption={onToggleActivePendingUserInputOption}
                  onAdvance={onAdvanceActivePendingUserInput}
                  onPrevious={onPreviousActivePendingUserInputQuestion}
                  onCancel={onCancelActivePendingUserInput}
                />
              </div>
            ) : null}
            {activeThread?.claudeCacheReview ? (
              <div className="mb-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-ui">
                <p className="font-medium">A message was held by an older Claude cache check.</p>
                {heldMessage?.text ? (
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap rounded bg-background/60 p-2 text-ui-sm">
                    {heldMessage.text}
                  </p>
                ) : null}
                <p className="mt-1 text-muted-foreground">
                  {activeThread.claudeCacheReview.status === "pending" ||
                  activeThread.claudeCacheReview.status === "failed"
                    ? "It was not sent. Review the message before resending it."
                    : "Its delivery is unconfirmed. Check Claude's history before resending it."}{" "}
                  Releasing the hold lets later queued messages continue.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={isAbandoningLegacyCacheHold}
                  onClick={() => void onAbandonLegacyCacheHold()}
                >
                  {isAbandoningLegacyCacheHold ? "Releasing..." : "Release held message"}
                </Button>
              </div>
            ) : null}
            {expiredQuestionDrafts[0] &&
            pendingUserInputs.length === 0 &&
            !activePendingApproval ? (
              <ComposerExpiredUserInputNotice
                threadId={threadId}
                requestKey={expiredQuestionDrafts[0][0]}
                draft={expiredQuestionDrafts[0][1]}
                onRestore={(nextPrompt) => {
                  promptRef.current = nextPrompt;
                  setComposerCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
                  scheduleComposerFocus();
                }}
              />
            ) : null}
            {emptyLandingControls}
          </div>
          {!isNativeSubagent || pendingUserInputs.length > 0 ? (
            <div
              className={cn(
                COMPOSER_INPUT_SHELL_CLASS_NAME,
                composerProviderState.composerFrameClassName,
                composerOverlayOpen && !isComposerApprovalState && "overflow-visible",
                isThreadDragOverComposer && "ring-1 ring-info/65",
              )}
              {...threadMentionDropzoneProps}
            >
              <div
                className={cn(
                  COMPOSER_INPUT_SURFACE_CLASS_NAME,
                  composerProviderState.composerSurfaceClassName,
                  composerOverlayOpen && !isComposerApprovalState && "overflow-visible",
                )}
              >
                <div
                  className={cn(
                    COMPOSER_EDITOR_PADDING_CLASS_NAME,
                    composerOverlayOpen && !isComposerApprovalState && "overflow-visible",
                  )}
                >
                  {composerOverlayOpen && !isComposerApprovalState ? (
                    <div className={COMPOSER_COMMAND_MENU_FLOATING_WRAPPER_CLASS_NAME}>
                      {composerExtrasPanelOpen ? (
                        <ComposerExtrasPanel
                          panelId={COMPOSER_EXTRAS_PANEL_ID}
                          supportsFastMode={composerTraitSelection.caps.supportsFastMode}
                          fastModeEnabled={composerTraitSelection.fastModeEnabled}
                          threadId={threadId}
                          onAddAttachments={addComposerAttachments}
                          onToggleFastMode={toggleFastMode}
                          onClose={() => {
                            setIsComposerExtrasPanelOpen(false);
                            scheduleComposerFocus();
                          }}
                        />
                      ) : isLocalFolderBrowserOpen ? (
                        <ComposerLocalDirectoryMenu
                          mentionQuery={mentionTriggerQuery}
                          rootLabel={localFolderBrowseRootPath ?? "Local folders unavailable"}
                          homeDir={serverConfigQuery.data?.homeDir ?? null}
                          onSelectEntry={(absolutePath) =>
                            handleSelectLocalDirectoryMention(absolutePath)
                          }
                          onNavigateFolder={handleNavigateLocalFolder}
                          handleRef={localDirectoryMenuRef}
                        />
                      ) : (
                        <ComposerCommandMenu
                          items={composerMenuItems}
                          resolvedTheme={resolvedTheme}
                          isLoading={isComposerMenuLoading}
                          triggerKind={
                            composerCommandPicker !== null
                              ? "slash-command"
                              : effectiveComposerTriggerKind
                          }
                          activeItemId={activeComposerMenuItem?.id ?? null}
                          onHighlightedItemChange={onComposerMenuItemHighlighted}
                          onSelect={onSelectComposerItem}
                        />
                      )}
                    </div>
                  ) : null}
                  {!isComposerApprovalState &&
                    pendingUserInputs.length === 0 &&
                    isPreparingComposerImages && (
                      <div
                        className="flex items-center gap-1.5 px-1 text-ui leading-snug text-muted-foreground"
                        role="status"
                      >
                        <Spinner className="size-3.5" />
                        Optimizing {pendingComposerImageCount === 1 ? "image" : "images"}…
                      </div>
                    )}
                  {!isComposerApprovalState &&
                    pendingUserInputs.length === 0 &&
                    (composerAssistantSelections.length > 0 ||
                      composerBrowserAnnotations.length > 0 ||
                      composerFileComments.length > 0 ||
                      composerPastedTexts.length > 0 ||
                      composerPullRequestContexts.length > 0 ||
                      composerFiles.length > 0 ||
                      composerImages.length > 0) && (
                      <ComposerReferenceAttachments
                        assistantSelections={composerAssistantSelections}
                        browserAnnotations={composerBrowserAnnotations}
                        fileComments={composerFileComments}
                        pastedTexts={composerPastedTexts}
                        pullRequestContexts={composerPullRequestContexts}
                        files={composerFiles}
                        images={composerImages}
                        nonPersistedImageIdSet={nonPersistedComposerImageIdSet}
                        onExpandImage={setExpandedImage}
                        onRemoveAssistantSelections={clearComposerAssistantSelectionsFromDraft}
                        onRemoveBrowserAnnotation={removeComposerBrowserAnnotationFromDraft}
                        onRemoveFileComments={clearComposerFileCommentsFromDraft}
                        onRemovePastedText={removeComposerPastedTextFromDraft}
                        onShowPastedTextInField={showComposerPastedTextInField}
                        onRemovePullRequestContext={removeComposerPullRequestContextFromDraft}
                        onRemoveFile={removeComposerFile}
                        onRemoveImage={removeComposerImageFromDraft}
                      />
                    )}
                  <ComposerPromptEditor
                    ref={composerEditorRef}
                    value={
                      isComposerApprovalState
                        ? ""
                        : activePendingProgress
                          ? activePendingProgress.customAnswer
                          : prompt
                    }
                    cursor={composerCursor}
                    terminalContexts={
                      !isComposerApprovalState && pendingUserInputs.length === 0
                        ? composerTerminalContexts
                        : []
                    }
                    mentionReferences={selectedComposerMentions}
                    onRemoveTerminalContext={removeComposerTerminalContextFromDraft}
                    onChange={onPromptChange}
                    onCommandKeyDown={onComposerCommandKey}
                    onPaste={onComposerPaste}
                    {...(canCollapsePastedTextToDraft
                      ? { onCollapsePastedText: addPastedTextToDraft }
                      : {})}
                    placeholder={
                      isComposerApprovalState
                        ? "Resolve this approval request to continue"
                        : activePendingProgress
                          ? activePendingProgress.activeQuestion?.options.length === 0
                            ? "Type your answer to continue"
                            : "Type your own answer, or leave this blank to use the selected option"
                          : isNativeSubagent
                            ? "Follow this subagent here; send instructions to the main chat"
                            : hasLiveTurn
                              ? "Ask for follow-up changes"
                              : phase === "disconnected"
                                ? "Ask for follow-up changes or attach images"
                                : "Ask anything, @tag files/folders, or use / to show available commands"
                    }
                    disabled={isComposerEditorDisabled}
                  />
                </div>
                {}
                {activePendingApproval ? null : (
                  <ChatComposerFooter
                    isComposerFooterCompact={isComposerFooterCompact}
                    leadingControls={
                      relocateComposerLeadingControls
                        ? null
                        : renderComposerLeadingControls({ iconOnly: false })
                    }
                    composerPickerControls={composerPickerControls}
                    contextMeter={
                      !isVoiceRecording &&
                      !isVoiceTranscribing &&
                      runtimeUsageContextWindow &&
                      composerFooterControlsPlan.showContextMeter ? (
                        <ContextWindowMeter
                          usage={runtimeUsageContextWindow}
                          onOpenChange={setIsContextWindowMeterOpen}
                          {...(selectedProvider === "claudeAgent" &&
                          activeThread?.session?.provider === "claudeAgent" &&
                          isServerThread
                            ? {
                                compactAction: {
                                  disabledReason: standaloneClaudeCompactDisabledReason,
                                  isSubmitting: isRequestingClaudeCompaction,
                                  onCompact: onCompactClaudeContext,
                                },
                              }
                            : {})}
                          {...(activeCumulativeCostUsd != null
                            ? { cumulativeCostUsd: activeCumulativeCostUsd }
                            : {})}
                          {...(contextWindowSelectionStatus.activeLabel !== undefined
                            ? {
                                activeWindowLabel: contextWindowSelectionStatus.activeLabel,
                              }
                            : {})}
                          {...(contextWindowSelectionStatus.pendingSelectedLabel !== undefined
                            ? {
                                pendingWindowLabel:
                                  contextWindowSelectionStatus.pendingSelectedLabel,
                              }
                            : {})}
                        />
                      ) : null
                    }
                    sidebarAction={
                      activeTaskList || taskListSidebarOpen
                        ? {
                            title: taskListSidebarOpen ? "Close task list" : "Open task list",
                            label: "Tasks",
                            onClick: () => setTaskListSidebarOpen(!taskListSidebarOpen),
                          }
                        : null
                    }
                    voice={{
                      enabled: showVoiceNotesControl,
                      recording: isVoiceRecording,
                      transcribing: isVoiceTranscribing,
                      durationLabel: voiceRecordingDurationLabel,
                      waveformLevels: voiceWaveformLevels,
                      onCancel: cancelComposerVoiceRecording,
                      onSubmit: (...args: Parameters<typeof submitComposerVoiceRecording>) => {
                        void submitComposerVoiceRecording(...args).catch(reportChatActionFailure);
                      },
                      onToggle: toggleComposerVoiceRecording,
                    }}
                    pendingInput={
                      activePendingProgress
                        ? {
                            progress: activePendingProgress,
                            responding: activePendingIsResponding,
                            answersComplete: Boolean(activePendingResolvedAnswers),
                          }
                        : null
                    }
                    submission={{
                      phase,
                      busy: isSendBusy,
                      connecting: isConnecting,
                      preparingImages: isPreparingComposerImages,
                      preparingWorktree: isPreparingWorktree,
                      hasContent: composerSendState.hasSendableContent,
                      hasPendingUserInputs: pendingUserInputs.length > 0,

                      onInterrupt: onInterruptFromStopControl,
                    }}
                  />
                )}
              </div>
            </div>
          ) : null}
        </ComposerColumnFrame>
      </form>
    </div>
  ) : null;
}
