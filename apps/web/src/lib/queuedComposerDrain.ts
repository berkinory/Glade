import type { AssistantDeliveryMode } from "@glade/contracts/provider/sessionPolicy";
import type { MessageId, ThreadId } from "@glade/contracts/core/baseSchemas";

import {
  createLocalDispatchSnapshot,
  hasLiveTurnTakenOver,
  LOCAL_DISPATCH_TURN_TAKEOVER_TIMEOUT_MS,
  type LocalDispatchSnapshot,
  type QueuedSteerGate,
  resolveQueuedSteerGateTransition,
} from "../components/ChatView.logic.dispatch";
import { useComposerDraftStore } from "../composerDraftStore";
import type { QueuedComposerTurn } from "../composerDraftDomain";
import { derivePendingApprovals, derivePendingUserInputs } from "../pendingInteractionDerivation";
import { derivePhase } from "../session-logic";
import { useStore } from "../store";
import type { AppState } from "../storeState";
import { getThreadFromState } from "../threadDerivation";
import type { SessionPhase } from "../types";
import { dispatchQueuedComposerTurnHeadless } from "./queuedComposerDispatch";
import { newMessageId } from "./utils";

interface QueuedComposerAutoDispatchGates {
  hasQueueableLiveTurn: boolean;
  phase: SessionPhase;
  isSendBusy: boolean;
  isConnecting: boolean;
  isAwaitingTurnStart: boolean;
  steerGate: QueuedSteerGate | null;
  hasPendingApproval: boolean;
  hasPendingCacheReview?: boolean;
  hasPendingProgress: boolean;
  pendingUserInputCount: number;
  queuedTurnCount: number;
}

function shouldAutoDispatchQueuedComposerTurn(gates: QueuedComposerAutoDispatchGates): boolean {
  return !(
    gates.hasQueueableLiveTurn ||
    gates.phase === "disconnected" ||
    gates.isSendBusy ||
    gates.isConnecting ||
    gates.isAwaitingTurnStart ||
    gates.steerGate !== null ||
    gates.hasPendingApproval ||
    gates.hasPendingCacheReview ||
    gates.hasPendingProgress ||
    gates.pendingUserInputCount > 0 ||
    gates.queuedTurnCount === 0
  );
}

type QueuedComposerDispatchFn = (input: {
  threadId: ThreadId;
  queuedTurn: QueuedComposerTurn;
  dispatchMode: "queue" | "steer";
  assistantDeliveryMode: AssistantDeliveryMode;
  messageId?: MessageId;
}) => Promise<boolean>;

interface QueuedComposerRetryState {
  readonly queuedTurnId: string;
  readonly failureCount: number;
  readonly retryAt: number | null;
}

// Three delayed retries cover transient RPC failures without turning a persistent failure into an
// endless timer loop. Once exhausted, a queue-head or relevant thread-state change gives the item a
// fresh budget.
const QUEUED_COMPOSER_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const;

