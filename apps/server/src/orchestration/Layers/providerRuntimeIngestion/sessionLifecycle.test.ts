import { ApprovalRequestId } from "@glade/contracts/core/baseSchemas";
import { describe, expect, it } from "vitest";

import {
  asEventId,
  asThreadId,
  asTurnId,
  emitPendingUserInputRequest,
  makeIngestionTestHarness,
  pendingInteractionStatus,
  userInputFailureActivities,
  waitForProjectedThread,
  waitForThread,
} from "./ingestionHarness.testSupport.ts";

describe("ProviderRuntimeIngestion session lifecycle", () => {
  const createHarness = makeIngestionTestHarness();

  it("clears active turn state when a provider session reports ready", async () => {
    const harness = await createHarness();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-before-ready"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-ready-clears"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-ready-clears",
    );

    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-ready-clears-turn"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-ready-clears"),
      payload: {
        state: "ready",
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) => entry.session?.status === "ready" && entry.session?.activeTurnId === null,
    );
    expect(thread.session?.status).toBe("ready");
    expect(thread.session?.activeTurnId).toBeNull();
  });

  it("leaves an idle session ready when the provider restarts it without a turn", async () => {
    const harness = await createHarness();
    const base = {
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: new Date().toISOString(),
    } as const;

    harness.emit({
      ...base,
      type: "session.state.changed",
      eventId: asEventId("evt-idle-restart-connecting"),
      payload: { state: "starting" },
    });
    harness.emit({
      ...base,
      type: "session.state.changed",
      eventId: asEventId("evt-idle-restart-ready"),
      payload: { state: "ready" },
    });
    harness.emit({
      ...base,
      type: "runtime.warning",
      eventId: asEventId("evt-idle-restart-drained"),
      payload: { message: "drained" },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some((activity) => activity.id === "evt-idle-restart-drained"),
    );
    expect(thread.session).toMatchObject({ status: "ready", activeTurnId: null });
  });

  it("settles a pending user-input request when its turn ends without a session restart", async () => {
    const harness = await createHarness();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-interrupted-user-input"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-interrupted"),
    });
    emitPendingUserInputRequest(harness, {
      eventId: "evt-user-input-requested-interrupted",
      requestId: "req-interrupted-user-input",
      turnId: "turn-interrupted",
      lifecycleGeneration: "generation-interrupted",
    });

    const pendingThread = await waitForProjectedThread(
      harness.readProjectedThread,
      (thread) => thread.hasPendingUserInput === true,
    );
    expect(pendingInteractionStatus(pendingThread, "req-interrupted-user-input")).toBe("pending");

    // A Stop rotates the lifecycle generation without emitting `session.started`, so the interrupted
    // turn's terminal event is the only settlement signal left.
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-interrupted-user-input"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-interrupted"),
      payload: { state: "interrupted" },
    });

    const settledThread = await waitForProjectedThread(
      harness.readProjectedThread,
      (thread) => thread.hasPendingUserInput === false,
    );
    expect(pendingInteractionStatus(settledThread, "req-interrupted-user-input")).toBe("uncertain");
    const failures = userInputFailureActivities(settledThread);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.payload).toMatchObject({
      requestId: "req-interrupted-user-input",
      lifecycleGeneration: "generation-interrupted",
      detail: expect.stringContaining(
        "Stale pending user-input request: req-interrupted-user-input",
      ),
    });
  });

  it("keeps a Claude background approval answerable after foreground completion", async () => {
    const harness = await createHarness();
    const threadId = asThreadId("thread-1");
    const turnId = asTurnId("claude-foreground");
    const requestId = ApprovalRequestId.makeUnsafe("claude-background-approval");
    const common = {
      provider: "claudeAgent" as const,
      threadId,
      turnId,
      createdAt: new Date().toISOString(),
      lifecycleGeneration: "claude-generation",
    };
    harness.emit({
      ...common,
      type: "turn.started",
      eventId: asEventId("claude-started"),
      payload: {},
    });
    harness.emit({
      ...common,
      type: "request.opened",
      eventId: asEventId("claude-approval-opened"),
      requestId,
      payload: { requestType: "tool_approval", detail: "Background computer operation" },
    });
    await waitForProjectedThread(
      harness.readProjectedThread,
      (thread) => pendingInteractionStatus(thread, requestId) === "pending",
    );
    harness.emit({
      ...common,
      type: "turn.completed",
      eventId: asEventId("claude-foreground-ended"),
      payload: { state: "completed" },
    });
    await harness.drain();
    const pending = await harness.readProjectedThread();
    expect(pendingInteractionStatus(pending, requestId)).toBe("pending");

    harness.emit({
      ...common,
      type: "request.resolved",
      eventId: asEventId("claude-approval-resolved"),
      requestId,
      payload: { requestType: "tool_approval", decision: "accept" },
    });
    await waitForProjectedThread(
      harness.readProjectedThread,
      (thread) => thread.hasPendingApprovals === false,
    );
  });

  it("scopes session.exited settlement to the exited lifecycle generation", async () => {
    const harness = await createHarness();

    emitPendingUserInputRequest(harness, {
      eventId: "evt-user-input-requested-exit-generation",
      requestId: "req-exit-generation-a",
      turnId: "turn-exit-generation-a",
      lifecycleGeneration: "generation-a",
    });
    await waitForProjectedThread(
      harness.readProjectedThread,
      (thread) => thread.hasPendingUserInput === true,
    );

    harness.emit({
      type: "session.exited",
      eventId: asEventId("evt-session-exited-other-generation"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      lifecycleGeneration: "generation-b",
      payload: { reason: "exit from a different generation" },
    });
    await harness.drain();
    const untouchedThread = await harness.readProjectedThread();
    expect(pendingInteractionStatus(untouchedThread, "req-exit-generation-a")).toBe("pending");
    expect(userInputFailureActivities(untouchedThread)).toHaveLength(0);

    harness.emit({
      type: "session.exited",
      eventId: asEventId("evt-session-exited-matching-generation"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      lifecycleGeneration: "generation-a",
      payload: { reason: "exit from the owning generation" },
    });

    const settledThread = await waitForProjectedThread(
      harness.readProjectedThread,
      (thread) => pendingInteractionStatus(thread, "req-exit-generation-a") === "uncertain",
    );
    expect(settledThread.hasPendingUserInput).toBe(false);
    expect(userInputFailureActivities(settledThread)).toHaveLength(1);
  });
});
