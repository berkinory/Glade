import { resolveFollowUpDispatchMode } from "~/appSettings";
import { parseComputerInvocation } from "@glade/shared/computer/computerInvocation";
import { useLayoutEffect, useRef } from "react";
import { ComposerModelMenuTrigger } from "~/components/chat/ComposerModelMenuTrigger";
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

import { useComposerSlashCommands } from "~/hooks/useComposerSlashCommands";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { buildNextProviderOptions } from "~/providerModelOptions";
import { type ChatViewProps } from "./chatViewSupport";
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
  const { isLocalDraftThread, activeProject, isServerThread, activeContextWindow, runtimeMode } =
    workspace;
  const { envMode } = environment;
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

  const voiceSendRef = useRef(onSend);
  useLayoutEffect(() => {
    voiceSendRef.current = onSend;
  }, [onSend]);
  const finishVoiceRecording = (send: boolean, useOppositeBehavior: boolean) => {
    const dispatchMode = resolveFollowUpDispatchMode({
      behavior: settings.followUpBehavior,
      hasLiveTurn: provider.hasLiveTurn,
      useOppositeBehavior,
    });
    void composer
      .submitComposerVoiceRecording(
        send
          ? () => {
              void voiceSendRef.current(undefined, dispatchMode).catch(reportChatActionFailure);
            }
          : undefined,
      )
      .catch(reportChatActionFailure);
  };

  const { onEditUserMessage, onResumeWorkflowRun } = useChatTurnFollowUps({
    session,
    workspace,
    provider,
    composer,
    transcript,
    environment,
    turn: { setQueuedSteerGate, lateComposerSendHandlersRef },
    discovery,
  });

  const setPromptFromTraits = (nextPrompt: string) => {
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
  };

  const selectedProviderModelOptions = composerModelOptions?.[selectedProvider];

  const composerTraitSelection = getComposerTraitSelection(
    selectedProvider,
    selectedModel,
    prompt,
    selectedProviderModelOptions,
    selectedRuntimeModel,
  );

  const runtimeUsageContextWindow = activeContextWindow;

  const contextWindowSelectionStatus = {
    activeLabel: runtimeUsageContextWindow?.maxTokens
      ? formatContextWindowTokens(runtimeUsageContextWindow.maxTokens)
      : null,
    pendingSelectedLabel: null,
  };

  const composerFooterControlsPlan = composerFooterPlanForTier(
    composerFooterTier,
    Boolean(runtimeUsageContextWindow),
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

  const handleComposerModelEffortPickerOpenChange = (open: boolean) => {
    if (open) {
      handleModelPickerOpenChange(true);
    } else {
      handleModelPickerOpenChange(false);
      setIsTraitsPickerOpen(false);
    }
  };

  const composerPickerControls = showComposerModelBootstrapSkeleton ? (
    <ComposerModelMenuTrigger
      provider={selectedProvider}
      modelLabel={composerFooterModelLabel}
      statusLabel={composerFooterTraitsSummary.primaryLabel}
      showsFastBadge={composerFooterTraitsSummary.showsFastBadge}
      hideModelLabel={!composerFooterControlsPlan.showModelLabel}
      hideStatusLabel={!composerFooterControlsPlan.showTraitsLabel}
      isMenuOpen={false}
      loading
    />
  ) : (
    <ComposerModelPicker
      hideModelLabel={!composerFooterControlsPlan.showModelLabel}
      hideStatusLabel={!composerFooterControlsPlan.showTraitsLabel}
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

  const toggleFastMode = () => {
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
  };

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

  const handleEnableComputerControlFromDenial = () => {
    const currentPrompt = composerEditorRef.current?.readSnapshot()?.value ?? promptRef.current;
    if (!parseComputerInvocation(currentPrompt)) {
      setComposerPromptValue(`/computer-use ${currentPrompt}`);
    }
    handleComputerControlModeChange("request");
  };

  const slashEditorActions = {
    resolveActiveComposerTrigger,
    applyPromptReplacement,
    clearComposerSlashDraft,
    setComposerPromptValue,
    scheduleComposerFocus,
    setComposerHighlightedItemId,
  };

  const {
    handleForkFromMessage,
    handleForkTargetSelection,
    handleReviewTargetSelection,
    handleStandaloneSlashCommand,
    handleSlashCommandSelection,
  } = useComposerSlashCommands({
    thread: {
      activeProject,
      activeThread,
      activeRootBranch,
      isServerThread,
      isLocalDraftThread,
      environmentMode: envMode ?? null,
      runtimeMode,

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

  useLayoutEffect(() => {
    lateComposerSendHandlersRef.current = {
      send: onSend,

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
    composer: { ...composer, finishVoiceRecording },
    actions,
    discovery,
  });
  return {
    removeQueuedComposerTurn,
    onSteerQueuedComposerTurn,
    onEditQueuedComposerTurn,
    onSend,
    onEditUserMessage,
    onResumeWorkflowRun,

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

    onSelectComposerItem,
    onComposerMenuItemHighlighted,
    onPromptChange,
    onComposerCommandKey,
  } as const;
}
