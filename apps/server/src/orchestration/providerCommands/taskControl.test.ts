import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { CommandId, ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { makeReactorTestHarness, asTurnId, waitFor } from "./reactorTestFixtures";

describe("native child runtime teardown", () => {
  const { createHarness, readHarnessThread } = makeReactorTestHarness();

  it("settles active native children after a successful owner interrupt", async () => {
    const harness = await createHarness();
    const ownerId = ThreadId.makeUnsafe("thread-1");
    const childId = ThreadId.makeUnsafe("subagent:thread-1:native-worker");
    const now = new Date().toISOString();
    const owner = await readHarnessThread(harness);
    if (!owner) throw new Error("Expected owner thread");
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("create-worker"),
        threadId: childId,
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Worker",
        modelSelection: owner.modelSelection,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        parentThreadId: ownerId,
        creationSource: "provider_native",
        createdAt: now,
      }),
    );
    for (const threadId of [ownerId, childId]) {
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.makeUnsafe(`running-${threadId}`),
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: asTurnId(`turn-${threadId}`),
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        }),
      );
    }
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.makeUnsafe("interrupt-owner"),
        threadId: ownerId,
        turnId: asTurnId(`turn-${ownerId}`),
        createdAt: new Date().toISOString(),
      }),
    );
    await waitFor(() => harness.interruptTurn.mock.calls.length === 1);
    await harness.drain();
    expect((await readHarnessThread(harness, childId))?.session).toMatchObject({
      status: "interrupted",
      activeTurnId: null,
    });
  });
});
