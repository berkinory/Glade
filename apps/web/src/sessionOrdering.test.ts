import { ThreadId, TurnId } from "@glade/contracts";
import { expect, it } from "vitest";
import { applyOrchestrationEvents } from "./storeEventReducer";
import { applyShellEvent, syncServerThreadDetailHotPath } from "./storeProjection";
import {
  makeDomainEvent,
  makeReadModelThread,
  makeState,
  makeThread,
  threadsOf,
} from "./storeTestFixtures";

it("keeps stop available across delayed session snapshots and accepts actual completion", () => {
  const threadId = ThreadId.makeUnsafe("thread-1");
  const turnId = TurnId.makeUnsafe("turn-1");
  const readyAt = "2026-09-29T10:47:27.719Z";
  const startedAt = "2026-09-29T10:47:27.956Z";
  const completedAt = "2026-09-29T10:47:31.000Z";
  const runningSession = {
    threadId,
    status: "running" as const,
    providerName: "codex" as const,
    runtimeMode: "full-access" as const,
    activeTurnId: turnId,
    lastError: null,
    updatedAt: startedAt,
  };
  const readySession = {
    ...runningSession,
    status: "ready" as const,
    activeTurnId: null,
    updatedAt: readyAt,
  };
  let state = applyOrchestrationEvents(makeState(makeThread()), [
    makeDomainEvent("thread.session-set", { threadId, session: runningSession }),
  ]);
  const runningTurn = threadsOf(state)[0]!.latestTurn;

  const delayed = makeReadModelThread({ session: readySession, latestTurn: runningTurn });
  state = applyShellEvent(state, {
    kind: "thread-upserted",
    sequence: 2,
    thread: {
      ...delayed,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    },
  });
  expect(threadsOf(state)[0]!.session?.status).toBe("running");
  state = syncServerThreadDetailHotPath(state, delayed, 2);
  expect(threadsOf(state)[0]!.session?.status).toBe("running");
  state = applyOrchestrationEvents(state, [
    makeDomainEvent("thread.session-set", { threadId, session: readySession }, { sequence: 3 }),
  ]);
  expect(threadsOf(state)[0]!.session?.status).toBe("running");
  expect(threadsOf(state)[0]!.session?.activeTurnId).toBe(turnId);
  expect(threadsOf(state)[0]!.latestTurn?.completedAt).toBeNull();

  state = applyOrchestrationEvents(state, [
    makeDomainEvent(
      "thread.session-set",
      {
        threadId,
        session: { ...readySession, updatedAt: completedAt },
      },
      { sequence: 4 },
    ),
    makeDomainEvent("thread.session-set", { threadId, session: runningSession }, { sequence: 5 }),
  ]);
  expect(threadsOf(state)[0]!.session?.status).toBe("ready");
  expect(threadsOf(state)[0]!.latestTurn?.completedAt).toBe(completedAt);
});
