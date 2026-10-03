import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { markPendingTurnDispatch, usePendingTurnDispatchStore } from "../../pendingTurnDispatch";
import { derivePhase } from "../../session-logic";
import { type ChatMessage, type Thread, type WorktreeSetupResolutionAction } from "../../types";
import {
  LOCAL_DISPATCH_ACK_TIMEOUT_MS,
  WORKTREE_SETUP_ERROR_HOLD_MS,
  failWorktreeSetupSnapshot,
  hasLiveTurnTakenOver,
  hasServerAcknowledgedLocalDispatch,
  resolveNextLocalDispatchSnapshot,
  worktreeSetupHasError,
  type LocalDispatchSnapshot,
} from "../ChatView.logic.dispatch";
import { useChatThreadContext } from "./ChatThreadContext";
import type { WorktreeSetupDispatchOptions } from "../ChatView.logic.worktree";
import { useChatPendingInteractions } from "./useChatPendingInteractions";
const EMPTY_MESSAGES: ChatMessage[] = [];
interface ChatLocalDispatchInput {
  phase: ReturnType<typeof derivePhase>;
  activeLatestTurn: Thread["latestTurn"];
  activeThread: Thread | undefined;
  activePendingApproval: ReturnType<typeof useChatPendingInteractions>["activePendingApproval"];
  activePendingUserInput: ReturnType<typeof useChatPendingInteractions>["activePendingUserInput"];
}

