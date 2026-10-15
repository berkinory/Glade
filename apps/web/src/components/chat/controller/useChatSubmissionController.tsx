import { resolveFollowUpDispatchMode } from "~/appSettings";
import { resolveFallbackProvider } from "~/providerOrdering";
import { providerCapabilities } from "@glade/shared/provider/providerMetadata";
import { useLayoutEffect, useRef } from "react";
import { ComposerModelMenuTrigger } from "~/components/chat/ComposerModelMenuTrigger";
import { ComposerModelPicker } from "~/components/chat/ComposerModelPicker";
import { ComposerTraitsPicker } from "~/components/chat/ComposerTraitsPicker";
import { resolveProviderModelLabel } from "~/components/chat/ProviderModelPicker";
import type { LateComposerSendHandlers } from "~/components/chat/chatSendTypes";
import {
  getComposerTraitSelection,
  resolveComposerTraitsSummary,
} from "~/components/chat/composerTraits";
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
import { deriveFastModeUnavailableNotice } from "~/lib/fastModeStatus";
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
    setPrompt,
    navigate,
    prompt,
    composerFooterTier,
    composerFooterDemotionWidthsRef,
    composerFooterTierRef,
    setComposerFooterTier,
    composerFooterLayoutSyncRef,
    isModelPickerOpen,
    isTraitsPickerOpen,
    setComposerDraftProviderModelOptions,
    handleNewThread,
    setComposerCommandPicker,
  } = session;
  const {
    selectedProvider,
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
    handleTraitsPickerOpenChange,
    reportChatActionFailure,
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
    traitsPickerShortcutLabel,
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
    queuePause,
    onResumeQueuedComposerTurns,
    onEditPausedQueuedComposerTurn,
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

  const { onEditUserMessage, onRewindToMessage, onContinueFailedTurn, onResumeWorkflowRun } =
    useChatTurnFollowUps({
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

  const composerFooterTraitsSummary = resolveComposerTraitsSummary(
    getComposerTraitSelection(
      selectedProvider,
      selectedModelForPickerWithCustomFallback,
      prompt,
      selectedProviderModelOptions,
      selectedRuntimeModel,
    ),
  );

  const composerFooterPlanInputsKey = [
    composerFooterModelLabel.displayName,
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

  const composerPickerControls = showComposerModelBootstrapSkeleton ? (
    <ComposerModelMenuTrigger
      provider={selectedProvider}
      modelLabel={composerFooterModelLabel}
      hideModelLabel={!composerFooterControlsPlan.showModelLabel}
      isMenuOpen={false}
      loading
    />
  ) : (
    <div className="flex min-w-0 items-center">
      <ComposerModelPicker
        hideModelLabel={!composerFooterControlsPlan.showModelLabel}
        provider={selectedProvider}
        model={selectedModelForPickerWithCustomFallback}
        providers={providerStatuses}
        modelOptionsByProvider={modelOptionsByProvider}
        loadingModelProviders={loadingModelProviders}
        discoveryErrorsByProvider={discoveryErrorsByProvider}
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
        open={isModelPickerOpen}
        onOpenChange={handleModelPickerOpenChange}
        shortcutLabel={modelPickerShortcutLabel}
      />
      <ComposerTraitsPicker
        threadId={threadId}
        provider={selectedProvider}
        model={selectedModelForPickerWithCustomFallback}
        modelOptions={selectedProviderModelOptions}
        runtimeModel={selectedRuntimeModel}
        fastModeNotice={
          providerCapabilities(selectedProvider).reportsFastModeAvailability && fastModeEnabled
            ? deriveFastModeUnavailableNotice(activeThread?.activities ?? [])
            : null
        }
        hideLabel={!composerFooterControlsPlan.showTraitsLabel}
        shortcutLabel={traitsPickerShortcutLabel}
        open={isTraitsPickerOpen}
        onOpenChange={(open) => {
          handleTraitsPickerOpenChange(open);
          if (!open) scheduleComposerFocus();
        }}
      />
    </div>
  );

  const {
    onEnvModeChange,
    handleSelectEnvironmentForEmptyDraft,
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
    turn: { defaultProvider: resolveFallbackProvider(settings) },
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
      navigateToThread: (nextThreadId) =>
        navigate({ to: "/$threadId", params: { threadId: nextThreadId } }),
      handleClearConversation: async () => {
        if (!activeProject) {
          toastManager.add({
            type: "warning",
            title: "Clear is unavailable",
            description: "Open a project before starting a fresh chat.",
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
    queuePause,
    onResumeQueuedComposerTurns,
    onEditPausedQueuedComposerTurn,
    onSend,
    onEditUserMessage,
    onRewindToMessage,
    onContinueFailedTurn,
    onResumeWorkflowRun,

    selectedProviderModelOptions,
    runtimeUsageContextWindow,
    contextWindowSelectionStatus,
    composerFooterControlsPlan,
    composerPickerControls,
    onEnvModeChange,
    handleSelectEnvironmentForEmptyDraft,
    handleResetWorkspaceToHome,
    handleSelectWorkspaceRoot,
    handleSelectProjectForEmptyDraft,
    handleCreateProjectFromPickerPath,
    handleSelectLocalDirectoryMention,
    handleNavigateLocalFolder,
    handleForkFromMessage,

    onSelectComposerItem,
    onComposerMenuItemHighlighted,
    onPromptChange,
    onComposerCommandKey,
  } as const;
}
