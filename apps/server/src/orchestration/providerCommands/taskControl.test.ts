import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { CommandId, ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { makeReactorTestHarness, asTurnId, waitFor } from "./reactorTestFixtures";

describe("native child runtime teardown", () => {
  const { createHarness, readHarnessThread } = makeReactorTestHarness();

  it.each([
    { concurrentChildUpdate: "none", childStatus: "interrupted" },
    { concurrentChildUpdate: "settled", childStatus: "ready" },
    { concurrentChildUpdate: "still-running", childStatus: "interrupted" },
  ] as const)(
    "settles native children and the owner after an interrupt ($concurrentChildUpdate child update)",
    async ({ concurrentChildUpdate, childStatus }) => {
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
      const setRunning = (threadId: ThreadId, commandId: string, updatedAt: string) =>
        harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.makeUnsafe(commandId),
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: asTurnId(`turn-${threadId}`),
            lastError: null,
            updatedAt,
          },
          createdAt: updatedAt,
        });
      for (const threadId of [ownerId, childId]) {
        await Effect.runPromise(setRunning(threadId, `running-${threadId}`, now));
      }
      // The child's own runtime events land while the owner interrupt is still in flight.
      const childUpdatedAt = new Date(Date.parse(now) + 1_000).toISOString();
      harness.interruptTurn.mockImplementationOnce(() =>
        concurrentChildUpdate === "none"
          ? Effect.void
          : concurrentChildUpdate === "still-running"
            ? setRunning(childId, "child-progress", childUpdatedAt).pipe(
                Effect.asVoid,
                Effect.orDie,
              )
            : harness.engine
                .dispatch({
                  type: "thread.session.set",
                  commandId: CommandId.makeUnsafe("child-settled"),
                  threadId: childId,
                  session: {
                    threadId: childId,
                    status: "ready",
                    providerName: "codex",
                    runtimeMode: "approval-required",
                    activeTurnId: null,
                    lastError: null,
                    updatedAt: childUpdatedAt,
                  },
                  createdAt: childUpdatedAt,
                })
                .pipe(Effect.asVoid, Effect.orDie),
      );
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
        status: childStatus,
        activeTurnId: null,
      });
      expect((await readHarnessThread(harness, ownerId))?.session).toMatchObject({
        status: "interrupted",
        activeTurnId: null,
      });
    },
  );

  it.each([
    { runtimeStatus: "ready", settles: true },
    { runtimeStatus: "running", settles: false },
  ] as const)(
    "settles an accepted Stop at once only when no provider turn is live ($runtimeStatus)",
    async ({ runtimeStatus, settles }) => {
      const harness = await createHarness();
      const threadId = ThreadId.makeUnsafe("thread-1");
      const turnId = asTurnId("turn-stop-after-provider-end");
      const now = new Date().toISOString();
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.makeUnsafe("running-stop-after-provider-end"),
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: turnId,
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        }),
      );
      harness.setRuntimeSessionTurnState({
        threadId: "thread-1",
        status: runtimeStatus,
        ...(runtimeStatus === "running" ? { activeTurnId: turnId } : {}),
      });

      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.makeUnsafe("interrupt-stop-after-provider-end"),
          threadId,
          turnId,
          createdAt: new Date().toISOString(),
        }),
      );
      await waitFor(() => harness.interruptTurn.mock.calls.length === 1);
      await harness.drain();

      expect((await readHarnessThread(harness, threadId))?.session).toMatchObject(
        settles
          ? { status: "interrupted", activeTurnId: null }
          : { status: "running", activeTurnId: turnId },
      );
    },
  );
});
