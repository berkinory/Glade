import { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@glade/contracts/orchestration/threadEntities";
import { type ModelSlug } from "@glade/contracts/provider/model";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { useCallback, useState } from "react";
import { resolveAppModelSelection } from "~/appSettings";
import { commitAfterRuntimeModePersistence } from "../../ChatView.logic.session";
import { resolveCommittedProviderModel } from "../../ChatView.logic.worktree";
import { type ComposerModelSelectionOptions } from "~/components/chat/ComposerModelPicker";
import { collectForegroundRunningSubagentStripItems } from "~/components/chat/ComposerSubagentStrip.logic";
import { resolveRuntimeModelDescriptor } from "~/components/chat/runtimeModelCapabilities";
import { useChatKeyboardShortcuts } from "~/components/chat/useChatKeyboardShortcuts";
import { toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveThreadMentionForThreadId } from "~/hooks/useComposerCommandMenuItems";
import { splitComposerDropzoneFiles, useComposerDropzone } from "~/hooks/useComposerDropzone";
import { useComposerThreadMentionDrop } from "~/hooks/useComposerThreadMentionDrop";
import { useCopyThreadIdToClipboard } from "~/hooks/useCopyToClipboard";
import { appendComposerPromptText } from "~/lib/chatReferences";
import { formatComposerMentionToken } from "~/lib/composerMentions";
import { buildComposerFileAttachmentsFromFiles } from "~/lib/composerSend";
import { effectiveComposerAttachmentCount } from "../../../lib/composerAttachmentCapacity";
import { findProviderStatus } from "~/lib/providerAvailability";
import {
  normalizeRuntimeModeForProvider,
  providerModelSupportsAutoRuntimeMode,
} from "~/lib/runtimeMode";
import { buildModelSelection } from "~/providerModelOptions";
import { type Thread } from "~/types";
import { backgroundSubagent, interruptThreadTurn } from "../chatTaskActions";
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
    setComposerDraftModelSelectionAndSticky,
    addComposerFilesToDraft,
    discardPromptHistoryNavigationForComposerMutation,
    dragDepthRef,
    setIsDragOverComposer,
    composerThreadSummaries,
    composerThreadProjects,
    createThreadHandoff,
    promptHistoryNavigationRef,
    applyingPromptHistoryNavigationRef,
    expectedPromptHistoryPromptRef,
    promptRef,

    clearComposerDraftContent,
    setComposerHighlightedItemId,
    setComposerCursor,
    setComposerTrigger,
  } = session;
  const {
    stripSourceThreadId,
    composerSubagentStripItems,
    modelOptionsByProvider,
    runtimeModelsByProvider,
    lockedProvider,
    pendingUserInputs,
    updateSelectedComposerMentions,
    updateSelectedComposerSkills,
  } = provider;
  const { activeThreadId, runtimeMode } = workspace;
  const { providerStatuses, handoffTargetProviders } = discovery;
  const { handoffDisabled } = transcript;
  const { persistRuntimeModeChange } = environment;
  const { scheduleComposerFocus, enqueueComposerImages, setThreadError, focusComposer } = composer;
  const { threadId } = props;

  const onInterruptFromStopControl = useCallback(() => {
    if (!activeThread) return;
    void interruptThreadTurn(activeThread.id).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not stop the current response",
        description:
          error instanceof Error
            ? error.message
            : "The interrupt request failed. Try again in a moment.",
      });
    });
  }, [activeThread]);

  const onBackgroundAllForegroundSubagentStripItems = useCallback(async () => {
    const foreground = collectForegroundRunningSubagentStripItems(composerSubagentStripItems);
    if (!stripSourceThreadId) return;
    await Promise.all(
      foreground.map((item) => backgroundSubagent(stripSourceThreadId, item.providerThreadId)),
    );
  }, [composerSubagentStripItems, stripSourceThreadId]);

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
    props,
    workspace,
    session,
    provider,
    turn: {
      onInterruptFromStopControl,
      onBackgroundAllForegroundSubagentStripItems,
      onProviderModelSelect,
      copyThreadIdToClipboard,
    },
    composer,
    transcript,
    discovery,
  });

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

      updateSelectedComposerMentions,
      updateSelectedComposerSkills,
    ],
  );
  return {
    onInterruptFromStopControl,
    pendingProviderHandoff,
    setPendingProviderHandoff,
    providerHandoffBusy,
    onProviderModelSelect,
    addComposerAttachments,
    onComposerPaste,
    onComposerDragEnter,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
    isThreadDragOverComposer,
    threadMentionDropzoneProps,
    confirmProviderHandoff,
    clearComposerInput,
  } as const;
}
