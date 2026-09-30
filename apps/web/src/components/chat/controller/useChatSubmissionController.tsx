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
    activeThread,
    promptRef,
    clearComposerDraftContent,
    setComposerDraftPrompt,
    setComposerCursor,
    setComposerTrigger,
    syncServerShellSnapshot,
    setComposerHighlightedItemId,
    settings,
    composerEditorRef,
    setPrompt,
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
    handleNewThread,
    setComposerCommandPicker,
  } = session;
  const {
    selectedProvider,
    selectedModel,
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
  } = provider;
  const {
    scheduleComposerFocus,
    handleModelPickerOpenChange,
    reportChatActionFailure,
    handleComputerControlModeChange,
  } = composer;
  const {
    isLocalDraftThread,
    activeProject,
    isServerThread,
    activeContextWindow,
    threadActivities,
    runtimeMode,
    interactionMode,
  } = workspace;
  const { envMode, handleInteractionModeChange } = environment;
  const { onProviderModelSelect } = actions;
  const {
    activeRootBranch,
    canCompactThread,
    supportsTextNativeReviewCommand,
    providerNativeCommands,
  } = transcript;
  const {
    providerStatuses,
    modelPickerShortcutLabel,
    supportsFastSlashCommand,
    canOfferExportCommand,
    fastModeEnabled,
    currentProviderModelOptions,
  } = discovery;

  const lateComposerSendHandlersRef = useRef<LateComposerSendHandlers | null>(null);

  const {
    setQueuedSteerGate,
    removeQueuedComposerTurn,
    onSteerQueuedComposerTurn,
    onEditQueuedComposerTurn,
  } = useChatQueuedTurns({
    session,
    provider,
    composer,
    turn: {
      lateComposerSendHandlersRef,
      hasPendingCacheReview: activeThread?.claudeCacheReview != null,
    },
    workspace,
  });

  const { onSend } = useChatTurnSubmission({
    props,
    provider,
    turn: { lateComposerSendHandlersRef, setQueuedSteerGate },
    session,
    environment,
    composer,
    actions,
    workspace,
    transcript,
    discovery,
  });

  const {
    onSubmitPlanFollowUp,
    onEditUserMessage,
    onResumeWorkflowRun,
    onImplementPlanInNewThread,
  } = useChatTurnFollowUps({
    session,
    workspace,
    provider,
    composer,
    transcript,
    environment,
    turn: { setQueuedSteerGate, lateComposerSendHandlersRef },
    discovery,
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
    session,
    workspace,
    transcript,
    discovery,
    composer,
    turn: { defaultProvider: settings.defaultProvider },
  });

  const {
    applyPromptReplacement,
    resolveActiveComposerTrigger,
    applyComposerTriggerReplacement,
    handleSelectLocalDirectoryMention,
    handleNavigateLocalFolder,
    setComposerPromptValue,
    clearComposerSlashDraft,
  } = useChatComposerEditing({ session, provider, composer });

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
    thread: {
      activeProject,
      activeThread,
      activeRootBranch,
      isServerThread,
      isLocalDraftThread,
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
    },
    provider: {
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
      setComposerDraftProviderModelOptions,
    },
    editor: {
      handleInteractionModeChange,
      openForkTargetPicker: () => {
        setComposerCommandPicker("fork-target");
        setComposerHighlightedItemId("fork-target:worktree");
      },
      openReviewTargetPicker: () => {
        setComposerCommandPicker("review-target");
        setComposerHighlightedItemId("review-target:changes");
      },
      editorActions: slashEditorActions,
    },
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
    session,
    turn: {
      handleForkTargetSelection,
      handleReviewTargetSelection,
      resolveActiveComposerTrigger,
      applyComposerTriggerReplacement,
      handleNavigateLocalFolder,
      handleSlashCommandSelection,
      clearComposerSlashDraft,
      onSend,
    },
    transcript,
    provider,
    composer,
    actions,
    discovery,
    environment,
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
