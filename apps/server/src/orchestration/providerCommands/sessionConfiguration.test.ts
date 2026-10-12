import { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { asMessageId, makeReactorTestHarness, waitFor } from "./reactorTestFixtures";

describe("runtime mode changes", () => {
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
});
