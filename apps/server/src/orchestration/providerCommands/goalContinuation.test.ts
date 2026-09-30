import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { CommandId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { ProviderAdapterRequestError } from "../../provider/core/Errors.ts";
import { DEFAULT_PROVIDER_INTERACTION_MODE } from "@glade/contracts/provider/sessionPolicy";
import { makeReactorTestHarness, asTurnId, asMessageId, waitFor } from "./reactorTestFixtures";

describe("Provider reactor goalContinuation", () => {
  const {
    createHarness,
    readHarnessThread,
    dispatchHarnessUserTurn,
    seedQueuedTurnBehindLiveTurn,
  } = makeReactorTestHarness();

  it("promotes queued user work before an automatic goal continuation", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("cmd-goal-queue-priority"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        goal: "Finish after handling user input",
        goalStartBehavior: "defer",
      }),
    );
    await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-before-goal-continuation"),
      messageId: asMessageId("msg-user-before-goal-continuation"),
      text: "User follow-up wins",
    });
    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    const goalStartedAt = (await readHarnessThread(harness))?.goalStartedAt;
    expect(goalStartedAt).toBeTruthy();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.goal.continue",
        commandId: CommandId.makeUnsafe("cmd-goal-continue-after-user-queue"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        goalStartedAt: goalStartedAt!,
        trigger: "turn-completed",
        sourceTurnId: asTurnId("turn-before-goal-continuation"),
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      input: expect.stringContaining("User follow-up wins"),
    });
    expect(harness.sendTurn.mock.calls[0]?.[0].input).not.toContain(
      "Continue working toward the active thread goal",
    );
  });

  it("interrupts a continuation that races a user stop", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    let releaseSend!: (result: { readonly threadId: ThreadId; readonly turnId: TurnId }) => void;
    const sendGate = new Promise<{ readonly threadId: ThreadId; readonly turnId: TurnId }>(
      (resolve) => {
        releaseSend = resolve;
      },
    );
    harness.sendTurn.mockImplementationOnce(() => Effect.promise(() => sendGate));

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("cmd-goal-before-stop-race"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        goal: "Stop this continuation",
        goalStartBehavior: "defer",
      }),
    );
    const goalStartedAt = (await readHarnessThread(harness))?.goalStartedAt;
    expect(goalStartedAt).toBeTruthy();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.goal.continue",
        commandId: CommandId.makeUnsafe("cmd-goal-continuation-before-stop"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        goalStartedAt: goalStartedAt!,
        trigger: "turn-completed",
        createdAt: now,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.makeUnsafe("cmd-stop-racing-goal-continuation"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        turnId: asTurnId("turn-before-goal-continuation"),
        createdAt: now,
      }),
    );
    releaseSend({
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: asTurnId("turn-goal-continuation-after-stop"),
    });

    await waitFor(() => harness.interruptTurn.mock.calls.length >= 1);
    expect(harness.interruptTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: asTurnId("turn-goal-continuation-after-stop"),
    });
    expect((await readHarnessThread(harness))?.goalPausedAt).toBeTruthy();
  });

  it("preserves the provider resume cursor when interrupt escalation stops the runtime", async () => {
    const harness = await createHarness({
      interruptTurn: () =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: "codex",
            method: "turn/interrupt",
            detail: "connection closed after request write",
          }),
        ),
    });
    const threadId = ThreadId.makeUnsafe("thread-1");
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-interrupt-escalation-turn"),
        threadId,
        message: {
          messageId: asMessageId("user-message-interrupt-escalation"),
          role: "user",
          text: "Start a turn that cannot be interrupted",
          attachments: [],
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    harness.setRuntimeSessionTurnState({
      threadId,
      status: "running",
      activeTurnId: asTurnId("turn-interrupt-escalation"),
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.makeUnsafe("cmd-interrupt-escalation"),
        threadId,
        turnId: asTurnId("turn-interrupt-escalation"),
        createdAt: now,
      }),
    );

    await waitFor(async () => (await readHarnessThread(harness))?.session?.status === "stopped");
    expect(harness.interruptTurn).toHaveBeenCalledWith({
      threadId,
      turnId: asTurnId("turn-interrupt-escalation"),
    });
    expect(harness.stopSession).not.toHaveBeenCalled();
    expect(harness.stopRuntimeSession).toHaveBeenCalledWith({ threadId });

    await dispatchHarnessUserTurn(harness, {
      messageId: "interrupt-escalation-follow-up",
      text: "Continue after interrupt escalation",
      createdAt: new Date().toISOString(),
    });
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);

    expect(harness.startSessionWithOutcome).toHaveBeenCalledTimes(2);
    const sessions = await Effect.runPromise(harness.listSessions());
    expect(sessions).toEqual([
      expect.objectContaining({ threadId, resumeCursor: { opaque: "resume-1" } }),
    ]);
    expect(harness.stopSession).not.toHaveBeenCalled();
    expect(harness.clearSessionResumeCursor).not.toHaveBeenCalled();
    expect(harness.completePriorTranscriptBootstrap).not.toHaveBeenCalled();
    const followUpInput = harness.sendTurn.mock.calls[1]?.[0];
    expect(followUpInput?.input).toBe("Continue after interrupt escalation");
  });
});
