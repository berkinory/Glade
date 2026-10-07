import { useChatThreadContext } from "./ChatThreadContext";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { collapseExpandedComposerCursor, detectComposerTrigger } from "../../composer-logic";
import type { QueuedComposerTurn } from "../../composerDraftDomain";
import { cloneComposerImageAttachment } from "../../lib/composerSend";
import { queuedComposerDrain } from "../../lib/queuedComposerDrain";
import { derivePhase } from "../../session-logic";
import { type ChatMessage, type Thread } from "../../types";
import {
  resolveQueuedComposerAutoDispatchHold,
  resolveQueuedSteerGateTransition,
  type QueuedSteerGate,
} from "../ChatView.logic.dispatch";
import { useChatComposerDraft } from "./useChatComposerDraft";
import { useChatLocalDispatch } from "./useChatLocalDispatch";
import { useChatPendingInteractions } from "./useChatPendingInteractions";
import { useComposerReferences } from "./useComposerReferences";
import type { LateComposerSendHandlers } from "./chatSendTypes";
const EMPTY_MESSAGES: ChatMessage[] = [];
interface ChatQueuedTurnsInput {
  threadId: ThreadId;
  queuedComposerTurns: ReturnType<typeof useChatComposerDraft>["queuedComposerTurns"];
  activeThread: Thread | undefined;
  promptRef: ReturnType<typeof useChatComposerDraft>["promptRef"];
  clearComposerDraftContent: ReturnType<typeof useChatComposerDraft>["clearComposerDraftContent"];
  setComposerDraftPrompt: ReturnType<typeof useChatComposerDraft>["setComposerDraftPrompt"];
  setDraftThreadContext: ReturnType<typeof useChatComposerDraft>["setDraftThreadContext"];
  addComposerImagesToDraft: ReturnType<typeof useChatComposerDraft>["addComposerImagesToDraft"];
  addComposerFilesToDraft: ReturnType<typeof useChatComposerDraft>["addComposerFilesToDraft"];
  addComposerAssistantSelectionToDraft: ReturnType<
    typeof useChatComposerDraft
  >["addComposerAssistantSelectionToDraft"];
  addComposerFileCommentToDraft: ReturnType<
    typeof useChatComposerDraft
  >["addComposerFileCommentToDraft"];
  addComposerTerminalContextsToDraft: ReturnType<
    typeof useChatComposerDraft
  >["addComposerTerminalContextsToDraft"];
  addComposerPastedTextsToDraft: ReturnType<
    typeof useChatComposerDraft
  >["addComposerPastedTextsToDraft"];
  addComposerPullRequestContextsToDraft: ReturnType<
    typeof useChatComposerDraft
  >["addComposerPullRequestContextsToDraft"];
  updateSelectedComposerSkills: ReturnType<
    typeof useComposerReferences
  >["updateSelectedComposerSkills"];
  updateSelectedComposerMentions: ReturnType<
    typeof useComposerReferences
  >["updateSelectedComposerMentions"];

  setComposerDraftModelSelection: ReturnType<
    typeof useChatComposerDraft
  >["setComposerDraftModelSelection"];
  setComposerDraftRuntimeMode: ReturnType<
    typeof useChatComposerDraft
  >["setComposerDraftRuntimeMode"];

  setComposerCursor: ReturnType<typeof useChatComposerDraft>["setComposerCursor"];
  setComposerTrigger: ReturnType<typeof useChatComposerDraft>["setComposerTrigger"];
  scheduleComposerFocus: () => void;
  removeQueuedComposerTurnFromDraft: ReturnType<
    typeof useChatComposerDraft
  >["removeQueuedComposerTurnFromDraft"];
  lateComposerSendHandlersRef: RefObject<LateComposerSendHandlers | null>;
  insertQueuedComposerTurn: ReturnType<typeof useChatComposerDraft>["insertQueuedComposerTurn"];
  phase: ReturnType<typeof derivePhase>;
  localDispatch: ReturnType<typeof useChatLocalDispatch>["localDispatch"];
  isLocalDraftThread: boolean;
  activeLatestTurn: Thread["latestTurn"];
  isConnecting: boolean;
  activePendingApproval: ReturnType<typeof useChatPendingInteractions>["activePendingApproval"];
  activePendingProgress: ReturnType<typeof useChatPendingInteractions>["activePendingProgress"];
  pendingUserInputs: ReturnType<typeof useChatPendingInteractions>["pendingUserInputs"];
  sendInFlightRef: RefObject<boolean>;
  sendPreflightInFlightRef: RefObject<boolean>;
}

