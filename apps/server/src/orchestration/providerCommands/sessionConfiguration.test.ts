import { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { asMessageId, asTurnId, makeReactorTestHarness, waitFor } from "./reactorTestFixtures";

describe("session configuration changes", () => {
  const { createHarness, readHarnessThread } = makeReactorTestHarness();
  const threadId = ThreadId.makeUnsafe("thread-1");

  it("leaves an idle session alone and applies the new mode on the next turn", async () => {
    const harness = await createHarness();
    const dispatch = (command: Parameters<typeof harness.engine.dispatch>[0]) =>
      Effect.runPromise(harness.engine.dispatch(command));
    const startTurn = (id: string, runtimeMode: "full-access" | "approval-required") =>
      dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe(id),
        threadId,
        message: { messageId: asMessageId(id), role: "user", text: id, attachments: [] },
        runtimeMode,
        createdAt: new Date().toISOString(),
      });

    await startTurn("first", "full-access");
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await harness.drain();
    const startsBefore = harness.startSession.mock.calls.length;
    const sessionBefore = (await readHarnessThread(harness))?.session;

    await dispatch({
      type: "thread.runtime-mode.set",
      commandId: CommandId.makeUnsafe("mode"),
      threadId,
      runtimeMode: "approval-required",
      createdAt: new Date().toISOString(),
    });
    await harness.drain();
    expect(harness.startSession.mock.calls.length).toBe(startsBefore);
    expect((await readHarnessThread(harness))?.session).toEqual(sessionBefore);

    await startTurn("second", "approval-required");
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.startSession.mock.calls.length).toBe(startsBefore + 1);
    expect(harness.startSession.mock.calls.at(-1)?.[1].runtimeMode).toBe("approval-required");
  });

  it("keeps steering on the live workspace and applies a workspace move on the next turn", async () => {
    const harness = await createHarness();
    const dispatch = (command: Parameters<typeof harness.engine.dispatch>[0]) =>
      Effect.runPromise(harness.engine.dispatch(command));
    const startTurn = (id: string, steer = false) =>
      dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe(id),
        threadId,
        message: { messageId: asMessageId(id), role: "user", text: id, attachments: [] },
        runtimeMode: "approval-required",
        ...(steer ? { dispatchMode: "steer" as const } : {}),
        createdAt: new Date().toISOString(),
      });
    await startTurn("workspace-first");
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await harness.drain();
    const startsBefore = harness.startSession.mock.calls.length;
    const activeTurnId = asTurnId("workspace-live-turn");
    harness.setRuntimeSessionTurnState({ threadId, status: "running", activeTurnId });
    const setSession = (running: boolean) =>
      dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe(`workspace-session-${running}`),
        threadId,
        session: {
          threadId,
          providerName: "codex",
          status: running ? "running" : "ready",
          runtimeMode: "approval-required",
          activeTurnId: running ? activeTurnId : null,
          lastError: null,
          updatedAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      });
    await setSession(true);
    await dispatch({
      type: "thread.meta.update",
      commandId: CommandId.makeUnsafe("workspace-move"),
      threadId,
      envMode: "worktree",
      worktreePath: "/tmp/workspace-moved",
      workingDirectory: "/tmp/workspace-moved",
      branch: "task/moved",
    });
    await startTurn("workspace-steer", true);
    await waitFor(() => harness.steerTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls.length).toBe(startsBefore);
    harness.setRuntimeSessionTurnState({ threadId, status: "ready" });
    await setSession(false);
    await startTurn("workspace-next");
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.startSession.mock.calls.length).toBe(startsBefore + 1);
    expect(harness.startSession.mock.calls.at(-1)?.[1].cwd).toBe("/tmp/workspace-moved");
  });
});