export function useChatLocalDispatch({
  phase,
  activeLatestTurn,
  activeThread,
  activePendingApproval,
  activePendingUserInput,
}: ChatLocalDispatchInput) {
  const { threadId } = useChatThreadContext();
  const localDispatch = usePendingTurnDispatchStore(
    (state) => state.localDispatchByThreadId[threadId] ?? null,
  );
  const setLocalDispatch = useCallback(
    (
      update:
        | LocalDispatchSnapshot
        | null
        | ((current: LocalDispatchSnapshot | null) => LocalDispatchSnapshot | null),
    ) => {
      usePendingTurnDispatchStore.getState().setLocalDispatch(threadId, update);
    },
    [threadId],
  );
  const failedWorktreeSetupDispatchStartedAtRef = useRef<string | null>(null);

  const worktreeSetupPendingAction = usePendingTurnDispatchStore(
    (state) => state.preparationActions[threadId] ?? null,
  );
  const setWorktreeSetupResolution = usePendingTurnDispatchStore(
    (state) => state.setWorktreeSetupResolution,
  );
  const serverAcknowledgedLocalDispatch = useMemo(
    () =>
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase,
        latestTurn: activeLatestTurn,
        session: activeThread?.session ?? null,
        messages: activeThread?.messages ?? EMPTY_MESSAGES,
        hasPendingApproval: activePendingApproval !== null,
        hasPendingUserInput: activePendingUserInput !== null,
        threadError: activeThread?.error,
      }),
    [
      activeLatestTurn,
      activePendingApproval,
      activePendingUserInput,
      activeThread?.error,
      activeThread?.messages,
      activeThread?.session,
      localDispatch,
      phase,
    ],
  );
  const turnTakenOver = useMemo(
    () =>
      hasLiveTurnTakenOver({
        localDispatch,
        phase,
        latestTurn: activeLatestTurn,
        session: activeThread?.session ?? null,
        hasPendingApproval: activePendingApproval !== null,
        hasPendingUserInput: activePendingUserInput !== null,
        threadError: activeThread?.error,
        now: Date.now(),
      }),
    [
      activeLatestTurn,
      activePendingApproval,
      activePendingUserInput,
      activeThread?.error,
      activeThread?.session,
      localDispatch,
      phase,
    ],
  );
  const isSubmitting = usePendingTurnDispatchStore((state) =>
    state.submittingThreadIds.has(threadId),
  );
  const isSendBusy = (isSubmitting || localDispatch !== null) && !serverAcknowledgedLocalDispatch;
  const isAwaitingTurnStart = localDispatch !== null && !turnTakenOver;
  const activeWorktreeSetup = localDispatch?.worktreeSetup ?? null;
  const isPreparingWorktree = activeWorktreeSetup !== null;

  const beginLocalDispatch = useCallback(
    (options?: WorktreeSetupDispatchOptions) => {
      setLocalDispatch((current) => {
        const next = resolveNextLocalDispatchSnapshot(
          options ? { current, activeThread, options } : { current, activeThread },
        );
        if (next !== current) {
          failedWorktreeSetupDispatchStartedAtRef.current = null;
        }
        return next;
      });
    },
    [activeThread, setLocalDispatch],
  );

  const failLocalDispatchWorktreeSetup = useCallback(() => {
    setLocalDispatch((current) => {
      if (!current?.worktreeSetup) {
        return current;
      }
      const failed = failWorktreeSetupSnapshot(current.worktreeSetup);
      failedWorktreeSetupDispatchStartedAtRef.current = current.startedAt;
      return failed === current.worktreeSetup ? current : { ...current, worktreeSetup: failed };
    });
  }, [setLocalDispatch]);

  const resetLocalDispatch = useCallback(() => {
    failedWorktreeSetupDispatchStartedAtRef.current = null;
    setLocalDispatch(null);
  }, [setLocalDispatch]);

  const clearLocalDispatchWorktreeSetup = useCallback(() => {
    setLocalDispatch((current) =>
      current?.worktreeSetup ? { ...current, worktreeSetup: null } : current,
    );
  }, [setLocalDispatch]);

  const onResolveWorktreeSetup = useCallback(
    (action: WorktreeSetupResolutionAction) => {
      usePendingTurnDispatchStore.getState().resolveWorktreeSetup(threadId, action);
    },
    [threadId],
  );

  // Once the turn RPC has resolved the server owns the turn, so a stream that never echoes (dead
  // subscription, lost event) must not lock the composer forever: this fallback force-clears the
  // marker after a bound.
  const localDispatchStartedAtRef = useRef<string | null>(null);
  useEffect(() => {
    localDispatchStartedAtRef.current = localDispatch?.startedAt ?? null;
  }, [localDispatch]);
  const serverAcknowledgedLocalDispatchRef = useRef(serverAcknowledgedLocalDispatch);
  useEffect(() => {
    serverAcknowledgedLocalDispatchRef.current = serverAcknowledgedLocalDispatch;
  }, [serverAcknowledgedLocalDispatch]);
  const localDispatchAckFallbackTimeoutRef = useRef<number | null>(null);
  const armLocalDispatchAckFallback = useCallback(
    (threadIdForSend: ThreadId) => {
      markPendingTurnDispatch(threadIdForSend);
      const armedStartedAt = localDispatchStartedAtRef.current;
      if (armedStartedAt === null) {
        return;
      }
      if (localDispatchAckFallbackTimeoutRef.current !== null) {
        window.clearTimeout(localDispatchAckFallbackTimeoutRef.current);
      }
      localDispatchAckFallbackTimeoutRef.current = window.setTimeout(() => {
        localDispatchAckFallbackTimeoutRef.current = null;
        if (serverAcknowledgedLocalDispatchRef.current) {
          return;
        }
        setLocalDispatch((current) =>
          current &&
          current.startedAt === armedStartedAt &&
          !worktreeSetupHasError(current.worktreeSetup)
            ? null
            : current,
        );
      }, LOCAL_DISPATCH_ACK_TIMEOUT_MS);
    },
    [setLocalDispatch],
  );
  useEffect(
    () => () => {
      if (localDispatchAckFallbackTimeoutRef.current !== null) {
        window.clearTimeout(localDispatchAckFallbackTimeoutRef.current);
      }
    },
    [],
  );

  const scheduleFailedWorktreeSetupDispatchReset = useCallback(() => {
    const failedDispatchStartedAt = failedWorktreeSetupDispatchStartedAtRef.current;
    window.setTimeout(() => {
      setLocalDispatch((current) => {
        if (
          !failedDispatchStartedAt ||
          !current ||
          current.startedAt !== failedDispatchStartedAt ||
          !worktreeSetupHasError(current.worktreeSetup)
        ) {
          return current;
        }
        failedWorktreeSetupDispatchStartedAtRef.current = null;
        return null;
      });
    }, WORKTREE_SETUP_ERROR_HOLD_MS);
  }, [setLocalDispatch]);

  const localDispatchWorktreeSetupFailed = worktreeSetupHasError(activeWorktreeSetup);
  useEffect(() => {
    if (!turnTakenOver) {
      return;
    }
    // A failed worktree setup would otherwise reset in the same commit that painted the error (thread
    // errors count as takeover), so hold the row briefly before letting it animate out.
    if (localDispatchWorktreeSetupFailed) {
      const failedDispatchStartedAt = localDispatch?.startedAt;
      if (!failedDispatchStartedAt) {
        return;
      }
      const holdTimeout = window.setTimeout(() => {
        setLocalDispatch((current) => {
          if (
            !current ||
            current.startedAt !== failedDispatchStartedAt ||
            !worktreeSetupHasError(current.worktreeSetup)
          ) {
            return current;
          }
          failedWorktreeSetupDispatchStartedAtRef.current = null;
          return null;
        });
      }, WORKTREE_SETUP_ERROR_HOLD_MS);
      return () => window.clearTimeout(holdTimeout);
    }
    resetLocalDispatch();
  }, [
    localDispatch?.startedAt,
    localDispatchWorktreeSetupFailed,
    resetLocalDispatch,
    setLocalDispatch,
    turnTakenOver,
  ]);

  return {
    localDispatch,
    setWorktreeSetupResolution,
    worktreeSetupPendingAction,
    turnTakenOver,
    isSendBusy,
    isAwaitingTurnStart,
    activeWorktreeSetup,
    isPreparingWorktree,
    beginLocalDispatch,
    failLocalDispatchWorktreeSetup,
    resetLocalDispatch,
    clearLocalDispatchWorktreeSetup,
    onResolveWorktreeSetup,
    armLocalDispatchAckFallback,
    scheduleFailedWorktreeSetupDispatchReset,
  };
}
