import { describe, it, expect } from "vitest";
import { Deferred, Effect, Option } from "effect";
import { CommandId, ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_COMMAND_REACTOR_CONSUMER } from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import { makeReactorTestHarness, asMessageId, asTurnId, waitFor } from "./reactorTestFixtures";

describe("Provider delivery by session owner", () => {
  const { createHarness } = makeReactorTestHarness();

  it("delivers an independent chat while another chat's provider call is stalled", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const stalledThread = ThreadId.makeUnsafe("thread-1");
    const freeThread = ThreadId.makeUnsafe("thread-2");
    const release = Effect.runSync(Deferred.make<void>());
    harness.sendTurn.mockImplementation((input) =>
      (input.threadId === stalledThread ? Deferred.await(release) : Effect.void).pipe(
        Effect.as({ threadId: input.threadId, turnId: asTurnId(`turn-${input.threadId}`) }),
      ),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-2-create"),
        threadId: freeThread,
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Second",
        modelSelection: (await harness.readThread(stalledThread))!.modelSelection,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
      }),
    );
    const startTurn = (threadId: ThreadId) =>
      Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe(`cmd-turn-${threadId}`),
          threadId,
          message: {
            messageId: asMessageId(`message-${threadId}`),
            role: "user",
            text: "hello",
            attachments: [],
          },
          runtimeMode: "approval-required",
          createdAt: now,
        }),
      );

    const stalled = await startTurn(stalledThread);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    const free = await startTurn(freeThread);
    await waitFor(() =>
      harness.sendTurn.mock.calls.some(([input]) => input.threadId === freeThread),
    );

    const readCursor = () =>
      Effect.runPromise(
        harness.deliveryRepository
          .getConsumerState(PROVIDER_COMMAND_REACTOR_CONSUMER)
          .pipe(Effect.map((state) => Option.getOrThrow(state).lastAckedSequence)),
      );
    const readDelivery = (eventSequence: number) =>
      Effect.runPromise(
        harness.deliveryRepository
          .getDelivery({ consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER, eventSequence })
          .pipe(Effect.map(Option.getOrUndefined)),
      );
    await waitFor(async () => (await readDelivery(free.sequence))?.state === "succeeded");
    // The acknowledged prefix stays below the unsettled call, so a restart replays it.
    expect(await readCursor()).toBeLessThan(stalled.sequence);
    expect((await readDelivery(stalled.sequence))?.state).toBe("inflight");

    await Effect.runPromise(Deferred.succeed(release, undefined));
    await harness.drain();
    expect((await readDelivery(stalled.sequence))?.state).toBe("succeeded");
    expect(harness.sendTurn).toHaveBeenCalledTimes(2);
  });
});
