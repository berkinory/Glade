import { parseComputerInvocation } from "@glade/shared/computer/computerInvocation";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { ComposerModelPicker } from "~/components/chat/ComposerModelPicker";
import { resolveProviderModelLabel } from "~/components/chat/ProviderModelPicker";
import { resolveTraitsTriggerSummary } from "~/components/chat/TraitsPicker";
import type { LateComposerSendHandlers } from "~/components/chat/chatSendTypes";
import { getComposerTraitSelection } from "~/components/chat/composerTraits";
import { useChatComposerCommands } from "~/components/chat/useChatComposerCommands";
import { useChatComposerEditing } from "~/components/chat/useChatComposerEditing";
import { useChatQueuedTurns } from "~/components/chat/useChatQueuedTurns";
import { useChatTurnFollowUps } from "~/components/chat/useChatTurnFollowUps";
import { useChatTurnSubmission } from "~/components/chat/useChatTurnSubmission";
import { useChatWorkspaceSelection } from "~/components/chat/useChatWorkspaceSelection";
import { composerFooterPlanForTier } from "~/components/composerFooterLayout";
import { toastManager } from "~/components/ui/toast";
import { collapseExpandedComposerCursor, detectComposerTrigger } from "~/composer-logic";
import { buildGoalSlashCommandPrompt } from "~/composerSlashCommands";
import { useComposerSlashCommands } from "~/hooks/useComposerSlashCommands";
import {
  deriveAppliedContextWindowSelection,
  deriveComposerContextWindowLabel,
  deriveContextWindowSelectionStatus,
} from "~/lib/contextWindow";
import { buildNextProviderOptions } from "~/providerModelOptions";
import {
  ChatViewProps,
  ComposerControlSkeleton,
  ComposerModelLoadingControl,
} from "./chatViewSupport";
import type { useChatActionsController } from "./useChatActionsController";
import type { useChatComposerController } from "./useChatComposerController";
import type { useChatDiscoveryController } from "./useChatDiscoveryController";
import type { useChatEnvironmentController } from "./useChatEnvironmentController";
import type { useChatProviderController } from "./useChatProviderController";
import type { useChatSessionController } from "./useChatSessionController";
import type { useChatTranscriptController } from "./useChatTranscriptController";
import type { useChatWorkspaceController } from "./useChatWorkspaceController";
export function useChatSubmissionController({
  props,
  session,
  provider,
  composer,
  workspace,
  environment,
  actions,
  transcript,
  discovery,
}: {
  props: ChatViewProps;
  session: ReturnType<typeof useChatSessionController>;
  provider: ReturnType<typeof useChatProviderController>;
  composer: ReturnType<typeof useChatComposerController>;
  workspace: ReturnType<typeof useChatWorkspaceController>;
  environment: ReturnType<typeof useChatEnvironmentController>;
  actions: ReturnType<typeof useChatActionsController>;
  transcript: ReturnType<typeof useChatTranscriptController>;
  discovery: ReturnType<typeof useChatDiscoveryController>;
}) {
  const { threadId } = props;
  const {
    queuedComposerTurns,
    activeThread,
    promptRef,
    clearComposerDraftContent,
    setComposerDraftPrompt,
    setDraftThreadContext,
    addComposerImagesToDraft,
    addComposerFilesToDraft,
    addComposerAssistantSelectionToDraft,
    addComposerDraftBrowserAnnotations,
    addComposerFileCommentToDraft,
    addComposerTerminalContextsToDraft,
    addComposerPastedTextsToDraft,
    addComposerPullRequestContextsToDraft,
    setRestoredQueuedSourceProposedPlan,
    setComposerDraftModelSelection,
    setComposerDraftRuntimeMode,
    setComposerDraftInteractionMode,
    setComposerDraftComputerControlMode,
    setComposerCursor,
    setComposerTrigger,
    removeQueuedComposerTurnFromDraft,
    insertQueuedComposerTurn,
    sendInFlightRef,
    sendPreflightInFlightRef,
    syncServerShellSnapshot,
    setStoreThreadError,
    queryClient,
    setComposerHighlightedItemId,
    setStoreThreadWorkspace,
    createWorktreeMutation,
    planSidebarDismissedForTurnRef,
    setPlanSidebarOpen,
    settings,
    composerEditorRef,
    composerImages,
    composerFiles,
    composerAssistantSelections,
    composerBrowserAnnotations,
    composerFileComments,
    composerTerminalContexts,
    composerPastedTexts,
    composerPullRequestContexts,
    restoredQueuedSourceProposedPlanRef,
    enqueueQueuedComposerTurn,
    clearProjectDraftThreadId,
    promptHistoryNavigationRef,
    applyingPromptHistoryNavigationRef,
    expectedPromptHistoryPromptRef,
    composerImagesRef,
    composerFilesRef,
    composerAssistantSelectionsRef,
    composerBrowserAnnotationsRef,
    composerFileCommentsRef,
    composerTerminalContextsRef,
    composerPastedTextsRef,
    composerPullRequestContextsRef,
    setPrompt,
    isRevertingCheckpoint,
    setIsRevertingCheckpoint,
    markWorkflowRunDismissed,
    planSidebarOpenOnNextThreadRef,
    navigate,
    prompt,
    composerFooterTier,
    composerFooterDemotionWidthsRef,
    composerFooterTierRef,
    setComposerFooterTier,
    composerFooterLayoutSyncRef,
    isComposerFooterCompact,
    setIsModelPickerOpen,
    setIsTraitsPickerOpen,
    isComposerModelEffortPickerOpen,
    setComposerDraftProviderModelOptions,
    composerCursor,
    handleNewThread,
    setComposerCommandPicker,
    composerSelectLockRef,
    composerHighlightedItemId,
    restoreComposerDraftPromptHistorySavedDraft,
    setComposerDraftPromptHistorySavedDraft,
    promptHistoryAppliedPromptRef,
    composerCommandPicker,
    setComposerDraftTerminalContexts,
    composerMenuOpenRef,
    localDirectoryMenuRef,
    composerMenuItemsRef,
    activeComposerMenuItemRef,
    composerDraft,
  } = session;
  const {
    updateSelectedComposerSkills,
    updateSelectedComposerMentions,
    phase,
    localDispatch,
    isConnecting,
    activePendingApproval,
    activePendingProgress,
    pendingUserInputs,
    hasLiveTurn,
    showPlanFollowUpPrompt,
    activeProposedPlan,
    hasQueueableLiveTurn,
    isSendBusy,
    worktreeSetupResolutionRef,
    setWorktreeSetupPendingAction,
    beginLocalDispatch,
    clearLocalDispatchWorktreeSetup,
    armLocalDispatchAckFallback,
    failLocalDispatchWorktreeSetup,
    scheduleFailedWorktreeSetupDispatchReset,
    resetLocalDispatch,
    activePendingUserInputKey,
    pendingUserInputAnswersByRequestIdRef,
    setPendingUserInputAnswersByRequestId,
    selectedComposerSkillsRef,
    selectedComposerMentionsRef,
    selectedProvider,
    selectedModel,
    selectedPromptEffort,
    pendingAutomationConversationRef,
    setPendingAutomationConversation,
    pendingAutomationConversation,
    activeThreadIdRef,
    hasLiveTurnRef,
    automationProjects,
    setAutomationDraftWarningContext,
    setAutomationDraftForm,
    setAutomationDraftWarnings,
    setAcknowledgedAutomationWarnings,
    setAutomationDraftOpen,
    workflowRunState,
    composerModelOptions,
    selectedRuntimeModel,
    lockedProvider,
    selectedModelForPickerWithCustomFallback,
    modelOptionsByProvider,
    showComposerModelBootstrapSkeleton,
    selectedProviderRuntimeModelDiscoveryPending,
    loadingModelProviders,
    discoveryErrorsByProvider,
    runtimeModelsByProvider,
    providerModelDiscoveryCwd,
    selectedModelSelection,
    onAdvanceActivePendingUserInput,
    activePendingQuestion,
    activePendingUserInput,
    onChangeActivePendingUserInputCustomAnswer,
  } = provider;
  const {
    scheduleComposerFocus,
    computerControlChangeSequence,
    setThreadError,
    isVoiceTranscribing,
    waitForPendingComposerImages,
    handleModelPickerOpenChange,
    reportChatActionFailure,
    handleComputerControlModeChange,
  } = composer;
  const {
    isLocalDraftThread,
    activeLatestTurn,
    activeProject,
    isServerThread,
    chatWorkspaceRoot,
    isHomeChatContainer,
    resolvedThreadWorktreePath,
    isContainerLandingProject,
    setSettledThreadBranchWarningDismissedThreadId,
    activeThreadId,
    activeThreadAssociatedWorktree,
    activeContextWindow,
    threadActivities,
    runtimeMode,
    interactionMode,
  } = workspace;
  const {
    turnDispatchSettings,
    setEnvironmentPanelPreferenceOpen,
    environmentPanelPreferenceOpen,
    armTranscriptAutoFollow,
    tailAnchorScrollInFlightRef,
    runProjectScript,
    persistThreadSettingsForNextTurn,
    envMode,
    handleInteractionModeChange,
    toggleInteractionMode,
  } = environment;
  const {
    clearComposerInput,
    prepareAutomationFormForCreate,
    createAutomationFromForm,
    onProviderModelSelect,
  } = actions;
  const {
    threadWorkspaceCwd,
    activeRootBranch,
    gitBranchSourceCwd,
    isCenteredEmptyLanding,
    setTailAnchor,
    threadNotes,
    setOptimisticUserMessages,
    canCompactThread,
    supportsTextNativeReviewCommand,
    providerNativeCommands,
    localFolderBrowseRootPath,
    promptHistory,
    isLocalFolderBrowserOpen,
    isComposerApprovalState,
  } = transcript;
  const {
    refreshProviderStatuses,
    hasNativeUserMessages,
    currentActiveGitBranch,
    providerStatuses,
    rememberCustomBinaryPathForDispatch,
    modelPickerShortcutLabel,
    supportsFastSlashCommand,
    canOfferExportCommand,
    fastModeEnabled,
    currentProviderModelOptions,
    composerMenuItems,
  } = discovery;

  const lateComposerSendHandlersRef = useRef<LateComposerSendHandlers | null>(null);

  const {
    setQueuedSteerGate,
    removeQueuedComposerTurn,
    onSteerQueuedComposerTurn,
    onEditQueuedComposerTurn,
  } = useChatQueuedTurns({
    threadId,
    queuedComposerTurns,
    activeThread,
    promptRef,
    clearComposerDraftContent,
    setComposerDraftPrompt,
    setDraftThreadContext,
    addComposerImagesToDraft,
    addComposerFilesToDraft,
    addComposerAssistantSelectionToDraft,
    addComposerDraftBrowserAnnotations,
    addComposerFileCommentToDraft,
    addComposerTerminalContextsToDraft,
    addComposerPastedTextsToDraft,
    addComposerPullRequestContextsToDraft,
    updateSelectedComposerSkills,
    updateSelectedComposerMentions,
    setRestoredQueuedSourceProposedPlan,
    setComposerDraftModelSelection,
    setComposerDraftRuntimeMode,
    setComposerDraftInteractionMode,
    setComposerDraftComputerControlMode,
    setComposerCursor,
    setComposerTrigger,
    scheduleComposerFocus,
    removeQueuedComposerTurnFromDraft,
    lateComposerSendHandlersRef,
    insertQueuedComposerTurn,
    phase,
    localDispatch,
    isLocalDraftThread,
    activeLatestTurn,
    isConnecting,
    activePendingApproval,
    activePendingProgress,
    pendingUserInputs,
    hasPendingCacheReview: activeThread?.claudeCacheReview != null,
    sendInFlightRef,
    sendPreflightInFlightRef,
  });

  const { onSend } = useChatTurnSubmission({
    threadId,
    hasLiveTurn,
    lateComposerSendHandlersRef,
    activeThread,
    isConnecting,
    sendPreflightInFlightRef,
    sendInFlightRef,
    turnDispatchSettings,
    computerControlChangeSequence,
    showPlanFollowUpPrompt,
    activeProposedPlan,
    hasQueueableLiveTurn,
    clearComposerInput,
    scheduleComposerFocus,
    activeProject,
    threadWorkspaceCwd,
    refreshProviderStatuses,
    isServerThread,
    hasNativeUserMessages,
    chatWorkspaceRoot,
    isHomeChatContainer,
    resolvedThreadWorktreePath,
    currentActiveGitBranch,
    isContainerLandingProject,
    syncServerShellSnapshot,
    activeRootBranch,
    gitBranchSourceCwd,
    setStoreThreadError,
    queryClient,
    isCenteredEmptyLanding,
    setEnvironmentPanelPreferenceOpen,
    environmentPanelPreferenceOpen,
    setTailAnchor,
    setThreadError,
    setComposerHighlightedItemId,
    setStoreThreadWorkspace,
    createWorktreeMutation,
    isLocalDraftThread,
    threadNotes,
    setSettledThreadBranchWarningDismissedThreadId,
    setQueuedSteerGate,
    planSidebarDismissedForTurnRef,
    setPlanSidebarOpen,
    settings,
    isSendBusy,
    worktreeSetupResolutionRef,
    setWorktreeSetupPendingAction,
    beginLocalDispatch,
    clearLocalDispatchWorktreeSetup,
    armLocalDispatchAckFallback,
    failLocalDispatchWorktreeSetup,
    scheduleFailedWorktreeSetupDispatchReset,
    resetLocalDispatch,
    isVoiceTranscribing,
    waitForPendingComposerImages,
    activePendingProgress,
    activePendingUserInputKey,
    pendingUserInputAnswersByRequestIdRef,
    setPendingUserInputAnswersByRequestId,
    composerEditorRef,
    promptRef,
    composerImages,
    composerFiles,
    composerAssistantSelections,
    composerBrowserAnnotations,
    composerFileComments,
    composerTerminalContexts,
    composerPastedTexts,
    composerPullRequestContexts,
    restoredQueuedSourceProposedPlanRef,
    enqueueQueuedComposerTurn,
    setComposerDraftPrompt,
    setComposerTrigger,
    clearProjectDraftThreadId,
    setDraftThreadContext,
    promptHistoryNavigationRef,
    applyingPromptHistoryNavigationRef,
    expectedPromptHistoryPromptRef,
    clearComposerDraftContent,
    setComposerDraftInteractionMode,
    setComposerCursor,
    setRestoredQueuedSourceProposedPlan,
    composerImagesRef,
    composerFilesRef,
    composerAssistantSelectionsRef,
    composerBrowserAnnotationsRef,
    composerFileCommentsRef,
    composerTerminalContextsRef,
    composerPastedTextsRef,
    composerPullRequestContextsRef,
    setPrompt,
    addComposerImagesToDraft,
    addComposerFilesToDraft,
    addComposerAssistantSelectionToDraft,
    addComposerDraftBrowserAnnotations,
    addComposerFileCommentToDraft,
    addComposerTerminalContextsToDraft,
    addComposerPastedTextsToDraft,
    addComposerPullRequestContextsToDraft,
    selectedComposerSkillsRef,
    selectedComposerMentionsRef,
    updateSelectedComposerSkills,
    updateSelectedComposerMentions,
    selectedProvider,
    selectedModel,
    selectedPromptEffort,
    pendingAutomationConversationRef,
    setPendingAutomationConversation,
    pendingAutomationConversation,
    activeThreadIdRef,
    hasLiveTurnRef,
    automationProjects,
    setAutomationDraftWarningContext,
    setAutomationDraftForm,
    setAutomationDraftWarnings,
    setAcknowledgedAutomationWarnings,
    setAutomationDraftOpen,
    armTranscriptAutoFollow,
    tailAnchorScrollInFlightRef,
    prepareAutomationFormForCreate,
    createAutomationFromForm,
    providerStatuses,
    rememberCustomBinaryPathForDispatch,
    setOptimisticUserMessages,
    runProjectScript,
    persistThreadSettingsForNextTurn,
  });

  const {
    onSubmitPlanFollowUp,
    onEditUserMessage,
    onResumeWorkflowRun,
    onImplementPlanInNewThread,
  } = useChatTurnFollowUps({
    threadId,
    activeThread,
    isServerThread,
    isConnecting,
    sendInFlightRef,
    setThreadError,
    setTailAnchor,
    turnDispatchSettings,
    computerControlChangeSequence,
    setComposerDraftComputerControlMode,
    activeProposedPlan,
    setQueuedSteerGate,
    planSidebarDismissedForTurnRef,
    setPlanSidebarOpen,
    isRevertingCheckpoint,
    setIsRevertingCheckpoint,
    isSendBusy,
    beginLocalDispatch,
    armLocalDispatchAckFallback,
    resetLocalDispatch,
    selectedProvider,
    selectedModel,
    selectedPromptEffort,
    setOptimisticUserMessages,
    armTranscriptAutoFollow,
    tailAnchorScrollInFlightRef,
    persistThreadSettingsForNextTurn,
    setComposerDraftInteractionMode,
    rememberCustomBinaryPathForDispatch,
    workflowRunState,
    lateComposerSendHandlersRef,
    activeThreadId,
    markWorkflowRunDismissed,
    activeProject,
    activeThreadAssociatedWorktree,
    syncServerShellSnapshot,
    planSidebarOpenOnNextThreadRef,
    navigate,
  });

  const setPromptFromTraits = useCallback(
    (nextPrompt: string) => {
      const currentPrompt = promptRef.current;
      if (nextPrompt === currentPrompt) {
        scheduleComposerFocus();
        return;
      }
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      scheduleComposerFocus();
    },
    [promptRef, setComposerCursor, setComposerTrigger, scheduleComposerFocus, setPrompt],
  );

  const selectedProviderModelOptions = composerModelOptions?.[selectedProvider];

  const composerTraitSelection = getComposerTraitSelection(
    selectedProvider,
    selectedModel,
    prompt,
    selectedProviderModelOptions,
    selectedRuntimeModel,
  );

  const runtimeUsageContextWindow = activeContextWindow;

  const appliedContextWindowSelection = useMemo(
    () => deriveAppliedContextWindowSelection(threadActivities),
    [threadActivities],
  );

  const contextWindowSelectionStatus = useMemo(
    () =>
      deriveContextWindowSelectionStatus({
        activeSnapshot: runtimeUsageContextWindow,
        ...(selectedProvider === "claudeAgent"
          ? { appliedValue: appliedContextWindowSelection }
          : {}),
        selectedValue:
          selectedProvider === "claudeAgent" ? composerTraitSelection.contextWindow : null,
      }),
    [
      runtimeUsageContextWindow,
      composerTraitSelection.contextWindow,
      selectedProvider,
      appliedContextWindowSelection,
    ],
  );

  const composerContextWindowLabel = deriveComposerContextWindowLabel({
    provider: selectedProvider,
    model: selectedModel,
    snapshot: runtimeUsageContextWindow,
    status: contextWindowSelectionStatus,
  });

  const composerFooterControlsPlan = useMemo(
    () => composerFooterPlanForTier(composerFooterTier, Boolean(runtimeUsageContextWindow)),
    [composerFooterTier, runtimeUsageContextWindow],
  );

  const composerFooterModelLabel = resolveProviderModelLabel({
    provider: selectedProvider,
    lockedProvider,
    model: selectedModelForPickerWithCustomFallback,
    modelOptionsByProvider,
  });

  const composerFooterTraitsSummary = resolveTraitsTriggerSummary({
    provider: selectedProvider,
    model: selectedModelForPickerWithCustomFallback,
    prompt,
    modelOptions: selectedProviderModelOptions,
    ...(selectedRuntimeModel ? { runtimeModel: selectedRuntimeModel } : {}),
  });

  const composerFooterPlanInputsKey = [
    composerFooterModelLabel,
    composerFooterTraitsSummary.summaryText,
    composerContextWindowLabel,
    Boolean(runtimeUsageContextWindow),
  ].join(":");

  useLayoutEffect(() => {
    composerFooterDemotionWidthsRef.current = [];
    composerFooterTierRef.current = 0;
    setComposerFooterTier(0);
    composerFooterLayoutSyncRef.current?.();
  }, [
    setComposerFooterTier,
    composerFooterTierRef,
    composerFooterDemotionWidthsRef,
    composerFooterLayoutSyncRef,
    composerFooterPlanInputsKey,
  ]);

  useLayoutEffect(() => {
    composerFooterLayoutSyncRef.current?.();
  }, [composerFooterLayoutSyncRef, composerFooterTier]);

  const composerModelEffortPickerWidthClassName = isComposerFooterCompact ? "w-40" : "w-44 sm:w-52";

  const handleComposerModelEffortPickerOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        handleModelPickerOpenChange(true);
      } else {
        setIsModelPickerOpen(false);
        setIsTraitsPickerOpen(false);
      }
    },
    [setIsModelPickerOpen, setIsTraitsPickerOpen, handleModelPickerOpenChange],
  );

  const composerPickerControls = showComposerModelBootstrapSkeleton ? (
    selectedProviderRuntimeModelDiscoveryPending ? (
      <ComposerModelLoadingControl widthClassName={composerModelEffortPickerWidthClassName} />
    ) : (
      <ComposerControlSkeleton widthClassName={composerModelEffortPickerWidthClassName} />
    )
  ) : (
    <ComposerModelPicker
      hideModelLabel={!composerFooterControlsPlan.showModelLabel}
      hideStatusLabel={!composerFooterControlsPlan.showTraitsLabel}
      contextWindowLabel={composerContextWindowLabel}
      effortControl={settings.composerEffortSlider ? "slider" : "menu"}
      provider={selectedProvider}
      model={selectedModelForPickerWithCustomFallback}
      providers={providerStatuses}
      modelOptionsByProvider={modelOptionsByProvider}
      loadingModelProviders={loadingModelProviders}
      discoveryErrorsByProvider={discoveryErrorsByProvider}
      hiddenProviders={settings.hiddenProviders}
      providerOrder={settings.providerOrder}
      threadId={threadId}
      runtimeModel={selectedRuntimeModel}
      runtimeModelsByProvider={runtimeModelsByProvider}
      modelOptions={selectedProviderModelOptions}
      prompt={prompt}
      onPromptChange={setPromptFromTraits}
      onProviderModelChange={(...args: Parameters<typeof onProviderModelSelect>) => {
        void onProviderModelSelect(...args).catch(reportChatActionFailure);
      }}
      onSelectionCommitted={scheduleComposerFocus}
      open={isComposerModelEffortPickerOpen}
      onOpenChange={handleComposerModelEffortPickerOpenChange}
      shortcutLabel={modelPickerShortcutLabel}
    />
  );

  const toggleFastMode = useCallback(() => {
    if (!composerTraitSelection.caps.supportsFastMode) {
      scheduleComposerFocus();
      return;
    }
    setComposerDraftProviderModelOptions(
      threadId,
      selectedProvider,
      buildNextProviderOptions(selectedProvider, selectedProviderModelOptions, {
        fastMode: !composerTraitSelection.fastModeEnabled,
      }),
      { persistSticky: true },
    );
    scheduleComposerFocus();
  }, [
    composerTraitSelection.caps.supportsFastMode,
    composerTraitSelection.fastModeEnabled,
    scheduleComposerFocus,
    selectedProvider,
    selectedProviderModelOptions,
    setComposerDraftProviderModelOptions,
    threadId,
  ]);

  const {
    onEnvModeChange,
    handleResetWorkspaceToHome,
    handleSelectWorkspaceRoot,
    handleSelectProjectForEmptyDraft,
    handleCreateProjectFromPickerPath,
  } = useChatWorkspaceSelection({
    threadId,
    activeThread,
    activeProject,
    activeRootBranch,
    isServerThread,
    isLocalDraftThread,
    isHomeChatContainer,
    hasNativeUserMessages,
    composerEditorRef,
    scheduleComposerFocus,
    defaultProvider: settings.defaultProvider,
  });

  const {
    applyPromptReplacement,
    resolveActiveComposerTrigger,
    applyComposerTriggerReplacement,
    handleSelectLocalDirectoryMention,
    handleNavigateLocalFolder,
    setComposerPromptValue,
    clearComposerSlashDraft,
  } = useChatComposerEditing({
    threadId,
    promptRef,
    activePendingProgress,
    activePendingUserInputKey,
    pendingUserInputAnswersByRequestIdRef,
    setPendingUserInputAnswersByRequestId,
    setPrompt,
    setComposerCursor,
    setComposerTrigger,
    composerEditorRef,
    composerCursor,
    composerTerminalContexts,
    setComposerHighlightedItemId,
    setRestoredQueuedSourceProposedPlan,
    clearComposerDraftContent,
    scheduleComposerFocus,
  });

  const handleEnableComputerControlFromDenial = useCallback(() => {
    const currentPrompt = composerEditorRef.current?.readSnapshot()?.value ?? promptRef.current;
    if (!parseComputerInvocation(currentPrompt)) {
      setComposerPromptValue(`/computer-use ${currentPrompt}`);
    }
    handleComputerControlModeChange("request");
  }, [composerEditorRef, promptRef, setComposerPromptValue, handleComputerControlModeChange]);

  const slashEditorActions = useMemo(
    () => ({
      resolveActiveComposerTrigger,
      applyPromptReplacement,
      clearComposerSlashDraft,
      setComposerPromptValue,
      scheduleComposerFocus,
      setComposerHighlightedItemId,
    }),
    [
      setComposerHighlightedItemId,
      applyPromptReplacement,
      clearComposerSlashDraft,
      resolveActiveComposerTrigger,
      scheduleComposerFocus,
      setComposerPromptValue,
    ],
  );

  const {
    handleForkFromMessage,
    handleForkTargetSelection,
    handleReviewTargetSelection,
    isSlashStatusDialogOpen,
    setIsSlashStatusDialogOpen,
    handleStandaloneSlashCommand,
    handleSlashCommandSelection,
    clearThreadGoal,
    setThreadGoalPaused,
  } = useComposerSlashCommands({
    activeProject,
    activeThread,
    activeRootBranch,
    isServerThread,
    isLocalDraftThread,
    supportsFastSlashCommand,
    canOfferCompactCommand:
      canCompactThread &&
      isServerThread &&
      activeThread?.session !== null &&
      activeThread?.session?.status !== "closed",
    canOfferExportCommand,
    supportsTextNativeReviewCommand,
    fastModeEnabled,
    providerNativeCommands,
    providerCommandDiscoveryCwd: providerModelDiscoveryCwd,
    selectedProvider,
    currentProviderModelOptions,
    selectedModelSelection,
    environmentMode: envMode ?? null,
    runtimeMode,
    interactionMode,
    threadId,
    syncServerShellSnapshot,
    navigateToThread: (nextThreadId, options) =>
      navigate({
        to: "/$threadId",
        params: { threadId: nextThreadId },
        ...(options?.splitViewId ? { search: () => ({ splitViewId: options.splitViewId }) } : {}),
      }),
    handleClearConversation: async () => {
      if (!activeProject) {
        toastManager.add({
          type: "warning",
          title: "Clear is unavailable",
          description: "Open a project before starting a fresh thread.",
        });
        return;
      }
      await handleNewThread(activeProject.id);
    },
    handleInteractionModeChange,
    openForkTargetPicker: () => {
      setComposerCommandPicker("fork-target");
      setComposerHighlightedItemId("fork-target:worktree");
    },
    openReviewTargetPicker: () => {
      setComposerCommandPicker("review-target");
      setComposerHighlightedItemId("review-target:changes");
    },
    setComposerDraftProviderModelOptions,
    editorActions: slashEditorActions,
  });

  const insertGoalSlashCommandInComposer = useCallback(() => {
    const currentPrompt = promptRef.current;
    if (/^\s*\/goal\b/i.test(currentPrompt)) {
      scheduleComposerFocus();
      return;
    }
    setComposerPromptValue(buildGoalSlashCommandPrompt(currentPrompt));
  }, [promptRef, scheduleComposerFocus, setComposerPromptValue]);

  const editThreadGoalInComposer = useCallback(() => {
    const currentGoal = activeThread?.goal?.trim();
    if (!activeThread || !currentGoal) {
      return;
    }
    const nextPrompt = buildGoalSlashCommandPrompt(currentGoal);
    promptRef.current = nextPrompt;
    clearComposerDraftContent(activeThread.id);
    setComposerDraftPrompt(activeThread.id, nextPrompt);
    setComposerCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
    setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
    scheduleComposerFocus();
  }, [
    promptRef,
    setComposerCursor,
    setComposerTrigger,
    activeThread,
    clearComposerDraftContent,
    scheduleComposerFocus,
    setComposerDraftPrompt,
  ]);

  useLayoutEffect(() => {
    lateComposerSendHandlersRef.current = {
      send: onSend,
      submitPlanFollowUp: onSubmitPlanFollowUp,
      advanceActivePendingUserInput: onAdvanceActivePendingUserInput,
      handleStandaloneSlashCommand,
    };
  });

  const {
    onSelectComposerItem,
    onComposerMenuItemHighlighted,
    onPromptChange,
    onComposerCommandKey,
  } = useChatComposerCommands({
    threadId,
    composerSelectLockRef,
    setComposerCommandPicker,
    setComposerHighlightedItemId,
    handleForkTargetSelection,
    handleReviewTargetSelection,
    resolveActiveComposerTrigger,
    applyComposerTriggerReplacement,
    handleNavigateLocalFolder,
    localFolderBrowseRootPath,
    handleSlashCommandSelection,
    selectedProvider,
    scheduleComposerFocus,
    updateSelectedComposerSkills,
    updateSelectedComposerMentions,
    onProviderModelSelect,
    composerMenuItems,
    composerHighlightedItemId,
    activePendingQuestion,
    activePendingUserInput,
    promptHistoryNavigationRef,
    restoreComposerDraftPromptHistorySavedDraft,
    promptRef,
    setPrompt,
    expectedPromptHistoryPromptRef,
    onChangeActivePendingUserInputCustomAnswer,
    setComposerDraftPromptHistorySavedDraft,
    applyingPromptHistoryNavigationRef,
    promptHistory,
    promptHistoryAppliedPromptRef,
    restoredQueuedSourceProposedPlanRef,
    setRestoredQueuedSourceProposedPlan,
    composerCommandPicker,
    composerTerminalContexts,
    setComposerDraftTerminalContexts,
    setComposerCursor,
    setComposerTrigger,
    clearComposerSlashDraft,
    toggleInteractionMode,
    composerMenuOpenRef,
    onSend,
    settings,
    hasLiveTurn,
    isLocalFolderBrowserOpen,
    localDirectoryMenuRef,
    composerMenuItemsRef,
    activeComposerMenuItemRef,
    activePendingProgress,
    isComposerApprovalState,
    pendingUserInputs,
    composerDraft,
  });
  return {
    removeQueuedComposerTurn,
    onSteerQueuedComposerTurn,
    onEditQueuedComposerTurn,
    onSend,
    onEditUserMessage,
    onResumeWorkflowRun,
    onImplementPlanInNewThread,
    selectedProviderModelOptions,
    composerTraitSelection,
    runtimeUsageContextWindow,
    contextWindowSelectionStatus,
    composerFooterControlsPlan,
    composerPickerControls,
    toggleFastMode,
    onEnvModeChange,
    handleResetWorkspaceToHome,
    handleSelectWorkspaceRoot,
    handleSelectProjectForEmptyDraft,
    handleCreateProjectFromPickerPath,
    handleSelectLocalDirectoryMention,
    handleNavigateLocalFolder,
    handleEnableComputerControlFromDenial,
    handleForkFromMessage,
    isSlashStatusDialogOpen,
    setIsSlashStatusDialogOpen,
    clearThreadGoal,
    setThreadGoalPaused,
    insertGoalSlashCommandInComposer,
    editThreadGoalInComposer,
    onSelectComposerItem,
    onComposerMenuItemHighlighted,
    onPromptChange,
    onComposerCommandKey,
  } as const;
}
