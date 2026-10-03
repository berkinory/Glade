import { flushSync } from "react-dom";
import { type ProviderKind, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ServerProviderStatus } from "@glade/contracts/server/server";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Project } from "../../types";
import {
  formatVoiceRecordingDuration,
  isVoiceRecordingCancelledError,
  useVoiceRecorder,
} from "../../lib/voiceRecorder";
import { readNativeApi } from "../../nativeApi";
import type { RefreshProviderStatusesNow } from "../../hooks/useProviderStatusRefresh";
import { toastManager } from "../ui/toast";
import {
  deriveComposerVoiceState,
  describeVoiceRecordingStartError,
  isVoiceAuthExpiredMessage,
  sanitizeVoiceErrorMessage,
} from "../ChatView.logic.worktree";

interface ComposerVoiceFailureCopy {
  transcriptionFailedTitle: string;
  fallbackDescription: string;
  authExpiredTitle: string;
  authExpiredDescription: string;
  refreshActionLabel: string;
}

interface ComposerVoiceGuardDetails {
  readonly [key: string]: unknown;
}

export interface UseComposerVoiceControllerOptions {
  thread: {
    activeProject: Project | undefined;
    activeThreadId: ThreadId | null;
    threadId: ThreadId;
    pendingUserInputCount: number;
  };
  provider: {
    selectedProvider: ProviderKind;
    activeProviderStatus: ServerProviderStatus | null;
    refreshVoiceStatus: RefreshProviderStatusesNow;
  };
  recording: {
    onTranscriptReady: (transcript: string) => void;
    onRecordingStarted: () => void;
    actionArmDelayMs?: number;
    failureCopy?: Partial<ComposerVoiceFailureCopy>;
    onGuardWarning?: (message: string, details: ComposerVoiceGuardDetails) => void;
  };
}

export interface UseComposerVoiceControllerResult {
  isVoiceRecording: boolean;
  isVoiceTranscribing: boolean;
  voiceWaveformLevels: readonly number[];
  voiceRecordingDurationLabel: string;
  showVoiceNotesControl: boolean;
  startComposerVoiceRecording: () => Promise<void>;
  submitComposerVoiceRecording: (afterTranscript?: () => void) => Promise<void>;
  cancelComposerVoiceRecording: () => void;
}

const DEFAULT_FAILURE_COPY: ComposerVoiceFailureCopy = {
  transcriptionFailedTitle: "Voice transcription failed",
  fallbackDescription: "The voice note could not be transcribed.",
  authExpiredTitle: "Sign in to ChatGPT again",
  authExpiredDescription:
    "Voice transcription uses your ChatGPT session in Codex. That session was rejected, so sign in again there and retry.",
  refreshActionLabel: "Refresh status",
};