type ChatQueuedTurnsControllerInput = {
  session: Pick<
    ChatQueuedTurnsInput,
    | "queuedComposerTurns"
    | "activeThread"
    | "promptRef"
    | "clearComposerDraftContent"
    | "setComposerDraftPrompt"
    | "setDraftThreadContext"
    | "addComposerImagesToDraft"
    | "addComposerFilesToDraft"
    | "addComposerAssistantSelectionToDraft"
    | "addComposerFileCommentToDraft"
    | "addComposerTerminalContextsToDraft"
    | "addComposerPastedTextsToDraft"
    | "addComposerPullRequestContextsToDraft"
    | "setComposerDraftModelSelection"
    | "setComposerDraftRuntimeMode"
    | "setComposerCursor"
    | "setComposerTrigger"
    | "removeQueuedComposerTurnFromDraft"
    | "insertQueuedComposerTurn"
    | "sendInFlightRef"
    | "sendPreflightInFlightRef"
  >;
  provider: Pick<
    ChatQueuedTurnsInput,
    | "updateSelectedComposerSkills"
    | "updateSelectedComposerMentions"
    | "phase"
    | "localDispatch"
    | "isConnecting"
    | "activePendingApproval"
    | "activePendingProgress"
    | "pendingUserInputs"
  >;
  composer: Pick<ChatQueuedTurnsInput, "scheduleComposerFocus">;
  turn: Pick<ChatQueuedTurnsInput, "lateComposerSendHandlersRef">;
  workspace: Pick<ChatQueuedTurnsInput, "isLocalDraftThread" | "activeLatestTurn">;
};
export function useChatQueuedTurns({
  session,
  provider,
  composer,
  turn,
  workspace,
}: ChatQueuedTurnsControllerInput) {
  const { threadId } = useChatThreadContext();
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
    addComposerFileCommentToDraft,
    addComposerTerminalContextsToDraft,
    addComposerPastedTextsToDraft,
    addComposerPullRequestContextsToDraft,

    setComposerDraftModelSelection,
    setComposerDraftRuntimeMode,

    setComposerCursor,
    setComposerTrigger,
    removeQueuedComposerTurnFromDraft,
    insertQueuedComposerTurn,
    sendInFlightRef,
    sendPreflightInFlightRef,
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
  } = provider;
  const { scheduleComposerFocus } = composer;
  const { lateComposerSendHandlersRef } = turn;
  const { isLocalDraftThread, activeLatestTurn } = workspace;
  const queuedComposerTurnsRef = useRef<QueuedComposerTurn[]>([]);

  const autoDispatchingQueuedTurnRef = useRef(false);

  const [queuedSteerGate, setQueuedSteerGate] = useState<QueuedSteerGate | null>(() =>
    queuedComposerDrain.getQueuedComposerSteerGate(threadId),
  );

  const [queuedAutoDispatchTick, setQueuedAutoDispatchTick] = useState(0);

  useEffect(() => {
    queuedComposerTurnsRef.current = queuedComposerTurns;
  }, [queuedComposerTurnsRef, queuedComposerTurns]);

  useEffect(() => {
    autoDispatchingQueuedTurnRef.current = false;
  }, [autoDispatchingQueuedTurnRef, threadId]);

  useLayoutEffect(() => {
    queuedComposerDrain.claimQueuedComposerAutoDispatch(threadId);
    setQueuedSteerGate(queuedComposerDrain.getQueuedComposerSteerGate(threadId));
    return () => {
      queuedComposerDrain.releaseQueuedComposerAutoDispatch(threadId);
    };
  }, [setQueuedSteerGate, threadId]);

  const restoreQueuedTurnToComposer = useCallback(
    (queuedTurn: QueuedComposerTurn) => {
      if (!activeThread) {
        return;
      }
      const nextPrompt = queuedTurn.prompt;
      const restoredImages =
        queuedTurn.kind === "chat" ? queuedTurn.images.map(cloneComposerImageAttachment) : [];
      const restoredFiles = queuedTurn.kind === "chat" ? queuedTurn.files : [];
      const restoredAssistantSelections =
        queuedTurn.kind === "chat" ? queuedTurn.assistantSelections : [];
      const restoredFileComments = queuedTurn.kind === "chat" ? queuedTurn.fileComments : [];
      promptRef.current = nextPrompt;
      clearComposerDraftContent(activeThread.id);
      setComposerDraftPrompt(activeThread.id, nextPrompt);

      setDraftThreadContext(activeThread.id, {
        runtimeMode: queuedTurn.runtimeMode,

        ...(queuedTurn.kind === "chat" ? { envMode: queuedTurn.envMode } : {}),
      });
      if (queuedTurn.kind === "chat") {
        if (restoredImages.length > 0) {
          addComposerImagesToDraft(restoredImages);
        }
        if (restoredFiles.length > 0) {
          addComposerFilesToDraft(restoredFiles);
        }
        for (const selection of restoredAssistantSelections) {
          addComposerAssistantSelectionToDraft(selection);
        }
        for (const comment of restoredFileComments) {
          addComposerFileCommentToDraft(comment);
        }
        if (queuedTurn.terminalContexts.length > 0) {
          addComposerTerminalContextsToDraft(queuedTurn.terminalContexts);
        }
        if (queuedTurn.pastedTexts.length > 0) {
          addComposerPastedTextsToDraft(queuedTurn.pastedTexts);
        }
        addComposerPullRequestContextsToDraft(queuedTurn.pullRequestContexts);
        updateSelectedComposerSkills(queuedTurn.skills);
        updateSelectedComposerMentions(queuedTurn.mentions);
      } else {
        updateSelectedComposerSkills([]);
        updateSelectedComposerMentions([]);
      }

      setComposerDraftModelSelection(activeThread.id, queuedTurn.modelSelection);
      setComposerDraftRuntimeMode(activeThread.id, queuedTurn.runtimeMode);

      setComposerCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
      setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      scheduleComposerFocus();
    },
    [
      promptRef,
      setComposerCursor,
      setComposerTrigger,
      activeThread,
      addComposerAssistantSelectionToDraft,
      addComposerFileCommentToDraft,
      addComposerFilesToDraft,
      addComposerImagesToDraft,
      addComposerTerminalContextsToDraft,
      addComposerPastedTextsToDraft,
      addComposerPullRequestContextsToDraft,
      clearComposerDraftContent,
      scheduleComposerFocus,
      setDraftThreadContext,

      setComposerDraftModelSelection,
      setComposerDraftPrompt,
      setComposerDraftRuntimeMode,
      updateSelectedComposerMentions,
      updateSelectedComposerSkills,
    ],
  );

  const removeQueuedComposerTurn = useCallback(
    (queuedTurnId: string) => {
      removeQueuedComposerTurnFromDraft(threadId, queuedTurnId);
    },
    [removeQueuedComposerTurnFromDraft, threadId],
  );

  const dispatchQueuedComposerTurn = useCallback(
    async (queuedTurn: QueuedComposerTurn, dispatchMode: "queue" | "steer"): Promise<boolean> => {
      const lateSendHandlers = lateComposerSendHandlersRef.current;
      if (!lateSendHandlers) {
        return false;
      }
      if (queuedTurn.kind === "chat") {
        return lateSendHandlers.send(undefined, dispatchMode, queuedTurn);
      }
      return false;
    },
    [lateComposerSendHandlersRef],
  );

  const onSteerQueuedComposerTurn = useCallback(
    async (queuedTurn: QueuedComposerTurn) => {
      const previousQueue = queuedComposerTurnsRef.current;
      const queuedIndex = previousQueue.findIndex((entry) => entry.id === queuedTurn.id);
      if (queuedIndex < 0) {
        return;
      }
      removeQueuedComposerTurnFromDraft(threadId, queuedTurn.id);
      const succeeded = await dispatchQueuedComposerTurn(queuedTurn, "steer");
      if (succeeded) {
        queuedComposerDrain.clearQueuedComposerAutoDispatchRetry(threadId);
        return;
      }
      insertQueuedComposerTurn(threadId, queuedTurn, queuedIndex);
      queuedComposerDrain.recordQueuedComposerAutoDispatchFailure(threadId, queuedTurn.id);
      setQueuedAutoDispatchTick((tick) => tick + 1);
    },
    [
      queuedComposerTurnsRef,
      setQueuedAutoDispatchTick,
      dispatchQueuedComposerTurn,
      insertQueuedComposerTurn,
      removeQueuedComposerTurnFromDraft,
      threadId,
    ],
  );

  const onEditQueuedComposerTurn = useCallback(
    (queuedTurn: QueuedComposerTurn) => {
      removeQueuedComposerTurn(queuedTurn.id);
      restoreQueuedTurnToComposer(queuedTurn);
    },
    [removeQueuedComposerTurn, restoreQueuedTurnToComposer],
  );

  const sessionErroredForSteerGate = activeThread?.session?.status === "error";
  const activeTurnIdForSteerGate = activeThread?.session?.activeTurnId ?? null;

  useEffect(() => {
    if (!queuedSteerGate) {
      return;
    }
    const transition = resolveQueuedSteerGateTransition({
      gate: queuedSteerGate,
      phase,
      sessionErrored: sessionErroredForSteerGate,
      activeTurnId: activeTurnIdForSteerGate,
      now: Date.now(),
    });
    if (transition.kind === "clear") {
      setQueuedSteerGate(null);
      queuedComposerDrain.clearQueuedComposerSteerGate(threadId);
      return;
    }
    if (
      transition.gate.sawInterruptGap !== queuedSteerGate.sawInterruptGap ||
      transition.gate.gapStartedAt !== queuedSteerGate.gapStartedAt ||
      transition.gate.armedActiveTurnId !== queuedSteerGate.armedActiveTurnId
    ) {
      setQueuedSteerGate(transition.gate);
      queuedComposerDrain.armQueuedComposerSteerGate(threadId, transition.gate);
      return;
    }
    if (transition.expiresInMs === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      setQueuedSteerGate(null);
      queuedComposerDrain.clearQueuedComposerSteerGate(threadId);
    }, transition.expiresInMs);
    return () => window.clearTimeout(timer);
  }, [
    setQueuedSteerGate,
    activeTurnIdForSteerGate,
    phase,
    queuedSteerGate,
    sessionErroredForSteerGate,
    threadId,
  ]);

  useEffect(() => {
    if (
      queuedComposerDrain.isQueuedComposerAwaitingTurnStart(threadId) ||
      resolveQueuedComposerAutoDispatchHold({
        localDispatch,

        phase: isLocalDraftThread ? "ready" : phase,
        latestTurn: activeLatestTurn,
        session: activeThread?.session ?? null,
        messages: activeThread?.messages ?? EMPTY_MESSAGES,
        isConnecting,
        queuedSteerGate:
          queuedComposerDrain.getQueuedComposerSteerGate(threadId) ?? queuedSteerGate,
        hasPendingApproval: activePendingApproval !== null,
        hasPendingProgress: activePendingProgress !== null,
        hasPendingUserInput: pendingUserInputs.length > 0,
        queuedTurnCount: queuedComposerTurns.length,
        threadError: activeThread?.error,
        now: Date.now(),
      })
    ) {
      return;
    }
    if (
      autoDispatchingQueuedTurnRef.current ||
      sendInFlightRef.current ||
      sendPreflightInFlightRef.current
    ) {
      const timer = window.setTimeout(() => setQueuedAutoDispatchTick((tick) => tick + 1), 250);
      return () => window.clearTimeout(timer);
    }
    const nextQueuedTurn = queuedComposerTurns[0];
    if (!nextQueuedTurn) {
      return;
    }
    const retryDelay = queuedComposerDrain.getQueuedComposerAutoDispatchRetryDelay(
      threadId,
      nextQueuedTurn.id,
    );
    if (retryDelay === null) {
      return;
    }
    if (retryDelay !== undefined && retryDelay > 0) {
      const timer = window.setTimeout(
        () => setQueuedAutoDispatchTick((tick) => tick + 1),
        retryDelay,
      );
      return () => window.clearTimeout(timer);
    }
    if (!queuedComposerDrain.tryBeginQueuedComposerAutoDispatch(threadId)) {
      const timer = window.setTimeout(() => setQueuedAutoDispatchTick((tick) => tick + 1), 250);
      return () => window.clearTimeout(timer);
    }
    autoDispatchingQueuedTurnRef.current = true;
    void queuedComposerDrain.runLockedQueuedComposerAutoDispatch({
      threadId,
      run: async () => {
        const succeeded = await dispatchQueuedComposerTurn(nextQueuedTurn, "queue");
        if (succeeded) {
          queuedComposerDrain.clearQueuedComposerAutoDispatchRetry(threadId);
          removeQueuedComposerTurnFromDraft(threadId, nextQueuedTurn.id);
          return;
        }
        queuedComposerDrain.recordQueuedComposerAutoDispatchFailure(threadId, nextQueuedTurn.id);
        setQueuedAutoDispatchTick((tick) => tick + 1);
      },
      onSettled: () => {
        autoDispatchingQueuedTurnRef.current = false;
      },
    });
  }, [
    autoDispatchingQueuedTurnRef,
    setQueuedAutoDispatchTick,
    sendInFlightRef,
    sendPreflightInFlightRef,
    activeLatestTurn,
    activePendingApproval,
    activePendingProgress,
    activeThread?.error,
    activeThread?.messages,
    activeThread?.session,
    dispatchQueuedComposerTurn,
    isConnecting,
    isLocalDraftThread,
    localDispatch,
    pendingUserInputs.length,
    phase,
    queuedAutoDispatchTick,
    queuedComposerTurns,
    queuedSteerGate,
    removeQueuedComposerTurnFromDraft,
    threadId,
  ]);
  return {
    setQueuedSteerGate,
    removeQueuedComposerTurn,
    onSteerQueuedComposerTurn,
    onEditQueuedComposerTurn,
  };
}