export function createQueuedComposerDrain() {
  const claimedThreadIds = new Set<ThreadId>();
  const autoDispatchLocks = new Set<ThreadId>();
  const steerGatesByThreadId = new Map<ThreadId, QueuedSteerGate>();
  const awaitingTurnStartsByThreadId = new Map<ThreadId, LocalDispatchSnapshot>();
  const retryStateByThreadId = new Map<ThreadId, QueuedComposerRetryState>();
  let drainStartCount = 0;
  let stopDrainSubscriptions: (() => void) | null = null;
  let tickScheduled = false;
  let watcherGeneration = 0;
  let drainWakeTimer: ReturnType<typeof setTimeout> | null = null;
  let assistantDeliveryMode: AssistantDeliveryMode = "streaming";
  let dispatchQueuedTurn: QueuedComposerDispatchFn = dispatchQueuedComposerTurnHeadless;
  let nowMs: () => number = () => Date.now();
  function armQueuedComposerSteerGate(threadId: ThreadId, gate: QueuedSteerGate): void {
    steerGatesByThreadId.set(threadId, gate);
    requestQueuedComposerDrainPass();
  }

  function clearQueuedComposerSteerGate(threadId: ThreadId): void {
    if (!steerGatesByThreadId.delete(threadId)) {
      return;
    }
    requestQueuedComposerDrainPass();
  }

  function getQueuedComposerSteerGate(threadId: ThreadId): QueuedSteerGate | null {
    return steerGatesByThreadId.get(threadId) ?? null;
  }

  function isQueuedComposerAwaitingTurnStart(threadId: ThreadId): boolean {
    return awaitingTurnStartsByThreadId.has(threadId);
  }

  function tryBeginQueuedComposerAutoDispatch(threadId: ThreadId): boolean {
    if (autoDispatchLocks.has(threadId)) {
      return false;
    }
    autoDispatchLocks.add(threadId);
    return true;
  }

  function endQueuedComposerAutoDispatch(threadId: ThreadId): void {
    if (!autoDispatchLocks.delete(threadId)) {
      return;
    }
    requestQueuedComposerDrainPass();
  }

  async function runLockedQueuedComposerAutoDispatch(input: {
    threadId: ThreadId;
    run: () => Promise<void>;
    onSettled?: () => void;
  }): Promise<void> {
    try {
      await input.run();
    } finally {
      input.onSettled?.();
      endQueuedComposerAutoDispatch(input.threadId);
    }
  }

  function claimQueuedComposerAutoDispatch(threadId: ThreadId): void {
    claimedThreadIds.add(threadId);
  }

  function releaseQueuedComposerAutoDispatch(threadId: ThreadId): void {
    claimedThreadIds.delete(threadId);
    requestQueuedComposerDrainPass();
  }

  function setQueuedComposerDrainAssistantDeliveryMode(nextMode: AssistantDeliveryMode): void {
    assistantDeliveryMode = nextMode;
  }

  function startQueuedComposerDrainWatcher(options?: {
    dispatch?: QueuedComposerDispatchFn;
    now?: () => number;
    assistantDeliveryMode?: AssistantDeliveryMode;
  }): () => void {
    drainStartCount += 1;
    if (options?.dispatch) {
      dispatchQueuedTurn = options.dispatch;
    }
    if (options?.now) {
      nowMs = options.now;
    }
    if (options?.assistantDeliveryMode) {
      assistantDeliveryMode = options.assistantDeliveryMode;
    }
    if (drainStartCount === 1) {
      const unsubscribeDrafts = useComposerDraftStore.subscribe((current, previous) => {
        if (!haveQueuedTurnsChanged(current.draftsByThreadId, previous.draftsByThreadId)) {
          return;
        }
        resetRetriesForChangedQueueHeads(current.draftsByThreadId);
        requestQueuedComposerDrainPass();
      });
      const unsubscribeStore = useStore.subscribe((current, previous) => {
        if (!hasRelevantThreadStateChanged(current, previous)) {
          return;
        }
        resetRetriesForRelevantThreadChanges(current, previous);
        requestQueuedComposerDrainPass();
      });
      stopDrainSubscriptions = () => {
        unsubscribeDrafts();
        unsubscribeStore();
      };
      requestQueuedComposerDrainPass();
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      drainStartCount = Math.max(0, drainStartCount - 1);
      if (drainStartCount > 0) {
        return;
      }
      watcherGeneration += 1;
      stopDrainSubscriptions?.();
      stopDrainSubscriptions = null;
      if (drainWakeTimer !== null) {
        clearTimeout(drainWakeTimer);
        drainWakeTimer = null;
      }
      tickScheduled = false;
      dispatchQueuedTurn = dispatchQueuedComposerTurnHeadless;
      nowMs = () => Date.now();
    };
  }

  function requestQueuedComposerDrainPass(): void {
    if (drainStartCount === 0 || tickScheduled || !hasQueuedComposerDrainWork()) {
      return;
    }
    tickScheduled = true;
    // A stopped watcher must not dispatch a message from its already queued microtask.
    const generation = watcherGeneration;
    queueMicrotask(() => {
      if (generation !== watcherGeneration || drainStartCount === 0) return;
      tickScheduled = false;
      void runQueuedComposerDrainPass();
    });
  }

  function collectThreadIdsWithQueuedTurns(): ThreadId[] {
    const drafts = useComposerDraftStore.getState().draftsByThreadId;
    const threadIds: ThreadId[] = [];
    for (const [threadId, draft] of Object.entries(drafts)) {
      if (draft.queuedTurns.length > 0) {
        threadIds.push(threadId as ThreadId);
      }
    }
    return threadIds;
  }

  function hasQueuedComposerDrainWork(): boolean {
    return (
      collectThreadIdsWithQueuedTurns().length > 0 ||
      steerGatesByThreadId.size > 0 ||
      awaitingTurnStartsByThreadId.size > 0
    );
  }

  function haveQueuedTurnsChanged(
    current: ReturnType<typeof useComposerDraftStore.getState>["draftsByThreadId"],
    previous: ReturnType<typeof useComposerDraftStore.getState>["draftsByThreadId"],
  ): boolean {
    const threadIds = new Set<ThreadId>([
      ...(Object.keys(current) as ThreadId[]),
      ...(Object.keys(previous) as ThreadId[]),
    ]);
    for (const threadId of threadIds) {
      if (current[threadId]?.queuedTurns !== previous[threadId]?.queuedTurns) {
        return true;
      }
    }
    return false;
  }

  function resetRetriesForChangedQueueHeads(
    draftsByThreadId: ReturnType<typeof useComposerDraftStore.getState>["draftsByThreadId"],
  ): void {
    for (const [threadId, retryState] of retryStateByThreadId) {
      const queuedTurnId = draftsByThreadId[threadId]?.queuedTurns[0]?.id;
      if (queuedTurnId !== retryState.queuedTurnId) {
        retryStateByThreadId.delete(threadId);
      }
    }
  }

  function collectTrackedThreadIds(): Set<ThreadId> {
    return new Set([
      ...collectThreadIdsWithQueuedTurns(),
      ...steerGatesByThreadId.keys(),
      ...awaitingTurnStartsByThreadId.keys(),
    ]);
  }

  function threadDrainSignal(state: AppState, threadId: ThreadId): string {
    const thread = getThreadFromState(state, threadId);
    if (!thread) {
      return "missing";
    }
    const pendingApprovalCount = derivePendingApprovals(
      thread.activities,
      thread.pendingInteractions,
      {
        authoritativeHasPending: thread.hasPendingApprovals,
        latestTurnId: thread.latestTurn?.turnId,
      },
    ).length;
    const pendingUserInputCount = derivePendingUserInputs(
      thread.activities,
      thread.pendingInteractions,
      {
        authoritativeHasPending: thread.hasPendingUserInput,
        latestTurnId: thread.latestTurn?.turnId,
      },
    ).length;
    return [
      thread.session?.status ?? "",
      thread.session?.orchestrationStatus ?? "",
      thread.session?.activeTurnId ?? "",
      thread.latestTurn?.turnId ?? "",
      thread.latestTurn?.startedAt ?? "",
      thread.latestTurn?.completedAt ?? "",
      thread.error ?? "",
      pendingApprovalCount,
      pendingUserInputCount,
      thread.claudeCacheReview?.reviewId ?? "",
      thread.claudeCacheReview?.status ?? "",
    ].join("|");
  }

  function hasRelevantThreadStateChanged(current: AppState, previous: AppState): boolean {
    for (const threadId of collectTrackedThreadIds()) {
      if (threadDrainSignal(current, threadId) !== threadDrainSignal(previous, threadId)) {
        return true;
      }
    }
    return false;
  }

  function resetRetriesForRelevantThreadChanges(current: AppState, previous: AppState): void {
    for (const threadId of retryStateByThreadId.keys()) {
      if (
        claimedThreadIds.has(threadId) &&
        (getThreadFromState(current, threadId)?.claudeCacheReview != null) ===
          (getThreadFromState(previous, threadId)?.claudeCacheReview != null)
      ) {
        continue;
      }
      if (threadDrainSignal(current, threadId) !== threadDrainSignal(previous, threadId)) {
        retryStateByThreadId.delete(threadId);
      }
    }
  }

  function readQueuedComposerAutoDispatchGates(
    threadId: ThreadId,
  ): QueuedComposerAutoDispatchGates {
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    const thread = getThreadFromState(useStore.getState(), threadId);
    const phase = derivePhase(thread?.session ?? null);
    const hasLiveTurn = phase === "running";
    const pendingApprovals = derivePendingApprovals(
      thread?.activities ?? [],
      thread?.pendingInteractions,
      {
        authoritativeHasPending: thread?.hasPendingApprovals,
        latestTurnId: thread?.latestTurn?.turnId,
      },
    );
    const pendingUserInputs = derivePendingUserInputs(
      thread?.activities ?? [],
      thread?.pendingInteractions,
      {
        authoritativeHasPending: thread?.hasPendingUserInput,
        latestTurnId: thread?.latestTurn?.turnId,
      },
    );
    return {
      hasQueueableLiveTurn: hasLiveTurn && thread?.session?.activeTurnId != null,
      phase,
      isSendBusy: autoDispatchLocks.has(threadId),
      isConnecting: phase === "connecting",
      isAwaitingTurnStart: awaitingTurnStartsByThreadId.has(threadId),
      steerGate: getQueuedComposerSteerGate(threadId),
      hasPendingApproval: pendingApprovals.length > 0,
      hasPendingCacheReview: thread?.claudeCacheReview != null,
      hasPendingProgress: pendingUserInputs.length > 0,
      pendingUserInputCount: pendingUserInputs.length,
      queuedTurnCount: draft?.queuedTurns.length ?? 0,
    };
  }

  function advanceAwaitingTurnStarts(): number | null {
    let earliestExpiryMs: number | null = null;
    const now = nowMs();
    for (const [threadId, localDispatch] of awaitingTurnStartsByThreadId) {
      const thread = getThreadFromState(useStore.getState(), threadId);
      const pendingApprovals = derivePendingApprovals(
        thread?.activities ?? [],
        thread?.pendingInteractions,
        {
          authoritativeHasPending: thread?.hasPendingApprovals,
          latestTurnId: thread?.latestTurn?.turnId,
        },
      );
      const pendingUserInputs = derivePendingUserInputs(
        thread?.activities ?? [],
        thread?.pendingInteractions,
        {
          authoritativeHasPending: thread?.hasPendingUserInput,
          latestTurnId: thread?.latestTurn?.turnId,
        },
      );
      if (
        hasLiveTurnTakenOver({
          localDispatch,
          phase: derivePhase(thread?.session ?? null),
          latestTurn: thread?.latestTurn ?? null,
          session: thread?.session ?? null,
          hasPendingApproval: pendingApprovals.length > 0,
          hasPendingUserInput: pendingUserInputs.length > 0,
          claudeCacheReview: thread?.claudeCacheReview,
          threadError: thread?.error,
          now,
        })
      ) {
        awaitingTurnStartsByThreadId.delete(threadId);
        continue;
      }
      const startedAtMs = Date.parse(localDispatch.startedAt);
      if (!Number.isFinite(startedAtMs)) {
        awaitingTurnStartsByThreadId.delete(threadId);
        continue;
      }
      const expiresInMs = LOCAL_DISPATCH_TURN_TAKEOVER_TIMEOUT_MS - (now - startedAtMs);
      earliestExpiryMs =
        earliestExpiryMs === null ? expiresInMs : Math.min(earliestExpiryMs, expiresInMs);
    }
    return earliestExpiryMs;
  }

  function advanceSteerGates(): number | null {
    let earliestExpiryMs: number | null = null;
    const now = nowMs();
    for (const [threadId, gate] of [...steerGatesByThreadId.entries()]) {
      const thread = getThreadFromState(useStore.getState(), threadId);
      const transition = resolveQueuedSteerGateTransition({
        gate,
        phase: derivePhase(thread?.session ?? null),
        sessionErrored: thread?.session?.status === "error",
        activeTurnId: thread?.session?.activeTurnId ?? null,
        now,
      });
      if (transition.kind === "clear") {
        steerGatesByThreadId.delete(threadId);
        continue;
      }
      const nextGate = transition.gate;
      if (
        nextGate.sawInterruptGap !== gate.sawInterruptGap ||
        nextGate.gapStartedAt !== gate.gapStartedAt ||
        nextGate.armedActiveTurnId !== gate.armedActiveTurnId
      ) {
        steerGatesByThreadId.set(threadId, nextGate);
      }
      if (transition.expiresInMs !== null) {
        earliestExpiryMs =
          earliestExpiryMs === null
            ? transition.expiresInMs
            : Math.min(earliestExpiryMs, transition.expiresInMs);
      }
    }
    return earliestExpiryMs;
  }

  function scheduleQueuedComposerDrainWake(expiresInMs: number | null): void {
    if (drainWakeTimer !== null) {
      clearTimeout(drainWakeTimer);
      drainWakeTimer = null;
    }
    if (drainStartCount === 0 || expiresInMs === null) {
      return;
    }
    drainWakeTimer = setTimeout(
      () => {
        drainWakeTimer = null;
        requestQueuedComposerDrainPass();
      },
      Math.max(0, expiresInMs),
    );
  }

  function recordQueuedComposerAutoDispatchFailure(threadId: ThreadId, queuedTurnId: string): void {
    const previous = retryStateByThreadId.get(threadId);
    const failureCount = previous?.queuedTurnId === queuedTurnId ? previous.failureCount + 1 : 1;
    const retryDelay = QUEUED_COMPOSER_RETRY_DELAYS_MS[failureCount - 1];
    retryStateByThreadId.set(threadId, {
      queuedTurnId,
      failureCount,
      retryAt: retryDelay === undefined ? null : nowMs() + retryDelay,
    });
  }

  function getQueuedComposerAutoDispatchRetryDelay(
    threadId: ThreadId,
    queuedTurnId: string,
  ): number | null | undefined {
    const retryState = retryStateByThreadId.get(threadId);
    if (!retryState || retryState.queuedTurnId !== queuedTurnId) {
      return undefined;
    }
    if (retryState.retryAt === null) {
      return null;
    }
    return retryState.retryAt - nowMs();
  }

  function clearQueuedComposerAutoDispatchRetry(threadId: ThreadId): void {
    retryStateByThreadId.delete(threadId);
  }

  function runQueuedComposerDrainPass(): void {
    const steerExpiryMs = advanceSteerGates();
    const awaitingStartExpiryMs = advanceAwaitingTurnStarts();
    let earliestWakeMs =
      steerExpiryMs === null
        ? awaitingStartExpiryMs
        : awaitingStartExpiryMs === null
          ? steerExpiryMs
          : Math.min(steerExpiryMs, awaitingStartExpiryMs);

    const threadIds = collectThreadIdsWithQueuedTurns();
    for (const threadId of threadIds) {
      if (claimedThreadIds.has(threadId)) {
        continue;
      }
      const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
      const nextQueuedTurn = draft?.queuedTurns[0];
      if (!nextQueuedTurn) {
        continue;
      }
      const retryDelay = getQueuedComposerAutoDispatchRetryDelay(threadId, nextQueuedTurn.id);
      if (retryDelay === null) {
        continue;
      }
      if (retryDelay !== undefined && retryDelay > 0) {
        earliestWakeMs =
          earliestWakeMs === null ? retryDelay : Math.min(earliestWakeMs, retryDelay);
        continue;
      }
      const gates = readQueuedComposerAutoDispatchGates(threadId);
      if (!shouldAutoDispatchQueuedComposerTurn(gates)) {
        continue;
      }
      if (!tryBeginQueuedComposerAutoDispatch(threadId)) {
        continue;
      }
      const thread = getThreadFromState(useStore.getState(), threadId);
      const messageId = newMessageId();
      const localDispatch = {
        ...createLocalDispatchSnapshot(thread, { expectedUserMessageId: messageId }),
        startedAt: new Date(nowMs()).toISOString(),
      };
      void runLockedQueuedComposerAutoDispatch({
        threadId,
        run: async () => {
          const succeeded = await dispatchQueuedTurn({
            threadId,
            queuedTurn: nextQueuedTurn,
            dispatchMode: "queue",
            assistantDeliveryMode,
            messageId,
          });
          const acceptedReview = getThreadFromState(
            useStore.getState(),
            threadId,
          )?.claudeCacheReview;
          if (succeeded || acceptedReview?.messageId === messageId) {
            retryStateByThreadId.delete(threadId);
            awaitingTurnStartsByThreadId.set(threadId, localDispatch);
            useComposerDraftStore.getState().removeQueuedTurn(threadId, nextQueuedTurn.id);
            return;
          }
          if (getThreadFromState(useStore.getState(), threadId)?.claudeCacheReview == null) {
            recordQueuedComposerAutoDispatchFailure(threadId, nextQueuedTurn.id);
          }
        },
      });
    }
    scheduleQueuedComposerDrainWake(earliestWakeMs);
  }
  return {
    armQueuedComposerSteerGate,
    clearQueuedComposerSteerGate,
    getQueuedComposerSteerGate,
    isQueuedComposerAwaitingTurnStart,
    tryBeginQueuedComposerAutoDispatch,
    endQueuedComposerAutoDispatch,
    runLockedQueuedComposerAutoDispatch,
    claimQueuedComposerAutoDispatch,
    releaseQueuedComposerAutoDispatch,
    setQueuedComposerDrainAssistantDeliveryMode,
    startQueuedComposerDrainWatcher,
    recordQueuedComposerAutoDispatchFailure,
    getQueuedComposerAutoDispatchRetryDelay,
    clearQueuedComposerAutoDispatchRetry,
  };
}

export const queuedComposerDrain = createQueuedComposerDrain();