export function useComposerVoiceController(
  options: UseComposerVoiceControllerOptions,
): UseComposerVoiceControllerResult {
  const { activeProject, activeThreadId, threadId, pendingUserInputCount } = options.thread;
  const { selectedProvider, activeProviderStatus, refreshVoiceStatus } = options.provider;
  const {
    onTranscriptReady,
    onRecordingStarted,
    actionArmDelayMs: actionArmDelayMsProp,
    failureCopy: failureCopyOverrides,
    onGuardWarning,
  } = options.recording;
  const actionArmDelayMs = actionArmDelayMsProp ?? 0;
  const {
    isPreparing,
    isRecording,
    durationMs: voiceRecordingDurationMs,
    waveformLevels: voiceWaveformLevels,
    startRecording: startVoiceRecording,
    stopRecording: stopVoiceRecording,
    cancelRecording: cancelVoiceRecording,
  } = useVoiceRecorder();
  const isVoiceRecording = isPreparing || isRecording;
  const voiceStartingRef = useRef(false);
  const voiceSubmittingRef = useRef(false);
  const [isVoiceTranscribing, setIsVoiceTranscribing] = useState(false);
  const voiceTranscriptionRequestIdRef = useRef(0);
  const voiceThreadIdRef = useRef(threadId);
  const voiceMayApplyRef = useRef(true);
  const voiceProviderRef = useRef<ProviderKind>(selectedProvider);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);
  const failureCopy = {
    ...DEFAULT_FAILURE_COPY,
    ...failureCopyOverrides,
  };

  useLayoutEffect(() => {
    voiceThreadIdRef.current = threadId;
    voiceProviderRef.current = selectedProvider;
    voiceMayApplyRef.current =
      pendingUserInputCount === 0 &&
      activeProviderStatus?.authStatus !== "unauthenticated" &&
      activeProviderStatus?.voiceTranscriptionAvailable !== false;
  }, [threadId, selectedProvider, pendingUserInputCount, activeProviderStatus]);

  const voiceRecordingDurationLabel = isPreparing
    ? "Preparing microphone…"
    : formatVoiceRecordingDuration(voiceRecordingDurationMs);
  const { canStartVoiceNotes, showVoiceNotesControl } = deriveComposerVoiceState({
    authStatus: activeProviderStatus?.authStatus,
    voiceTranscriptionAvailable: activeProviderStatus?.voiceTranscriptionAvailable,
    isRecording: isVoiceRecording,
    isTranscribing: isVoiceTranscribing,
  });

  useEffect(() => {
    const invalidatedRequestId = voiceTranscriptionRequestIdRef.current + 1;
    voiceTranscriptionRequestIdRef.current = invalidatedRequestId;
    voiceRecordingStartedAtRef.current = null;

    void cancelVoiceRecording().finally(() => {
      if (voiceTranscriptionRequestIdRef.current === invalidatedRequestId) {
        setIsVoiceTranscribing(false);
      }
    });
  }, [cancelVoiceRecording, selectedProvider, threadId]);

  useEffect(
    () => () => {
      voiceTranscriptionRequestIdRef.current += 1;
      voiceRecordingStartedAtRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (canStartVoiceNotes || !isVoiceRecording) {
      return;
    }
    onGuardWarning?.("cancelled active voice recording because voice became unavailable", {
      authStatus: activeProviderStatus?.authStatus ?? null,
      voiceTranscriptionAvailable: activeProviderStatus?.voiceTranscriptionAvailable ?? null,
      isVoiceRecording,
    });
    const invalidatedRequestId = voiceTranscriptionRequestIdRef.current + 1;
    voiceTranscriptionRequestIdRef.current = invalidatedRequestId;
    voiceRecordingStartedAtRef.current = null;
    void cancelVoiceRecording().finally(() => {
      if (voiceTranscriptionRequestIdRef.current === invalidatedRequestId) {
        setIsVoiceTranscribing(false);
      }
    });
  }, [
    activeProviderStatus?.authStatus,
    activeProviderStatus?.voiceTranscriptionAvailable,
    canStartVoiceNotes,
    cancelVoiceRecording,
    isVoiceRecording,
    onGuardWarning,
  ]);

  const isVoiceActionArmed = () => {
    if (actionArmDelayMs <= 0 || voiceRecordingStartedAtRef.current === null) {
      return true;
    }
    const recordedForMs = Math.round(performance.now() - voiceRecordingStartedAtRef.current);
    if (recordedForMs < 0 || recordedForMs >= actionArmDelayMs) {
      return true;
    }
    onGuardWarning?.("ignored recorder action immediately after start", {
      recordedForMs,
    });
    return false;
  };

  const startComposerVoiceRecording = async () => {
    if (
      voiceStartingRef.current ||
      voiceSubmittingRef.current ||
      isVoiceRecording ||
      isVoiceTranscribing
    )
      return;
    if (!activeProject) {
      return;
    }
    if (activeProviderStatus?.authStatus === "unauthenticated") {
      toastManager.add({
        type: "error",
        title: "Sign in to ChatGPT in Codex before using voice notes.",
      });
      return;
    }
    if (!canStartVoiceNotes) {
      toastManager.add({
        type: "error",
        title: "Voice notes require a ChatGPT-authenticated Codex session.",
      });
      return;
    }
    if (pendingUserInputCount > 0) {
      toastManager.add({
        type: "error",
        title: "Answer plan questions before recording a voice note.",
      });
      return;
    }

    voiceStartingRef.current = true;
    const startRequestId = voiceTranscriptionRequestIdRef.current;
    try {
      await startVoiceRecording();
      if (voiceTranscriptionRequestIdRef.current !== startRequestId) return;
      voiceRecordingStartedAtRef.current = performance.now();
      onRecordingStarted();
      const api = readNativeApi();
      void api?.server
        .prewarmVoice?.({
          provider: "codex",
          cwd: activeProject.cwd,
          ...(activeThreadId ? { threadId: activeThreadId } : {}),
        })
        .catch(() => undefined);
    } catch (error) {
      if (
        voiceTranscriptionRequestIdRef.current !== startRequestId ||
        isVoiceRecordingCancelledError(error)
      ) {
        return;
      }
      toastManager.add({
        type: "error",
        title: "Could not start recording",
        description: describeVoiceRecordingStartError(error),
      });
    } finally {
      voiceStartingRef.current = false;
    }
  };

  const submitComposerVoiceRecording = (afterTranscript?: () => void): Promise<void> => {
    if (!activeProject || !isVoiceRecording || voiceSubmittingRef.current) {
      return Promise.resolve();
    }
    if (!isVoiceActionArmed()) {
      return Promise.resolve();
    }

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Voice transcription is unavailable right now.",
      });
      void cancelVoiceRecording();
      return Promise.resolve();
    }

    voiceSubmittingRef.current = true;
    setIsVoiceTranscribing(true);
    const requestId = voiceTranscriptionRequestIdRef.current + 1;
    voiceTranscriptionRequestIdRef.current = requestId;
    const requestThreadId = threadId;
    const requestProvider = selectedProvider;
    const isCurrentVoiceRequest = () =>
      voiceTranscriptionRequestIdRef.current === requestId &&
      voiceThreadIdRef.current === requestThreadId &&
      voiceProviderRef.current === requestProvider &&
      voiceMayApplyRef.current;

    return stopVoiceRecording()
      .then((payload) => {
        if (!isCurrentVoiceRequest()) {
          return;
        }
        if (!payload) {
          toastManager.add({
            type: "warning",
            title: "No audio was captured.",
          });
          return;
        }
        return api.server
          .transcribeVoice({
            provider: "codex",
            cwd: activeProject.cwd,
            ...(activeThreadId ? { threadId: activeThreadId } : {}),
            ...payload,
          })
          .then((result) => {
            if (!isCurrentVoiceRequest()) {
              return;
            }
            if (!result.text.trim()) return;
            // Apply the draft and release the send guard before the existing submission owner runs.
            flushSync(() => {
              onTranscriptReady(result.text);
              setIsVoiceTranscribing(false);
            });
            if (isCurrentVoiceRequest()) afterTranscript?.();
          });
      })
      .catch((error: unknown) => {
        if (!isCurrentVoiceRequest()) {
          return;
        }

        const description =
          error instanceof Error
            ? sanitizeVoiceErrorMessage(error.message)
            : failureCopy.fallbackDescription;
        const authExpired = isVoiceAuthExpiredMessage(description);
        if (authExpired) {
          void refreshVoiceStatus();
        }
        toastManager.add({
          type: "error",
          title: authExpired ? failureCopy.authExpiredTitle : failureCopy.transcriptionFailedTitle,
          description: authExpired ? failureCopy.authExpiredDescription : description,
          ...(authExpired
            ? {
                actionProps: {
                  children: failureCopy.refreshActionLabel,
                  onClick: () => {
                    void refreshVoiceStatus();
                  },
                },
              }
            : {}),
        });
      })
      .finally(() => {
        voiceSubmittingRef.current = false;
        if (voiceTranscriptionRequestIdRef.current === requestId) {
          voiceRecordingStartedAtRef.current = null;
          setIsVoiceTranscribing(false);
        }
      })
      .then(() => undefined);
  };

  const cancelComposerVoiceRecording = () => {
    if (!isVoiceActionArmed()) {
      return;
    }
    voiceTranscriptionRequestIdRef.current += 1;
    voiceRecordingStartedAtRef.current = null;
    setIsVoiceTranscribing(false);
    void cancelVoiceRecording();
  };

  return {
    isVoiceRecording,
    isVoiceTranscribing,
    voiceWaveformLevels,
    voiceRecordingDurationLabel,
    showVoiceNotesControl,
    startComposerVoiceRecording,
    submitComposerVoiceRecording,
    cancelComposerVoiceRecording,
  };
}
