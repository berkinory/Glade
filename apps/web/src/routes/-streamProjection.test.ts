import { MessageId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationThreadDetailHead } from "@glade/contracts/orchestration/snapshots";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStore } from "../store";
import { initialState } from "../storeState";
import { makeReadModelThread, makeState, makeThread } from "../storeTestFixtures";
import { createStreamBatching } from "./-streamBatching";
import type { StreamContext, StreamOperations } from "./-streamContracts";
import { createStreamPolicy } from "./-streamPolicy";
import { createStreamProjection } from "./-streamProjection";
import { createStreamState } from "./-streamState";

const threadId = ThreadId.makeUnsafe("thread-head");
const turnId = TurnId.makeUnsafe("turn-1");
const replyId = MessageId.makeUnsafe("reply-1");
const settledAt = "2026-10-13T10:00:05.000Z";
const appliedSequence = 20;
const session = {
  threadId,
  status: "ready" as const,
  providerName: "codex",
  runtimeMode: "full-access" as const,
  activeTurnId: null,
  lastError: null,
  updatedAt: settledAt,
};
const latestTurn = {
  turnId,
  state: "completed" as const,
  requestedAt: "2026-10-13T10:00:00.000Z",
  startedAt: "2026-10-13T10:00:00.000Z",
  completedAt: settledAt,
  assistantMessageId: replyId,
};
const reply = {
  id: replyId,
  role: "assistant" as const,
  text: "Done.",
  turnId,
  streaming: false,
  source: "native" as const,
  createdAt: settledAt,
  updatedAt: settledAt,
};
const matchingHead: OrchestrationThreadDetailHead = {
  snapshotSequence: 25,
  detailSequence: appliedSequence,
  session,
  latestTurn,
  latestTurnAssistantMessageStored: true,
  latestTurnMessageCount: 1,
  latestTurnActivityCount: 0,
  streamingMessageIds: [],
  pendingInteractions: [],
};

afterEach(() => {
  useStore.setState(initialState);
});

function setup(getThreadDetailHead: () => Promise<OrchestrationThreadDetailHead | null>) {
  useStore.setState(
    makeState(
      makeThread({
        id: threadId,
        session: {
          provider: "codex",
          status: "ready",
          orchestrationStatus: "ready",
          createdAt: settledAt,
          updatedAt: settledAt,
        },
        latestTurn,
        messages: [reply],
      }),
    ),
  );
  const getThreadDetailSnapshot = vi.fn(() =>
    Promise.resolve({
      snapshotSequence: 25,
      thread: makeReadModelThread({ id: threadId, session, latestTurn, messages: [reply] }),
    }),
  );
  const store = useStore.getState();
  const context = {
    api: { orchestration: { getThreadDetailHead, getThreadDetailSnapshot } },
    store: useStore,
    syncServerThreadDetailHotPath: store.syncServerThreadDetailHotPath,
    applyOrchestrationEventsHotPath: store.applyOrchestrationEventsHotPath,
    queryClient: new QueryClient(),
  } as unknown as StreamContext;
  const state = createStreamState();
  const operations: StreamOperations = {
    queueDomainEvent: () => undefined,
    reconcileThreadProjection: () => Promise.resolve(),
    removeOrphanedTerminalsForCurrentState: () => undefined,
    refreshThreadSnapshot: () => Promise.resolve(),
  };
  const policy = createStreamPolicy(state, operations);
  const batching = createStreamBatching(context, state);
  const projection = createStreamProjection(context, state, policy, batching);
  state.subscribedThreadIds.add(threadId);
  state.threadSubscriptionGenerationById.set(threadId, 1);
  state.threadSnapshotSequenceById.set(threadId, appliedSequence);
  policy.armThreadProjectionTerminalFence(threadId, appliedSequence);
  return { state, projection, getThreadDetailSnapshot };
}

describe("head-first thread projection reconcile", () => {
  it("settles the terminal fence from a matching head without reading the full detail", async () => {
    const { state, projection, getThreadDetailSnapshot } = setup(() =>
      Promise.resolve(matchingHead),
    );

    await projection.reconcileThreadProjection(threadId, { verifyWithHead: true });

    expect(getThreadDetailSnapshot).not.toHaveBeenCalled();
    expect(state.threadProjectionTerminalFencePending.has(threadId)).toBe(false);
    expect(state.threadSnapshotSequenceById.get(threadId)).toBe(25);
  });

  it.each<{ name: string; head: () => Promise<OrchestrationThreadDetailHead | null> }>([
    {
      name: "the client missed a detail event",
      head: () => Promise.resolve({ ...matchingHead, detailSequence: appliedSequence + 1 }),
    },
    {
      name: "the server still streams a message the client finalized",
      head: () => Promise.resolve({ ...matchingHead, streamingMessageIds: [replyId] }),
    },
    {
      name: "the server settled the turn differently",
      head: () =>
        Promise.resolve({ ...matchingHead, latestTurn: { ...latestTurn, state: "error" } }),
    },
    {
      name: "the server lacks the final reply the turn names",
      head: () => Promise.resolve({ ...matchingHead, latestTurnAssistantMessageStored: false }),
    },
    {
      name: "the client lost an activity of the latest turn",
      head: () => Promise.resolve({ ...matchingHead, latestTurnActivityCount: 1 }),
    },
    { name: "the head request fails", head: () => Promise.reject(new Error("unavailable")) },
  ])("reads the full detail when $name", async ({ head }) => {
    const { projection, getThreadDetailSnapshot } = setup(head);

    await projection.reconcileThreadProjection(threadId, { verifyWithHead: true });

    expect(getThreadDetailSnapshot).toHaveBeenCalledOnce();
  });
});
