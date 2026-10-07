import { useComposerEffortCycle } from "../useComposerEffortCycle";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { appendVoiceTranscriptToPrompt } from "../../ChatView.logic.worktree";
import { canApplyComposerFocus } from "../../ChatView.logic.session";
import { useComposerVoiceController } from "~/components/chat/useComposerVoiceController";
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
} from "~/composer-logic";
import { useComposerDraftStore } from "~/composerDraftStore";
import type { ComposerImageAttachment } from "../../../composerDraftDomain";
import { useComposerImageIntake } from "~/hooks/useComposerImageIntake";
import { createPastedTextDraft } from "~/lib/composerPastedText";
import { effectiveComposerAttachmentCount } from "../../../lib/composerAttachmentCapacity";
import {
  insertInlineTerminalContextPlaceholder,
  type TerminalContextSelection,
} from "~/lib/terminalContext";
import { registerTerminalContextComposerTarget } from "~/lib/terminalContextComposerRegistry";
import { randomUUID } from "~/lib/utils";
import { useStore } from "~/store";
import { getThreadFromState } from "~/threadDerivation";
import { VOICE_RECORDER_ACTION_ARM_DELAY_MS, warnVoiceGuard } from "./chatViewSupport";
import { useChatThreadContext } from "../ChatThreadContext";
import type { useChatDiscoveryController } from "./useChatDiscoveryController";
import type { useChatProviderController } from "./useChatProviderController";
import type { useChatSessionController } from "./useChatSessionController";
import type { useChatTranscriptController } from "./useChatTranscriptController";
import type { useChatWorkspaceController } from "./useChatWorkspaceController";
export function useChatComposerController({
  session,
  discovery,
  transcript,
  workspace,
  provider,
}: {
  session: ReturnType<typeof useChatSessionController>;
  discovery: ReturnType<typeof useChatDiscoveryController>;
  transcript: ReturnType<typeof useChatTranscriptController>;
  workspace: ReturnType<typeof useChatWorkspaceController>;
  provider: ReturnType<typeof useChatProviderController>;
}) {
  const {
    setStoreThreadError,
    setLocalDraftErrorsByThreadId,
    addComposerImagesToDraft,
    composerEditorRef,
    pendingComposerFocusRef,
    setIsModelPickerOpen,
    setIsTraitsPickerOpen,
    promptRef,
    setPrompt,
    setComposerCursor,
    setComposerTrigger,
    activeThread,
    discardPromptHistoryNavigationForComposerMutation,
    composerCursor,
    composerTerminalContexts,
    insertComposerDraftTerminalContext,
    addComposerDraftPastedTexts,
  } = session;
  const { threadId } = useChatThreadContext();
  const { secondaryChromeThreadId, voiceProviderStatus, refreshProviderStatuses } = discovery;
  const { isComposerEditorDisabled } = transcript;
  const { activeProject, activeThreadId } = workspace;
  const { selectedProvider, pendingUserInputs } = provider;

  const setThreadError = useCallback(
    (targetThreadId: ThreadId | null, error: string | null) => {
      if (!targetThreadId) return;
      if (getThreadFromState(useStore.getState(), targetThreadId)) {
        setStoreThreadError(targetThreadId, error);
        return;
      }
      setLocalDraftErrorsByThreadId((existing) => {
        if ((existing[targetThreadId] ?? null) === error) {
          return existing;
        }
        return {
          ...existing,
          [targetThreadId]: error,
        };
      });
    },
    [setLocalDraftErrorsByThreadId, setStoreThreadError],
  );

  const composerImageAttachmentCount = useCallback(
    () =>
      effectiveComposerAttachmentCount(useComposerDraftStore.getState().draftsByThreadId[threadId]),
    [threadId],
  );

  const commitPreparedComposerImages = useCallback(
    (images: ComposerImageAttachment[]) => addComposerImagesToDraft(images),
    [addComposerImagesToDraft],
  );

  const reportChatActionFailure = (error: unknown) => {
    setThreadError(threadId, error instanceof Error ? error.message : "The action failed.");
  };

  const setComposerImagePreparationError = useCallback(
    (error: string | null) => setThreadError(threadId, error),
    [setThreadError, threadId],
  );

  const {
    addImages: enqueueComposerImages,
    isPreparingImages: isPreparingComposerImages,
    pendingImageCount: pendingComposerImageCount,
    waitForPending: waitForPendingComposerImages,
  } = useComposerImageIntake({
    threadId,
    existingAttachmentCount: composerImageAttachmentCount,
    commitImages: commitPreparedComposerImages,
    onError: setComposerImagePreparationError,
  });

  const focusComposer = useCallback(() => {
    const editor = composerEditorRef.current;
    if (
      !editor ||
      !canApplyComposerFocus({
        windowHasFocus: document.hasFocus(),
        editorAvailable: true,
        editorDisabled: isComposerEditorDisabled,
      })
    ) {
      pendingComposerFocusRef.current = true;
      return;
    }
    pendingComposerFocusRef.current = false;
    editor.focusAtEnd();
  }, [composerEditorRef, pendingComposerFocusRef, isComposerEditorDisabled]);

  const toggleComposerFocus = () => {
    const editor = composerEditorRef.current;
    if (editor?.isFocused()) {
      pendingComposerFocusRef.current = false;
      editor.blur();
      return;
    }
    focusComposer();
  };

  const scheduleComposerFocus = useCallback(() => {
    pendingComposerFocusRef.current = true;
    window.requestAnimationFrame(() => {
      focusComposer();
    });
  }, [pendingComposerFocusRef, focusComposer]);

  const composerFocusRequestNonce = useComposerDraftStore(
    (store) => store.focusRequestsByThreadId[threadId] ?? 0,
  );

  useEffect(() => {
    if (composerFocusRequestNonce > 0) {
      scheduleComposerFocus();
    }
  }, [composerFocusRequestNonce, scheduleComposerFocus]);

  useEffect(() => {
    if (!pendingComposerFocusRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [pendingComposerFocusRef, focusComposer, secondaryChromeThreadId]);

  useEffect(() => {
    const handleWindowFocus = () => {
      if (!pendingComposerFocusRef.current) return;
      window.requestAnimationFrame(() => {
        focusComposer();
      });
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [pendingComposerFocusRef, focusComposer]);

  const { cycleEffort, cancelEffortPreview } = useComposerEffortCycle({
    threadId,
    provider: selectedProvider,
    model: provider.selectedModel,
    modelOptions: provider.composerModelOptions?.[selectedProvider],
    runtimeModel: provider.selectedRuntimeModel,
    pickerOpen: session.isComposerModelEffortPickerOpen,
    setPickerOpen: setIsModelPickerOpen,
  });
  const handleModelPickerOpenChange = (open: boolean) => {
    cancelEffortPreview();
    setIsModelPickerOpen(open);
    if (open) {
      setIsTraitsPickerOpen(false);
    }
  };

  const handleTraitsPickerOpenChange = (open: boolean) => {
    setIsTraitsPickerOpen(open);
    if (open) {
      setIsModelPickerOpen(false);
    }
  };

  const appendVoiceTranscriptToComposer = (transcript: string) => {
    const nextPrompt = appendVoiceTranscriptToPrompt(promptRef.current, transcript);
    if (!nextPrompt) {
      return;
    }

    promptRef.current = nextPrompt;
    setPrompt(nextPrompt);
    setComposerCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
    setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
    scheduleComposerFocus();
  };

  const {
    isVoiceRecording,
    isVoiceTranscribing,
    voiceWaveformLevels,
    voiceRecordingDurationLabel,
    showVoiceNotesControl,
    startComposerVoiceRecording,
    submitComposerVoiceRecording,
    cancelComposerVoiceRecording,
  } = useComposerVoiceController({
    thread: {
      activeProject,
      activeThreadId: activeThread?.id ?? null,
      threadId,
      pendingUserInputCount: pendingUserInputs.length,
    },
    provider: {
      selectedProvider,
      activeProviderStatus: voiceProviderStatus,
      refreshVoiceStatus: refreshProviderStatuses,
    },
    recording: {
      onTranscriptReady: appendVoiceTranscriptToComposer,
      onRecordingStarted: scheduleComposerFocus,
      actionArmDelayMs: VOICE_RECORDER_ACTION_ARM_DELAY_MS,
      failureCopy: {
        transcriptionFailedTitle: "Couldn't transcribe voice note",
      },
      onGuardWarning: warnVoiceGuard,
    },
  });

  const addTerminalContextToDraft = useCallback(
    (selection: TerminalContextSelection) => {
      if (!activeThreadId) {
        return;
      }
      discardPromptHistoryNavigationForComposerMutation();
      const snapshot = composerEditorRef.current?.readSnapshot() ?? {
        value: promptRef.current,
        cursor: composerCursor,
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
        selectionCollapsed: true,
        terminalContextIds: composerTerminalContexts.map((context) => context.id),
      };
      const insertion = insertInlineTerminalContextPlaceholder(
        snapshot.value,
        snapshot.expandedCursor,
      );
      const nextCollapsedCursor = collapseExpandedComposerCursor(
        insertion.prompt,
        insertion.cursor,
      );
      const inserted = insertComposerDraftTerminalContext(
        activeThreadId,
        insertion.prompt,
        {
          id: randomUUID(),
          threadId: activeThreadId,
          createdAt: new Date().toISOString(),
          ...selection,
        },
        insertion.contextIndex,
      );
      if (!inserted) {
        return;
      }
      promptRef.current = insertion.prompt;
      setComposerCursor(nextCollapsedCursor);
      setComposerTrigger(detectComposerTrigger(insertion.prompt, insertion.cursor));
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCollapsedCursor);
      });
    },
    [
      promptRef,
      setComposerCursor,
      setComposerTrigger,
      composerEditorRef,
      activeThreadId,
      composerCursor,
      composerTerminalContexts,
      discardPromptHistoryNavigationForComposerMutation,
      insertComposerDraftTerminalContext,
    ],
  );

  const canAddTerminalContextToChat = activeThread !== undefined;

  const addTerminalContextToDraftRef = useRef(addTerminalContextToDraft);

  useLayoutEffect(() => {
    addTerminalContextToDraftRef.current = addTerminalContextToDraft;
  }, [addTerminalContextToDraftRef, addTerminalContextToDraft]);

  const addRegisteredTerminalContextToDraft = useCallback(
    (selection: TerminalContextSelection) => {
      addTerminalContextToDraftRef.current(selection);
    },
    [addTerminalContextToDraftRef],
  );

  useLayoutEffect(() => {
    if (!canAddTerminalContextToChat) {
      return;
    }
    return registerTerminalContextComposerTarget(addRegisteredTerminalContextToDraft);
  }, [addRegisteredTerminalContextToDraft, canAddTerminalContextToChat]);

  const addPastedTextToDraft = (text: string) => {
    if (!activeThread) {
      return;
    }
    discardPromptHistoryNavigationForComposerMutation();
    addComposerDraftPastedTexts(activeThread.id, [
      createPastedTextDraft({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        text,
      }),
    ]);
  };
  return {
    setThreadError,
    reportChatActionFailure,
    enqueueComposerImages,
    isPreparingComposerImages,
    pendingComposerImageCount,
    waitForPendingComposerImages,
    focusComposer,
    toggleComposerFocus,
    scheduleComposerFocus,
    cycleEffort,
    cancelEffortPreview,
    handleModelPickerOpenChange,
    handleTraitsPickerOpenChange,
    isVoiceRecording,
    isVoiceTranscribing,
    voiceWaveformLevels,
    voiceRecordingDurationLabel,
    showVoiceNotesControl,
    startComposerVoiceRecording,
    submitComposerVoiceRecording,
    cancelComposerVoiceRecording,
    addPastedTextToDraft,
  } as const;
}
