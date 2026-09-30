import { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@glade/contracts/orchestration/threadEntities";
import { type ModelSlug } from "@glade/contracts/provider/model";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { useCallback, useState } from "react";
import { resolveAppModelSelection } from "~/appSettings";
import {
  commitAfterRuntimeModePersistence,
  resolveCommittedProviderModel,
} from "~/components/ChatView.logic";
import { localSubagentThreadId } from "~/components/ChatView.selectors";
import { type ComposerModelSelectionOptions } from "~/components/chat/ComposerModelPicker";
import {
  collectForegroundRunningSubagentStripItems,
  collectRunningSubagentStripItems,
  type ComposerSubagentStripItem,
} from "~/components/chat/ComposerSubagentStrip.logic";
import { resolveRuntimeModelDescriptor } from "~/components/chat/runtimeModelCapabilities";
import { useChatAutomationCreation } from "~/components/chat/useChatAutomationCreation";
import { useChatKeyboardShortcuts } from "~/components/chat/useChatKeyboardShortcuts";
import { toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveThreadMentionForThreadId } from "~/hooks/useComposerCommandMenuItems";
import { splitComposerDropzoneFiles, useComposerDropzone } from "~/hooks/useComposerDropzone";
import { useComposerThreadMentionDrop } from "~/hooks/useComposerThreadMentionDrop";
import { useCopyThreadIdToClipboard } from "~/hooks/useCopyToClipboard";
import { appendComposerPromptText } from "~/lib/chatReferences";
import { formatComposerMentionToken } from "~/lib/composerMentions";
import {
  buildComposerFileAttachmentsFromFiles,
  effectiveComposerAttachmentCount,
} from "~/lib/composerSend";
import { findProviderStatus } from "~/lib/providerAvailability";
import {
  normalizeRuntimeModeForProvider,
  providerModelSupportsAutoRuntimeMode,
} from "~/lib/runtimeMode";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { buildModelSelection } from "~/providerModelOptions";
import { type Thread } from "~/types";
import { ChatViewProps } from "./chatViewSupport";
import type { useChatComposerController } from "./useChatComposerController";
import type { useChatDiscoveryController } from "./useChatDiscoveryController";
import type { useChatEnvironmentController } from "./useChatEnvironmentController";
import type { useChatProviderController } from "./useChatProviderController";
import type { useChatSessionController } from "./useChatSessionController";
import type { useChatTranscriptController } from "./useChatTranscriptController";
import type { useChatWorkspaceController } from "./useChatWorkspaceController";
export function useChatActionsController({
  session,
  provider,
  workspace,
  discovery,
  transcript,
  environment,
  composer,
  props,
}: {
  session: ReturnType<typeof useChatSessionController>;
  provider: ReturnType<typeof useChatProviderController>;
  workspace: ReturnType<typeof useChatWorkspaceController>;
  discovery: ReturnType<typeof useChatDiscoveryController>;
  transcript: ReturnType<typeof useChatTranscriptController>;
  environment: ReturnType<typeof useChatEnvironmentController>;
  composer: ReturnType<typeof useChatComposerController>;
  props: ChatViewProps;
}) {
  const {
    activeThread,
    markWorkflowRunPaused,
    markWorkflowRunDismissed,
    setComposerDraftModelSelectionAndSticky,
    surfaceMode,
    isFocusedPane,
    composerFormRef,
    setThreadFindOpen,
    setThreadFindFocusNonce,
    commitAndPushTriggerRef,
    removeComposerImageFromDraft,
    addComposerFilesToDraft,
    discardPromptHistoryNavigationForComposerMutation,
    removeComposerDraftFile,
    dragDepthRef,
    setIsDragOverComposer,
    composerThreadSummaries,
    composerThreadProjects,
    isRevertingCheckpoint,
    setIsRevertingCheckpoint,
    setPendingFileUndo,
    createThreadHandoff,
    promptHistoryNavigationRef,
    applyingPromptHistoryNavigationRef,
    expectedPromptHistoryPromptRef,
    promptRef,
    setRestoredQueuedSourceProposedPlan,
    clearComposerDraftContent,
    setComposerHighlightedItemId,
    setComposerCursor,
    setComposerTrigger,
    queryClient,
  } = session;
  const {
    workflowRunState,
    stripSourceThreadId,
    composerSubagentStripItems,
    modelOptionsByProvider,
    runtimeModelsByProvider,
    lockedProvider,
    hasLiveTurn,
    selectedProvider,
    selectedModel,
    pendingUserInputs,
    updateSelectedComposerMentions,
    isSendBusy,
    isConnecting,
    updateSelectedComposerSkills,
    automationDraftSubmittingRef,
    providerOptionsForDispatch,
    setIsAutomationDraftSubmitting,
    resetAutomationDraftState,
    selectedModelSelection,
    automationDraftForm,
    automationDraftWarnings,
    acknowledgedAutomationWarnings,
  } = provider;
  const {
    activeThreadId,
    runtimeMode,
    expandTerminalWorkspace,
    terminalState,
    terminalWorkspaceOpen,
    terminalWorkspaceTerminalTabActive,
    terminalWorkspaceChatTabActive,
    toggleTerminalVisibility,
    setTerminalOpen,
    splitTerminalRight,
    splitTerminalLeft,
    splitTerminalDown,
    splitTerminalUp,
    closeTerminal,
    createTerminalFromShortcut,
    openNewFullWidthTerminal,
    closeActiveWorkspaceView,
    setTerminalWorkspaceTab,
    activeProject,
    isServerThread,
    activeThreadAssociatedWorktree,
    interactionMode,
  } = workspace;
  const {
    providerStatuses,
    handoffTargetProviders,
    keybindings,
    shouldRenderChatPaneContent,
    onToggleDiff,
    showGitActions,
    isGitRepo,
    onToggleBrowser,
  } = discovery;
  const { handoffDisabled, isComposerApprovalState, threadNotes } = transcript;
  const { persistRuntimeModeChange, runProjectScript } = environment;
  const {
    scheduleComposerFocus,
    isVoiceRecording,
    isVoiceTranscribing,
    toggleComposerFocus,
    handleModelPickerOpenChange,
    handleTraitsPickerOpenChange,
    submitComposerVoiceRecording,
    startComposerVoiceRecording,
    enqueueComposerImages,
    setThreadError,
    focusComposer,
  } = composer;
  const { onToggleTerminal, onOpenTerminal, onToggleDevicePanel, onSplitSurface, threadId } = props;

  const onInterrupt = useCallback(async () => {
    const api = readNativeApi();
    if (!api || !activeThread) return;
    await api.orchestration.dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: newCommandId(),
      threadId: activeThread.id,
      createdAt: new Date().toISOString(),
    });
  }, [activeThread]);

  const onInterruptFromStopControl = useCallback(() => {
    void onInterrupt().catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not stop the current response",
        description:
          error instanceof Error
            ? error.message
            : "The interrupt request failed. Try again in a moment.",
      });
    });
  }, [onInterrupt]);

  const onStopWorkflowRun = useCallback(async () => {
    const api = readNativeApi();
    if (!api || !activeThread || !workflowRunState) return;
    await api.orchestration.dispatchCommand({
      type: "thread.task.stop",
      commandId: newCommandId(),
      threadId: activeThread.id,
      taskId: workflowRunState.workflowTaskId,
      createdAt: new Date().toISOString(),
    });
  }, [activeThread, workflowRunState]);

  const onBackgroundSubagentStripItem = useCallback(
    async (item: ComposerSubagentStripItem) => {
      const api = readNativeApi();

      if (!api || !stripSourceThreadId) return;
      await api.orchestration.dispatchCommand({
        type: "thread.task.background",
        commandId: newCommandId(),
        threadId: stripSourceThreadId,
        toolUseId: item.providerThreadId,
        createdAt: new Date().toISOString(),
      });
    },
    [stripSourceThreadId],
  );

  const onStopSubagentStripItem = useCallback(
    async (item: ComposerSubagentStripItem) => {
      const api = readNativeApi();
      if (!api || !stripSourceThreadId) return;
      await api.orchestration.dispatchCommand({
        type: "thread.turn.interrupt",
        commandId: newCommandId(),
        threadId: localSubagentThreadId(stripSourceThreadId, item.providerThreadId),
        createdAt: new Date().toISOString(),
      });
    },
    [stripSourceThreadId],
  );

  const onStopAllSubagentStripItems = useCallback(async () => {
    const running = collectRunningSubagentStripItems(composerSubagentStripItems);
    await Promise.all(running.map((item) => onStopSubagentStripItem(item)));
  }, [composerSubagentStripItems, onStopSubagentStripItem]);

  const onBackgroundAllForegroundSubagentStripItems = useCallback(async () => {
    const foreground = collectForegroundRunningSubagentStripItems(composerSubagentStripItems);
    await Promise.all(foreground.map((item) => onBackgroundSubagentStripItem(item)));
  }, [composerSubagentStripItems, onBackgroundSubagentStripItem]);

  const onPauseWorkflowRun = useCallback(async () => {
    if (!workflowRunState || !activeThreadId) return;
    const { workflowTaskId } = workflowRunState;
    markWorkflowRunPaused(activeThreadId, workflowTaskId);
    await onStopWorkflowRun();
  }, [activeThreadId, markWorkflowRunPaused, onStopWorkflowRun, workflowRunState]);

  const onDismissWorkflowRun = useCallback(() => {
    if (!workflowRunState || !activeThreadId) return;
    const { workflowTaskId } = workflowRunState;
    markWorkflowRunDismissed(activeThreadId, workflowTaskId);
  }, [activeThreadId, markWorkflowRunDismissed, workflowRunState]);

  const [pendingProviderHandoff, setPendingProviderHandoff] = useState<{
    modelSelection: ModelSelection;
    runtimeMode: Thread["runtimeMode"];
  } | null>(null);

  const [providerHandoffBusy, setProviderHandoffBusy] = useState(false);

  const onProviderModelSelect = useCallback(
    async (
      provider: ProviderKind,
      model: ModelSlug,
      selectionOptions?: ComposerModelSelectionOptions,
    ) => {
      if (!activeThread) return;
      const resolvedModel = resolveCommittedProviderModel({
        selectedModel: model,
        availableOptions: modelOptionsByProvider[provider],
        fallback: () => resolveAppModelSelection(provider, model),
      });
      const runtimeModel = resolveRuntimeModelDescriptor({
        provider,
        model: resolvedModel,
        runtimeModels: runtimeModelsByProvider[provider],
      });
      const nextModelSelection = buildModelSelection(
        provider,
        resolvedModel,

        selectionOptions?.modelOptions,
        provider === "claudeAgent" ? runtimeModel?.supportsAutoMode : undefined,
      );
      const providerStatus = findProviderStatus(providerStatuses, provider);
      const nextRuntimeMode =
        runtimeMode === "auto" &&
        !providerModelSupportsAutoRuntimeMode(provider, runtimeModel, providerStatus)
          ? "approval-required"
          : normalizeRuntimeModeForProvider(runtimeMode, provider);
      if (lockedProvider !== null && provider !== lockedProvider) {
        if (handoffDisabled || !handoffTargetProviders.includes(provider)) {
          toastManager.add({
            type: "warning",
            title: "Provider handoff unavailable",
            description:
              "Wait for the current task to finish and check that the provider is enabled.",
          });
        } else {
          setPendingProviderHandoff({
            modelSelection: nextModelSelection,
            runtimeMode: nextRuntimeMode,
          });
        }
        return;
      }

      const didCommitSelection = await commitAfterRuntimeModePersistence({
        currentRuntimeMode: runtimeMode,
        nextRuntimeMode,
        persistRuntimeMode: persistRuntimeModeChange,
        commit: () => {
          setComposerDraftModelSelectionAndSticky(activeThread.id, nextModelSelection);
        },
      });
      if (!didCommitSelection) {
        scheduleComposerFocus();
        return;
      }
      scheduleComposerFocus();
    },
    [
      activeThread,
      lockedProvider,
      handoffDisabled,
      handoffTargetProviders,
      modelOptionsByProvider,
      persistRuntimeModeChange,
      providerStatuses,
      runtimeMode,
      runtimeModelsByProvider,
      scheduleComposerFocus,
      setComposerDraftModelSelectionAndSticky,
    ],
  );

  const copyThreadIdToClipboard = useCopyThreadIdToClipboard();

  useChatKeyboardShortcuts({
    onToggleTerminal,
    onOpenTerminal,
    expandTerminalWorkspace,
    onToggleDevicePanel,
    onSplitSurface,
    surfaceMode,
    isFocusedPane,
    activeThreadId,
    hasLiveTurn,
    composerFormRef,
    onInterruptFromStopControl,
    composerSubagentStripItems,
    onBackgroundAllForegroundSubagentStripItems,
    isVoiceRecording,
    isVoiceTranscribing,
    isComposerApprovalState,
    terminalState,
    terminalWorkspaceOpen,
    terminalWorkspaceTerminalTabActive,
    terminalWorkspaceChatTabActive,
    keybindings,
    toggleComposerFocus,
    shouldRenderChatPaneContent,
    setThreadFindOpen,
    setThreadFindFocusNonce,
    handleModelPickerOpenChange,
    scheduleComposerFocus,
    modelOptionsByProvider,
    selectedProvider,
    selectedModel,
    onProviderModelSelect,
    handleTraitsPickerOpenChange,
    toggleTerminalVisibility,
    setTerminalOpen,
    splitTerminalRight,
    splitTerminalLeft,
    splitTerminalDown,
    splitTerminalUp,
    closeTerminal,
    createTerminalFromShortcut,
    openNewFullWidthTerminal,
    closeActiveWorkspaceView,
    setTerminalWorkspaceTab,
    onToggleDiff,
    commitAndPushTriggerRef,
    showGitActions,
    isGitRepo,
    onToggleBrowser,
    copyThreadIdToClipboard,
    activeProject,
    runProjectScript,
    activeThread,
  });

  const toggleComposerVoiceRecording = useCallback(() => {
    if (isVoiceTranscribing) {
      return;
    }
    if (isVoiceRecording) {
      void submitComposerVoiceRecording();
      return;
    }
    void startComposerVoiceRecording();
  }, [
    isVoiceRecording,
    isVoiceTranscribing,
    startComposerVoiceRecording,
    submitComposerVoiceRecording,
  ]);

  const addComposerImages = useCallback(
    (files: readonly File[]) => {
      if (!activeThreadId || files.length === 0) return;

      if (pendingUserInputs.length > 0) {
        toastManager.add({
          type: "error",
          title: "Attach images after answering plan questions.",
        });
        return;
      }

      enqueueComposerImages(files);
    },
    [activeThreadId, enqueueComposerImages, pendingUserInputs.length],
  );

  const removeComposerImage = (imageId: string) => {
    removeComposerImageFromDraft(imageId);
  };

  const addComposerFiles = useCallback(
    (files: readonly File[]) => {
      if (!activeThreadId || files.length === 0) return;

      if (pendingUserInputs.length > 0) {
        toastManager.add({
          type: "error",
          title: "Attach files after answering plan questions.",
        });
        return;
      }

      const { files: nextFiles, error } = buildComposerFileAttachmentsFromFiles({
        files,
        existingAttachmentCount: effectiveComposerAttachmentCount(
          useComposerDraftStore.getState().draftsByThreadId[activeThreadId],
        ),
      });

      const insertedCount = nextFiles.length > 0 ? addComposerFilesToDraft(nextFiles) : 0;
      setThreadError(
        activeThreadId,
        insertedCount < nextFiles.length
          ? `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`
          : error,
      );
    },
    [activeThreadId, addComposerFilesToDraft, pendingUserInputs.length, setThreadError],
  );

  const addComposerAttachments = useCallback(
    (files: readonly File[]) => {
      const { imageFiles, genericFiles } = splitComposerDropzoneFiles(files);
      if (imageFiles.length > 0) {
        addComposerImages(imageFiles);
      }
      if (genericFiles.length > 0) {
        addComposerFiles(genericFiles);
      }
    },
    [addComposerFiles, addComposerImages],
  );

  const removeComposerFile = (fileId: string) => {
    discardPromptHistoryNavigationForComposerMutation();
    removeComposerDraftFile(threadId, fileId);
  };

  const {
    onComposerPaste,
    onComposerDragEnter,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
  } = useComposerDropzone({
    disabled: false,
    addImages: addComposerImages,
    fileSupport: {
      genericFiles: "accept",
      addFiles: addComposerFiles,
    },
    appendReferenceText: (referenceText) => appendComposerPromptText(threadId, referenceText),
    appendPathMentions: (paths) => {
      for (const absolutePath of paths) {
        appendComposerPromptText(threadId, formatComposerMentionToken(absolutePath));
      }
    },
    dragDepthRef,
    focusComposer,
    setIsDragOverComposer,
  });

  const { isThreadDragOverComposer, threadMentionDropzoneProps } = useComposerThreadMentionDrop({
    disabled: false,
    currentThreadId: threadId,
    onDropThread: (droppedThreadId) => {
      const mention = resolveThreadMentionForThreadId({
        threads: composerThreadSummaries,
        projects: composerThreadProjects,
        currentThreadId: threadId,
        threadId: droppedThreadId,
      });
      if (!mention) {
        toastManager.add({
          type: "error",
          title: "Could not reference this chat",
          description: "This chat is unavailable or cannot be mentioned here.",
        });
        return;
      }
      discardPromptHistoryNavigationForComposerMutation();
      appendComposerPromptText(threadId, formatComposerMentionToken(mention.name));
      updateSelectedComposerMentions((existing) => [
        ...existing.filter((existingMention) => existingMention.name !== mention.name),
        mention,
      ]);
    },
  });

  const onUndoTurnFiles = useCallback(
    async (turnCounts: readonly number[]) => {
      const api = readNativeApi();
      if (!api || !activeThread || isRevertingCheckpoint || turnCounts.length === 0) return;

      if (hasLiveTurn || isSendBusy || isConnecting) {
        setThreadError(activeThread.id, "Interrupt the current turn before undoing file changes.");
        return;
      }
      const confirmed = await api.dialogs.confirm(
        [
          "Undo the file changes shown in this card?",
          "Earlier file changes will remain available to undo.",
          "Messages and provider conversation history will be kept.",
          "This action cannot be undone.",
        ].join("\n"),
      );
      if (!confirmed) return;

      setIsRevertingCheckpoint(true);
      setThreadError(activeThread.id, null);

      const orderedTurnCounts = [...new Set(turnCounts)].toSorted((left, right) => right - left);
      const requestedAt = new Date().toISOString();
      setPendingFileUndo({
        threadId: activeThread.id,
        turnCounts: orderedTurnCounts,
        existingFailureActivityIds: activeThread.activities
          .filter((activity) => activity.kind === "checkpoint.revert.failed")
          .map((activity) => activity.id),
      });
      const dispatchReverts = async () => {
        for (const turnCount of orderedTurnCounts) {
          await api.orchestration.dispatchCommand({
            type: "thread.checkpoint.revert",
            commandId: newCommandId(),
            threadId: activeThread.id,
            turnCount,
            scope: "files",
            createdAt: requestedAt,
          });
        }
      };
      await dispatchReverts().catch((err: unknown) => {
        setPendingFileUndo(null);
        setIsRevertingCheckpoint(false);
        setThreadError(
          activeThread.id,
          err instanceof Error ? err.message : "Failed to undo file changes.",
        );
      });
    },
    [
      setIsRevertingCheckpoint,
      setPendingFileUndo,
      activeThread,
      hasLiveTurn,
      isConnecting,
      isRevertingCheckpoint,
      isSendBusy,
      setThreadError,
    ],
  );

  const confirmProviderHandoff = useCallback(async () => {
    if (!activeThread || !pendingProviderHandoff || providerHandoffBusy || handoffDisabled) return;
    setProviderHandoffBusy(true);
    try {
      await createThreadHandoff(
        activeThread,
        pendingProviderHandoff.modelSelection.provider,
        pendingProviderHandoff.modelSelection,
        pendingProviderHandoff.runtimeMode,
      );
      setPendingProviderHandoff(null);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not switch provider",
        description: error instanceof Error ? error.message : "The handoff failed.",
      });
    } finally {
      setProviderHandoffBusy(false);
    }
  }, [
    activeThread,
    createThreadHandoff,
    handoffDisabled,
    pendingProviderHandoff,
    providerHandoffBusy,
  ]);

  const clearComposerInput = useCallback(
    (threadId: ThreadId) => {
      promptHistoryNavigationRef.current = null;
      applyingPromptHistoryNavigationRef.current = false;
      expectedPromptHistoryPromptRef.current = null;
      promptRef.current = "";
      setRestoredQueuedSourceProposedPlan(threadId, null);
      clearComposerDraftContent(threadId);
      updateSelectedComposerSkills([]);
      updateSelectedComposerMentions([]);
      setComposerHighlightedItemId(null);
      setComposerCursor(0);
      setComposerTrigger(null);
    },
    [
      promptRef,
      setComposerCursor,
      setComposerTrigger,
      promptHistoryNavigationRef,
      applyingPromptHistoryNavigationRef,
      expectedPromptHistoryPromptRef,
      setComposerHighlightedItemId,
      clearComposerDraftContent,
      setRestoredQueuedSourceProposedPlan,
      updateSelectedComposerMentions,
      updateSelectedComposerSkills,
    ],
  );

  const { createAutomationFromForm, prepareAutomationFormForCreate, submitAutomationDraft } =
    useChatAutomationCreation({
      threadId,
      activeProject,
      automationDraftSubmittingRef,
      isServerThread,
      activeThread,
      providerOptionsForDispatch,
      setIsAutomationDraftSubmitting,
      queryClient,
      clearComposerInput,
      resetAutomationDraftState,
      activeThreadAssociatedWorktree,
      threadNotes,
      selectedModelSelection,
      runtimeMode,
      interactionMode,
      automationDraftForm,
      automationDraftWarnings,
      acknowledgedAutomationWarnings,
    });
  return {
    onInterruptFromStopControl,
    onStopWorkflowRun,
    onBackgroundSubagentStripItem,
    onStopSubagentStripItem,
    onStopAllSubagentStripItems,
    onPauseWorkflowRun,
    onDismissWorkflowRun,
    pendingProviderHandoff,
    setPendingProviderHandoff,
    providerHandoffBusy,
    onProviderModelSelect,
    toggleComposerVoiceRecording,
    removeComposerImage,
    addComposerAttachments,
    removeComposerFile,
    onComposerPaste,
    onComposerDragEnter,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
    isThreadDragOverComposer,
    threadMentionDropzoneProps,
    onUndoTurnFiles,
    confirmProviderHandoff,
    clearComposerInput,
    createAutomationFromForm,
    prepareAutomationFormForCreate,
    submitAutomationDraft,
  } as const;
}
