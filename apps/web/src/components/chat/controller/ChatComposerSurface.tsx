import { pendingRequestInstanceKey } from "@glade/shared/threads/threadSummary";
import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { useCallback } from "react";
import { ComposerPromptEditor } from "~/components/ComposerPromptEditor";
import { ChatComposerFooter } from "~/components/chat/ChatComposerFooter";
import { ComposerBranchMismatchBanner } from "~/components/chat/ComposerBranchMismatchBanner";
import {
  ComposerClaudeCacheReviewPanel,
  isClaudeCacheReviewPanelVisible,
} from "~/components/chat/ComposerClaudeCacheReviewPanel";
import { ComposerColumnFrame } from "~/components/chat/ComposerColumnFrame";
import { ComposerCommandMenu } from "~/components/chat/ComposerCommandMenu";
import { ComposerComputerControlEffortHint } from "~/components/chat/ComposerComputerControlEffortHint";
import { ComposerExpiredUserInputNotice } from "~/components/chat/ComposerExpiredUserInputNotice";
import { ComposerExtrasPanel } from "~/components/chat/ComposerExtrasPanel";
import { ComposerGoalHeader } from "~/components/chat/ComposerGoalHeader";
import { ComposerInputBanners } from "~/components/chat/ComposerInputBanners";
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
  CHAT_COLUMN_FRAME_CLASS_NAME,
  COMPOSER_COMMAND_MENU_FLOATING_WRAPPER_CLASS_NAME,
  COMPOSER_EDITOR_PADDING_CLASS_NAME,
  COMPOSER_INPUT_SHELL_CLASS_NAME,
  COMPOSER_INPUT_SURFACE_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import { collapseExpandedComposerCursor } from "~/composer-logic";
import { LoaderCircleIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { proposedPlanTitle } from "~/proposedPlan";
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
  const {
    secondaryChromeReady,
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
    claudeCompactDisabledReason,
    cacheReviewIsCompactionRequest,
    onRespondToClaudeCacheReview,
    isComposerApprovalState,
    isLocalFolderBrowserOpen,
    mentionTriggerQuery,
    localFolderBrowseRootPath,
    isComposerMenuLoading,
    effectiveComposerTriggerKind,
    canCollapsePastedTextToDraft,
    isComposerEditorDisabled,
    setIsContextWindowMeterOpen,
    standaloneClaudeCompactDisabledReason,
    isRequestingClaudeCompaction,
    onCompactClaudeContext,
  } = controller.transcript;
  const {
    composerFormRef,
    paneScopeId,
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
    planSidebarOpen,
    composerSendState,
    secondaryChromePlaceholderHeight,
    setComposerDraftProviderModelOptions,
    updateSettings,
  } = controller.session;
  const {
    onSend,
    onResumeWorkflowRun,
    onSteerQueuedComposerTurn,
    removeQueuedComposerTurn,
    onEditQueuedComposerTurn,
    editThreadGoalInComposer,
    setThreadGoalPaused,
    clearThreadGoal,
    composerTraitSelection,
    selectedProviderModelOptions,
    toggleFastMode,
    insertGoalSlashCommandInComposer,
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
    onImplementPlanInNewThread,
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
    showPlanFollowUpPrompt,
    activeProposedPlan,
    pendingAutomationConversation,
    cancelAutomationConversation,
    serverConfigQuery,
    activePendingProgress,
    selectedComposerMentions,
    hasLiveTurn,
    phase,
    activeTaskList,
    stripSourceThreadId,
    sidebarProposedPlan,
    planSidebarToggleTitle,
    planSidebarToggleLabel,
    activePendingResolvedAnswers,
    isSendBusy,
    isConnecting,
    isPreparingWorktree,
  } = controller.provider;
  const {
    onPauseWorkflowRun,
    onDismissWorkflowRun,
    isThreadDragOverComposer,
    threadMentionDropzoneProps,
    addComposerAttachments,
    removeComposerFile,
    removeComposerImage,
    onComposerPaste,
    toggleComposerVoiceRecording,
    onInterruptFromStopControl,
  } = controller.actions;
  const { isServerThread, interactionMode, activeCumulativeCostUsd } = controller.workspace;
  const { handleInteractionModeChange, resetInteractionMode, togglePlanSidebar } =
    controller.environment;
  const {
    showComposerLiveChangesHeader,
    renderActiveTaskListCard,
    showComposerActiveTaskListCard,
    showComposerSubagentStrip,
    showComposerWorkflowRunCard,
    showComposerGoalHeader,
    activeThreadGoalText,
    showComposerComputerControlEffortHint,
    emptyLandingControls,
    relocateComposerLeadingControls,
    renderComposerLeadingControls,
  } = presentation;
  return secondaryChromeReady && shouldRenderChatPaneContent ? (
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
            {showComposerSubagentStrip ? (
              <ComposerSubagentStrip
                items={composerSubagentStripItems}
                compact={subagentStripCompact}
                onCompactChange={setSubagentStripCompact}
                onOpenThread={onNavigateToThread}
                onBackgroundItem={(item) => {
                  if (stripSourceThreadId) {
                    void backgroundSubagent(stripSourceThreadId, item.providerThreadId).catch(
                      reportChatActionFailure,
                    );
                  }
                }}
                onStopItem={(item) => {
                  if (stripSourceThreadId) {
                    void stopSubagent(stripSourceThreadId, item.providerThreadId).catch(
                      reportChatActionFailure,
                    );
                  }
                }}
                onStopAll={() => {
                  if (stripSourceThreadId) {
                    void Promise.all(
                      collectRunningSubagentStripItems(composerSubagentStripItems).map((item) =>
                        stopSubagent(stripSourceThreadId, item.providerThreadId),
                      ),
                    ).catch(reportChatActionFailure);
                  }
                }}
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
            {showComposerGoalHeader && activeThread ? (
              <ComposerGoalHeader
                goal={activeThreadGoalText}
                goalStartedAt={activeThread.goalStartedAt}
                goalPausedAt={activeThread.goalPausedAt}
                canPause={isServerThread}
                onEdit={editThreadGoalInComposer}
                onSetPaused={async (paused) => {
                  await setThreadGoalPaused(paused);
                }}
                onClear={clearThreadGoal}
                attachedToPrevious={
                  showComposerLiveChangesHeader ||
                  showComposerActiveTaskListCard ||
                  showComposerWorkflowRunCard ||
                  showComposerSubagentStrip ||
                  queuedComposerTurns.length > 0
                }
              />
            ) : null}
            {showComposerComputerControlEffortHint ? (
              <ComposerComputerControlEffortHint
                onApply={applyComputerControlEffortHint}
                onDismiss={dismissComputerControlEffortHint}
                attachedToPrevious={
                  showComposerLiveChangesHeader ||
                  showComposerActiveTaskListCard ||
                  showComposerWorkflowRunCard ||
                  showComposerSubagentStrip ||
                  queuedComposerTurns.length > 0 ||
                  showComposerGoalHeader
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
            {activeThread?.claudeCacheReview &&
            isClaudeCacheReviewPanelVisible(activeThread.claudeCacheReview) ? (
              <div className="pb-2">
                <ComposerClaudeCacheReviewPanel
                  key={`${threadId}:${activeThread.claudeCacheReview.reviewId}`}
                  review={activeThread.claudeCacheReview}
                  compactDisabledReason={claudeCompactDisabledReason}
                  isCompactionRequest={cacheReviewIsCompactionRequest}
                  onRespond={onRespondToClaudeCacheReview}
                />
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
              <ComposerInputBanners
                roundedTopReset={false}
                planFollowUp={
                  !activePendingApproval &&
                  pendingUserInputs.length === 0 &&
                  showPlanFollowUpPrompt &&
                  activeProposedPlan
                    ? {
                        id: activeProposedPlan.id,
                        title: proposedPlanTitle(activeProposedPlan.planMarkdown) ?? null,
                      }
                    : null
                }
                automationSetup={
                  !activePendingApproval &&
                  pendingUserInputs.length === 0 &&
                  pendingAutomationConversation &&
                  pendingAutomationConversation.threadId === threadId
                    ? { onCancel: cancelAutomationConversation }
                    : null
                }
              />
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
                        interactionMode={interactionMode}
                        supportsFastMode={composerTraitSelection.caps.supportsFastMode}
                        fastModeEnabled={composerTraitSelection.fastModeEnabled}
                        threadId={threadId}
                        onAddAttachments={addComposerAttachments}
                        onToggleFastMode={toggleFastMode}
                        onInteractionModeChange={handleInteractionModeChange}
                        onInsertGoal={insertGoalSlashCommandInComposer}
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
                      <LoaderCircleIcon className="size-3.5 animate-spin" />
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
                      onRemoveImage={removeComposerImage}
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
                        : showPlanFollowUpPrompt && activeProposedPlan
                          ? "Add feedback to refine the plan, or leave this blank to implement it"
                          : activeThread?.parentThreadId
                            ? "Message this subagent while it works"
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
                        showClaudeCache={activeThread?.session?.provider === "claudeAgent"}
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
                              pendingWindowLabel: contextWindowSelectionStatus.pendingSelectedLabel,
                            }
                          : {})}
                      />
                    ) : null
                  }
                  interactionMode={interactionMode}
                  resetInteractionMode={resetInteractionMode}
                  sidebarAction={
                    activeTaskList || sidebarProposedPlan || planSidebarOpen
                      ? {
                          title: planSidebarToggleTitle,
                          label: planSidebarToggleLabel,
                          onClick: togglePlanSidebar,
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
                    hasPendingCacheReview: activeThread?.claudeCacheReview != null,
                    preparingImages: isPreparingComposerImages,
                    preparingWorktree: isPreparingWorktree,
                    hasContent: composerSendState.hasSendableContent,
                    hasPendingUserInputs: pendingUserInputs.length > 0,
                    showPlanFollowUp: showPlanFollowUpPrompt,
                    hasPrompt: prompt.trim().length > 0,
                    onInterrupt: onInterruptFromStopControl,
                    onImplementInNewThread: (
                      ...args: Parameters<typeof onImplementPlanInNewThread>
                    ) => {
                      void onImplementPlanInNewThread(...args).catch(reportChatActionFailure);
                    },
                  }}
                />
              )}
            </div>
          </div>
        </ComposerColumnFrame>
      </form>
    </div>
  ) : (
    <div aria-hidden="true" className="w-full overflow-visible" data-chat-composer-form="deferred">
      <div
        className={cn(COMPOSER_INPUT_SURFACE_CLASS_NAME, CHAT_COLUMN_FRAME_CLASS_NAME)}
        style={{ height: secondaryChromePlaceholderHeight }}
      />
    </div>
  );
}
