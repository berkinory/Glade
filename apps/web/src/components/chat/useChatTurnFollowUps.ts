import { MessageId, ThreadId, type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { resolveTailUserMessageEditTarget } from "@glade/shared/threads/conversationEdit";

import { deriveAssociatedWorktreeMetadata } from "@glade/shared/threads/threadWorkspace";
import { useNavigate } from "@tanstack/react-router";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import { newCommandId, randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";

import { appendOriginalComposerPromptBlocks } from "../../lib/terminalContext";

import { useStore } from "../../store";
import { getThreadFromState } from "../../threadDerivation";

import type { Project } from "../../types";
import { type Thread } from "../../types";
import {
  editAndResendDispatchFields,
  queuedChatTurnDispatchFields,
  threadSettingsDispatchFields,
  type TurnDispatchSettings,
} from "../ChatView.logic.subagents";
import type { QueuedSteerGate } from "../ChatView.logic.dispatch";
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

  setQueuedSteerGate: Dispatch<SetStateAction<QueuedSteerGate | null>>;

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

  navigate: ReturnType<typeof useNavigate>;
}

type ChatTurnFollowUpsControllerInput = {
  session: Pick<
    ChatTurnFollowUpsInput,
    | "activeThread"
    | "sendInFlightRef"
    | "setComposerDraftComputerControlMode"
    | "isRevertingCheckpoint"
    | "setIsRevertingCheckpoint"
    | "markWorkflowRunDismissed"
    | "syncServerShellSnapshot"
    | "navigate"
  >;
  workspace: Pick<
    ChatTurnFollowUpsInput,
    "isServerThread" | "activeThreadId" | "activeProject" | "activeThreadAssociatedWorktree"
  >;
  provider: Pick<
    ChatTurnFollowUpsInput,
    | "isConnecting"
    | "isSendBusy"
    | "beginLocalDispatch"
    | "armLocalDispatchAckFallback"
    | "resetLocalDispatch"
    | "selectedProvider"
    | "selectedModel"
    | "selectedPromptEffort"
    | "workflowRunState"
  >;
  composer: Pick<ChatTurnFollowUpsInput, "setThreadError" | "computerControlChangeSequence">;
  transcript: Pick<ChatTurnFollowUpsInput, "setTailAnchor" | "setOptimisticUserMessages">;
  environment: Pick<
    ChatTurnFollowUpsInput,
    | "turnDispatchSettings"
    | "armTranscriptAutoFollow"
    | "tailAnchorScrollInFlightRef"
    | "persistThreadSettingsForNextTurn"
  >;
  turn: Pick<ChatTurnFollowUpsInput, "setQueuedSteerGate" | "lateComposerSendHandlersRef">;
  discovery: Pick<ChatTurnFollowUpsInput, "rememberCustomBinaryPathForDispatch">;
};
export function useChatTurnFollowUps({
  session,
  workspace,
  provider,
  composer,
  environment,
  turn,
}: ChatTurnFollowUpsControllerInput) {
  const {
    activeThread,
    sendInFlightRef,

    isRevertingCheckpoint,
    setIsRevertingCheckpoint,
    setComposerDraftComputerControlMode,

    markWorkflowRunDismissed,
  } = session;
  const { isServerThread, activeThreadId } = workspace;
  const {
    isConnecting,

    isSendBusy,

    selectedProvider,
    selectedModel,
    selectedPromptEffort,
    workflowRunState,
  } = provider;
  const { setThreadError, computerControlChangeSequence } = composer;

  const {
    turnDispatchSettings,

    persistThreadSettingsForNextTurn,
  } = environment;
  const { lateComposerSendHandlersRef } = turn;

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
      const outgoingMessageText = editedTextWithOriginalContext;
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
      ...queuedChatTurnDispatchFields(turnDispatchSettings),
    });
    if (sent && activeThreadId) {
      markWorkflowRunDismissed(activeThreadId, workflowTaskId);
    }
  }, [
    lateComposerSendHandlersRef,
    activeThreadId,
    markWorkflowRunDismissed,
    workflowRunState,
    turnDispatchSettings,
    selectedProvider,
    selectedModel,
    selectedPromptEffort,
  ]);

  return {
    onEditUserMessage,
    onResumeWorkflowRun,
  };
}
