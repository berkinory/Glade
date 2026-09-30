import { MessageId, ThreadId, type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { resolveTailUserMessageEditTarget } from "@glade/shared/conversationEdit";
import { providerSupportsNativeTurnSteering } from "@glade/shared/providerMetadata";
import { deriveAssociatedWorktreeMetadata } from "@glade/shared/threadWorkspace";
import { useNavigate } from "@tanstack/react-router";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import { newCommandId, newMessageId, newThreadId, randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { useComposerDraftStore, type QueuedComposerPlanFollowUp } from "../../composerDraftStore";
import { formatOutgoingComposerPrompt } from "../../lib/composerSend";
import { reconcileDeletedThreadFromClient } from "../../lib/deletedThreadClientReconciliation";
import { unblockThreadFromClient } from "../../lib/threadUnblock";
import { queuedComposerDrain } from "../../lib/queuedComposerDrain";
import { appendOriginalComposerPromptBlocks } from "../../lib/terminalContext";
import { clearPendingTurnDispatch, markPendingTurnDispatch } from "../../pendingTurnDispatch";
import {
  buildPlanImplementationPrompt,
  buildPlanImplementationThreadTitle,
} from "../../proposedPlan";
import type { LatestProposedPlanState } from "../../session-logic";
import { buildSourceProposedPlanReference } from "../../session-logic";
import { useStore } from "../../store";
import { getThreadFromState } from "../../threadDerivation";
import { truncateTitle } from "../../truncateTitle";
import type { Project } from "../../types";
import { type Thread } from "../../types";
import {
  editAndResendDispatchFields,
  queuedChatTurnDispatchFields,
  planImplementationDispatchSettings,
  resolveQueuedTurnDispatchSettings,
  threadSettingsDispatchFields,
  turnStartDispatchFields,
  type QueuedSteerGate,
  type TurnDispatchSettings,
} from "../ChatView.logic";
import { buildWorkflowResumePrompt } from "./WorkflowRunCard.logic";
import { useChatComposerDraft } from "./useChatComposerDraft";
import { useChatLocalDispatch } from "./useChatLocalDispatch";
import { useChatProviderModels } from "./useChatProviderModels";
import { useChatProviderStatus } from "./useChatProviderStatus";
import { useChatRuntimeModes } from "./useChatRuntimeModes";
import { useChatTimelineMessages } from "./useChatTimelineMessages";
import { useChatTranscriptScroll } from "./useChatTranscriptScroll";
import { useChatWorkLog } from "./useChatWorkLog";
import { toastManager } from "../ui/toast";

import type { LateComposerSendHandlers } from "./chatSendTypes";
interface ChatTurnFollowUpsInput {
  threadId: ThreadId;
  activeThread: Thread | undefined;
  isServerThread: boolean;
  isConnecting: boolean;
  sendInFlightRef: RefObject<boolean>;
  setThreadError: (targetThreadId: ThreadId | null, error: string | null) => void;
  setTailAnchor: Dispatch<SetStateAction<{ threadId: ThreadId; messageId: MessageId } | null>>;
  activeProposedPlan: LatestProposedPlanState | null;
  setQueuedSteerGate: Dispatch<SetStateAction<QueuedSteerGate | null>>;
  planSidebarDismissedForTurnRef: RefObject<string | null>;
  setPlanSidebarOpen: Dispatch<SetStateAction<boolean>>;
  isRevertingCheckpoint: boolean;
  setIsRevertingCheckpoint: Dispatch<SetStateAction<boolean>>;
  isSendBusy: ReturnType<typeof useChatLocalDispatch>["isSendBusy"];
  beginLocalDispatch: ReturnType<typeof useChatLocalDispatch>["beginLocalDispatch"];
  armLocalDispatchAckFallback: ReturnType<
    typeof useChatLocalDispatch
  >["armLocalDispatchAckFallback"];
  resetLocalDispatch: ReturnType<typeof useChatLocalDispatch>["resetLocalDispatch"];
  selectedProvider: ProviderKind;
  selectedModel: string;
  selectedPromptEffort: ReturnType<typeof useChatProviderModels>["selectedPromptEffort"];
  turnDispatchSettings: TurnDispatchSettings;
  computerControlChangeSequence: RefObject<number>;
  setComposerDraftComputerControlMode: ReturnType<
    typeof useChatComposerDraft
  >["setComposerDraftComputerControlMode"];
  setOptimisticUserMessages: ReturnType<
    typeof useChatTimelineMessages
  >["setOptimisticUserMessages"];
  armTranscriptAutoFollow: ReturnType<typeof useChatTranscriptScroll>["armTranscriptAutoFollow"];
  tailAnchorScrollInFlightRef: ReturnType<
    typeof useChatTranscriptScroll
  >["tailAnchorScrollInFlightRef"];
  persistThreadSettingsForNextTurn: ReturnType<
    typeof useChatRuntimeModes
  >["persistThreadSettingsForNextTurn"];
  setComposerDraftInteractionMode: ReturnType<
    typeof useChatComposerDraft
  >["setComposerDraftInteractionMode"];
  rememberCustomBinaryPathForDispatch: ReturnType<
    typeof useChatProviderStatus
  >["rememberCustomBinaryPathForDispatch"];
  workflowRunState: ReturnType<typeof useChatWorkLog>["workflowRunState"];
  lateComposerSendHandlersRef: RefObject<LateComposerSendHandlers | null>;
  activeThreadId: ThreadId | null;
  markWorkflowRunDismissed: (threadId: ThreadId, workflowTaskId: string) => void;
  activeProject: Project | undefined;
  activeThreadAssociatedWorktree: ReturnType<typeof deriveAssociatedWorktreeMetadata>;
  syncServerShellSnapshot: ReturnType<typeof useStore.getState>["syncServerShellSnapshot"];
  planSidebarOpenOnNextThreadRef: RefObject<boolean>;
  navigate: ReturnType<typeof useNavigate>;
}

export function useChatTurnFollowUps({
  threadId,
  activeThread,
  isServerThread,
  isConnecting,
  sendInFlightRef,
  setThreadError,
  setTailAnchor,
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
  turnDispatchSettings,
  computerControlChangeSequence,
  setComposerDraftComputerControlMode,
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
}: ChatTurnFollowUpsInput) {
  async function onSubmitPlanFollowUp({
    text,
    interactionMode: nextInteractionMode,
    dispatchMode,
    queuedTurn,
  }: {
    text: string;
    interactionMode: "default" | "plan";
    dispatchMode: "queue" | "steer";
    queuedTurn?: QueuedComposerPlanFollowUp;
  }): Promise<boolean> {
    const api = readNativeApi();
    if (
      !api ||
      !activeThread ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      sendInFlightRef.current
    ) {
      return false;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }

    const threadIdForSend = activeThread.id;
    sendInFlightRef.current = true;
    try {
      await unblockThreadFromClient(api.orchestration, threadIdForSend);
    } catch (error) {
      sendInFlightRef.current = false;
      toastManager.add({
        type: "error",
        title: "Could not resume thread",
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while clearing the provider failure.",
      });
      return false;
    }
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const outgoingMessageText = formatOutgoingComposerPrompt({
      provider: queuedTurn?.selectedProvider ?? selectedProvider,
      model: queuedTurn?.selectedModel ?? selectedModel,
      effort: queuedTurn?.selectedPromptEffort ?? selectedPromptEffort,
      text: trimmed,
    });

    beginLocalDispatch({ expectedUserMessageId: messageIdForSend });
    setThreadError(threadIdForSend, null);
    setOptimisticUserMessages((existing) => [
      ...existing,
      {
        id: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        dispatchMode,
        createdAt: messageCreatedAt,
        streaming: false,
        source: "native",
      },
    ]);
    armTranscriptAutoFollow(threadIdForSend, true);
    tailAnchorScrollInFlightRef.current = true;
    setTailAnchor({ threadId: threadIdForSend, messageId: messageIdForSend });

    const planDispatchSettings = {
      ...resolveQueuedTurnDispatchSettings(turnDispatchSettings, queuedTurn),
      interactionMode: nextInteractionMode,
    };
    const modelSelectionForPlanDispatch = planDispatchSettings.modelSelection;
    const computerControlSequenceForSend = computerControlChangeSequence.current;

    const dispatchPlanFollowUpTurn = async () => {
      await persistThreadSettingsForNextTurn({
        ...threadSettingsDispatchFields(planDispatchSettings),
        threadId: threadIdForSend,
        createdAt: messageCreatedAt,
      });

      setComposerDraftInteractionMode(threadIdForSend, nextInteractionMode);

      const sourceProposedPlan =
        nextInteractionMode === "default"
          ? buildSourceProposedPlanReference({
              threadId: activeThread.id,
              proposedPlan: activeProposedPlan,
            })
          : undefined;
      rememberCustomBinaryPathForDispatch({
        threadId: threadIdForSend,
        provider: planDispatchSettings.modelSelection.provider,
        providerOptions: planDispatchSettings.providerOptions,
      });
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: threadIdForSend,
        message: {
          messageId: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          attachments: [],
        },
        ...turnStartDispatchFields(planDispatchSettings, dispatchMode),
        ...(sourceProposedPlan ? { sourceProposedPlan } : {}),
        createdAt: messageCreatedAt,
      });
      if (!queuedTurn && planDispatchSettings.computerControlMode === "request") {
        const draft = useComposerDraftStore.getState().draftsByThreadId[threadIdForSend];
        if (
          draft?.computerControlMode === "request" &&
          computerControlChangeSequence.current === computerControlSequenceForSend
        )
          setComposerDraftComputerControlMode(threadIdForSend, "off");
      }
      // Steers on providers without native mid-turn steering interrupt the live turn before
      // re-dispatching; hold queued auto-dispatch through that gap so it can't race the steer. The live
      // session provider decides the interrupt path server-side, so the gate keys off it rather than the
      // requested model selection.
      const livePlanProviderForSteerGate =
        activeThread?.session?.provider ?? modelSelectionForPlanDispatch.provider;
      if (
        dispatchMode === "steer" &&
        !providerSupportsNativeTurnSteering(livePlanProviderForSteerGate)
      ) {
        const nextSteerGate = {
          sawInterruptGap: false,
          gapStartedAt: null,
          armedActiveTurnId: activeThread?.session?.activeTurnId ?? null,
        };
        setQueuedSteerGate(nextSteerGate);
        queuedComposerDrain.armQueuedComposerSteerGate(threadId, nextSteerGate);
      }

      if (nextInteractionMode === "default") {
        planSidebarDismissedForTurnRef.current = null;
        setPlanSidebarOpen(true);
      }
    };

    try {
      await dispatchPlanFollowUpTurn();
      armLocalDispatchAckFallback(threadIdForSend);
      sendInFlightRef.current = false;
      return true;
    } catch (err) {
      setOptimisticUserMessages((existing) =>
        existing.filter((message) => message.id !== messageIdForSend),
      );
      setThreadError(
        threadIdForSend,
        err instanceof Error ? err.message : "Failed to send plan follow-up.",
      );
      sendInFlightRef.current = false;

      clearPendingTurnDispatch(threadIdForSend);
      resetLocalDispatch();
      return false;
    }
  }

  const onEditUserMessage = useCallback(
    async (messageId: MessageId, text: string): Promise<boolean> => {
      const api = readNativeApi();
      if (!api || !activeThread || !isServerThread || isRevertingCheckpoint) {
        return false;
      }
      const currentThread =
        getThreadFromState(useStore.getState(), activeThread.id) ?? activeThread;
      const editTarget = resolveTailUserMessageEditTarget({
        messages: currentThread.messages,
        messageId,
        activeTurnId:
          currentThread.session?.orchestrationStatus === "running"
            ? (currentThread.session.activeTurnId ?? null)
            : null,
      });
      if (!editTarget.editable) {
        toastManager.add({ type: "warning", title: "Only the latest message can be edited." });
        return false;
      }
      const originalMessage = currentThread.messages[editTarget.messageIndex];
      if (!originalMessage || originalMessage.role !== "user") {
        toastManager.add({
          type: "warning",
          title: "This message is no longer available to edit.",
        });
        return false;
      }
      if (isSendBusy || isConnecting || sendInFlightRef.current) {
        toastManager.add({ type: "warning", title: "Wait for the current send to start." });
        return false;
      }

      setIsRevertingCheckpoint(true);
      setThreadError(activeThread.id, null);
      const messageCreatedAt = new Date().toISOString();
      const computerControlSequenceForEdit = computerControlChangeSequence.current;
      const editedTextWithOriginalContext = appendOriginalComposerPromptBlocks({
        editedPrompt: text,
        originalPrompt: originalMessage.text,
        messageId,
      });
      const outgoingMessageText = formatOutgoingComposerPrompt({
        provider: selectedProvider,
        model: selectedModel,
        effort: selectedPromptEffort,
        text: editedTextWithOriginalContext,
      });
      return await (async () => {
        await persistThreadSettingsForNextTurn({
          ...threadSettingsDispatchFields(turnDispatchSettings),
          threadId: activeThread.id,
          createdAt: messageCreatedAt,
        });
        await api.orchestration.dispatchCommand({
          type: "thread.message.edit-and-resend",
          commandId: newCommandId(),
          threadId: activeThread.id,
          messageId,
          text: outgoingMessageText,
          ...editAndResendDispatchFields(turnDispatchSettings),
          createdAt: messageCreatedAt,
        });
        if (
          turnDispatchSettings.computerControlMode === "request" &&
          computerControlChangeSequence.current === computerControlSequenceForEdit
        ) {
          setComposerDraftComputerControlMode(activeThread.id, "off");
        }
        return true;
      })()
        .catch((err: unknown) => {
          if (err instanceof Error && err.message.includes("Only the latest rollbackable")) {
            toastManager.add({ type: "warning", title: "Only the latest message can be edited." });
            return false;
          }
          setThreadError(
            activeThread.id,
            err instanceof Error ? err.message : "Failed to edit message.",
          );
          return false;
        })
        .finally(() => {
          setIsRevertingCheckpoint(false);
        });
    },
    [
      sendInFlightRef,
      setIsRevertingCheckpoint,
      activeThread,
      isConnecting,
      isRevertingCheckpoint,
      isSendBusy,
      isServerThread,
      persistThreadSettingsForNextTurn,
      selectedModel,
      selectedPromptEffort,
      selectedProvider,
      setThreadError,
      turnDispatchSettings,
      computerControlChangeSequence,
      setComposerDraftComputerControlMode,
    ],
  );

  const onResumeWorkflowRun = useCallback(async () => {
    if (!workflowRunState?.scriptPath || !workflowRunState.runId) return;
    const lateSendHandlers = lateComposerSendHandlersRef.current;
    if (!lateSendHandlers) return;
    const { workflowTaskId } = workflowRunState;
    const prompt = buildWorkflowResumePrompt(workflowRunState.scriptPath, workflowRunState.runId);
    const sent = await lateSendHandlers.send(undefined, "queue", {
      id: randomUUID(),
      kind: "chat",
      createdAt: new Date().toISOString(),
      previewText: prompt,
      prompt,
      images: [],
      files: [],
      assistantSelections: [],
      browserAnnotations: [],
      terminalContexts: [],
      fileComments: [],
      pastedTexts: [],
      pullRequestContexts: [],
      skills: [],
      mentions: [],
      selectedProvider,
      selectedModel,
      selectedPromptEffort,
      ...queuedChatTurnDispatchFields(turnDispatchSettings, undefined),
    });
    if (sent && activeThreadId) {
      markWorkflowRunDismissed(activeThreadId, workflowTaskId);
    }
  }, [
    lateComposerSendHandlersRef,
    activeThreadId,
    markWorkflowRunDismissed,
    selectedModel,
    selectedPromptEffort,
    selectedProvider,
    workflowRunState,
    turnDispatchSettings,
  ]);

  const onImplementPlanInNewThread = useCallback(async () => {
    const api = readNativeApi();
    if (
      !api ||
      !activeThread ||
      !activeProject ||
      !activeProposedPlan ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      sendInFlightRef.current
    ) {
      return;
    }

    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const planMarkdown = activeProposedPlan.planMarkdown;
    const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
    const outgoingImplementationPrompt = formatOutgoingComposerPrompt({
      provider: selectedProvider,
      model: selectedModel,
      effort: selectedPromptEffort,
      text: implementationPrompt,
    });
    const nextThreadTitle = truncateTitle(buildPlanImplementationThreadTitle(planMarkdown));
    const computerControlSequenceForImplementation = computerControlChangeSequence.current;
    const implementationDispatchSettings = planImplementationDispatchSettings(turnDispatchSettings);
    const sourceProposedPlan = buildSourceProposedPlanReference({
      threadId: activeThread.id,
      proposedPlan: activeProposedPlan,
    });

    sendInFlightRef.current = true;
    beginLocalDispatch();
    const finish = () => {
      sendInFlightRef.current = false;
      resetLocalDispatch();
    };

    await api.orchestration
      .dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId: nextThreadId,
        projectId: activeProject.id,
        title: nextThreadTitle,
        modelSelection: implementationDispatchSettings.modelSelection,
        runtimeMode: implementationDispatchSettings.runtimeMode,
        interactionMode: implementationDispatchSettings.interactionMode,
        envMode: activeThread.envMode ?? (activeThread.worktreePath ? "worktree" : "local"),
        branch: activeThread.branch,
        worktreePath: activeThread.worktreePath,
        workingDirectory: activeThread.workingDirectory ?? null,
        lastKnownPr: activeThread.lastKnownPr ?? null,
        associatedWorktreePath: activeThreadAssociatedWorktree.associatedWorktreePath,
        associatedWorktreeBranch: activeThreadAssociatedWorktree.associatedWorktreeBranch,
        associatedWorktreeRef: activeThreadAssociatedWorktree.associatedWorktreeRef,
        createdAt,
      })
      .then(() => {
        rememberCustomBinaryPathForDispatch({
          threadId: nextThreadId,
          provider: implementationDispatchSettings.modelSelection.provider,
          providerOptions: implementationDispatchSettings.providerOptions,
        });
        return api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingImplementationPrompt,
            attachments: [],
          },
          ...turnStartDispatchFields(implementationDispatchSettings, "queue"),
          ...(sourceProposedPlan ? { sourceProposedPlan } : {}),
          createdAt,
        });
      })
      .then(() => {
        if (implementationDispatchSettings.computerControlMode === "chat") {
          setComposerDraftComputerControlMode(nextThreadId, "chat", {
            generation: implementationDispatchSettings.computerControlGeneration ?? 0,
          });
        } else if (
          implementationDispatchSettings.computerControlMode === "request" &&
          computerControlChangeSequence.current === computerControlSequenceForImplementation
        ) {
          setComposerDraftComputerControlMode(activeThread.id, "off");
        }
        // The turn RPC resolved for a thread this view never made active, so arm the watchdog marker with
        // that exact thread id before navigation.
        markPendingTurnDispatch(nextThreadId);
        return api.orchestration.getShellSnapshot();
      })
      .then((snapshot) => {
        syncServerShellSnapshot(snapshot);

        planSidebarOpenOnNextThreadRef.current = true;
        return navigate({
          to: "/$threadId",
          params: { threadId: nextThreadId },
        });
      })
      .catch(async (err) => {
        const deletedOnServer = await api.orchestration
          .dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: nextThreadId,
          })
          .then(() => true)
          .catch(() => false);
        if (deletedOnServer) {
          clearPendingTurnDispatch(nextThreadId);
          void reconcileDeletedThreadFromClient({
            threadId: nextThreadId,
            removeDeletedThreadFromClientState:
              useStore.getState().removeDeletedThreadFromClientState,
          });
        }
        toastManager.add({
          type: "error",
          title: "Could not start implementation thread",
          description:
            err instanceof Error ? err.message : "An error occurred while creating the new thread.",
        });
      })
      .then(finish, finish);
  }, [
    planSidebarOpenOnNextThreadRef,
    sendInFlightRef,
    activeProject,
    activeProposedPlan,
    activeThread,
    activeThreadAssociatedWorktree,
    beginLocalDispatch,
    isConnecting,
    isSendBusy,
    isServerThread,
    navigate,
    resetLocalDispatch,
    computerControlChangeSequence,
    selectedPromptEffort,
    selectedModel,
    selectedProvider,
    rememberCustomBinaryPathForDispatch,
    setComposerDraftComputerControlMode,
    syncServerShellSnapshot,
    turnDispatchSettings,
  ]);
  return {
    onSubmitPlanFollowUp,
    onEditUserMessage,
    onResumeWorkflowRun,
    onImplementPlanInNewThread,
  };
}
