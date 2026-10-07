import { describe, it, expect } from "vitest";
import { ThreadId, CommandId, TurnId } from "@glade/contracts/core/baseSchemas";
import { Effect, Option, Duration } from "effect";

import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import fs from "node:fs";
import { PROVIDER_COMMAND_REACTOR_CONSUMER } from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import {
  makeReactorTestHarness,
  asTurnId,
  asMessageId,
  asEventId,
  waitFor,
  asProjectId,
} from "./reactorTestFixtures";

describe("Provider reactor queuedTurns", () => {
  const { createHarness, closeReactorScope, seedQueuedTurnBehindLiveTurn } =
    makeReactorTestHarness();

  const settleLiveTurn = async (
    harness: Awaited<ReturnType<typeof createHarness>>,
    input: { readonly turnId: TurnId; readonly eventId: string },
  ) => {
    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    await harness.emitRuntimeEvent({
      type: "turn.completed",
      eventId: asEventId(input.eventId),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: input.turnId,
      payload: {
        state: "completed",
      },
      providerRefs: {},
    } as ProviderRuntimeEvent);
  };

  it("drains a thread again after a promotion dispatch failed", async () => {
    const harness = await createHarness();
    const queuedSequence = await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-blocked"),
      messageId: asMessageId("msg-queue-blocked"),
      text: "promote me on the next settle",
    });

    let refusals = 0;
    harness.interceptEngineDispatch((command) => {
      if (command.type !== "thread.turn.dispatch-queued" || refusals > 0) {
        return undefined;
      }
      refusals += 1;
      return Effect.fail(
        new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Thread has a checkpoint revert in progress.",
        }),
      );
    });

    await settleLiveTurn(harness, {
      turnId: asTurnId("turn-running-blocked"),
      eventId: "evt-turn-completed-blocked",
    });
    await waitFor(() => refusals === 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(harness.sendTurn).not.toHaveBeenCalled();

    await settleLiveTurn(harness, {
      turnId: asTurnId("turn-running-blocked-later"),
      eventId: "evt-turn-completed-blocked-later",
    });

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "promote me on the next settle",
    });
    const promotion = await Effect.runPromise(
      harness.queuedTurnPromotionRepository.getBySequence(queuedSequence),
    );
    expect(promotion.pipe(Option.getOrThrow)).toMatchObject({ state: "promoted" });
  });

  it("drains a session again after a promoted turn start failed before dispatch", async () => {
    const harness = await createHarness();

    const attachment = {
      type: "image",
      id: `att_v2_${"a1b2c3d4".repeat(4)}`,
      name: "vanishes.png",
      mimeType: "image/png",
      sizeBytes: 3,
    } as const;
    const attachmentPath = await harness.stageAttachment(attachment);
    const queuedSequence = await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-reservation"),
      messageId: asMessageId("msg-queue-reservation"),
      text: "this promotion never reaches the provider",
      attachments: [attachment],
    });
    fs.rmSync(attachmentPath, { force: true });

    await settleLiveTurn(harness, {
      turnId: asTurnId("turn-running-reservation"),
      eventId: "evt-turn-completed-reservation",
    });

    await waitFor(async () => {
      const promotion = await Effect.runPromise(
        harness.queuedTurnPromotionRepository.getBySequence(queuedSequence),
      );
      return Option.getOrUndefined(promotion)?.state === "promoted";
    });
    expect(harness.sendTurn).not.toHaveBeenCalled();

    await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-reservation-next"),
      messageId: asMessageId("msg-queue-reservation-next"),
      text: "promote me after the failed promotion",
    });
    await settleLiveTurn(harness, {
      turnId: asTurnId("turn-running-reservation-next"),
      eventId: "evt-turn-completed-reservation-next",
    });

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "promote me after the failed promotion",
    });
  });

  it("does not promote another queued turn while the reactor is shutting down", async () => {
    const harness = await createHarness();
    await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-shutdown"),
      messageId: asMessageId("msg-queue-shutdown-1"),
      text: "first queued turn",
    });
    const secondQueuedSequence = await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-shutdown"),
      messageId: asMessageId("msg-queue-shutdown-2"),
      text: "stay queued for the next boot",
    });

    let promotionDispatches = 0;
    harness.interceptEngineDispatch((command) => {
      if (command.type === "thread.turn.dispatch-queued") {
        promotionDispatches += 1;
      }
      return undefined;
    });

    harness.sendTurn.mockImplementationOnce(() => Effect.never);

    await settleLiveTurn(harness, {
      turnId: asTurnId("turn-running-shutdown"),
      eventId: "evt-turn-completed-shutdown",
    });
    await waitFor(() => promotionDispatches === 1 && harness.sendTurn.mock.calls.length === 1);
    await closeReactorScope();

    expect(promotionDispatches).toBe(1);
    const secondPromotion = await Effect.runPromise(
      harness.queuedTurnPromotionRepository.getBySequence(secondQueuedSequence),
    );
    expect(secondPromotion.pipe(Option.getOrThrow)).toMatchObject({
      state: "queued",
      claimOwner: null,
    });
  });

  it("releases a timed-out promoted turn when its live provider turn settles", async () => {
    const harness = await createHarness({
      commandEventTimeout: Duration.millis(25),
    });
    await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-timeout"),
      messageId: asMessageId("msg-queue-timeout-1"),
      text: "first queued turn times out after provider acceptance",
    });
    await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-timeout"),
      messageId: asMessageId("msg-queue-timeout-2"),
      text: "second queued turn must drain after settlement",
    });

    const timedOutTurnId = asTurnId("turn-provider-accepted-before-timeout");
    harness.sendTurn.mockImplementationOnce(() =>
      Effect.sync(() =>
        harness.setRuntimeSessionTurnState({
          threadId: "thread-1",
          status: "running",
          activeTurnId: timedOutTurnId,
        }),
      ).pipe(Effect.andThen(Effect.never)),
    );

    await settleLiveTurn(harness, {
      turnId: asTurnId("turn-running-timeout"),
      eventId: "evt-turn-completed-timeout",
    });
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await waitFor(async () =>
      Effect.runPromise(
        harness.deliveryRepository
          .firstBlockingDeliveryForThread({
            consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
            threadId: "thread-1",
          })
          .pipe(Effect.map(Option.isSome)),
      ),
    );

    const blocker = (
      await Effect.runPromise(
        harness.deliveryRepository.firstBlockingDeliveryForThread({
          consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
          threadId: "thread-1",
        }),
      )
    ).pipe(Option.getOrThrow);
    await Effect.runPromise(
      harness.reactor.reconcileDelivery({
        eventSequence: blocker.eventSequence,
        threadId: ThreadId.makeUnsafe("thread-1"),
        expectedState: "uncertain",
        outcome: "abandon",
        reconciledBy: "test-operator",
        note: "The provider accepted the timed-out turn.",
      }),
    );

    await settleLiveTurn(harness, {
      turnId: timedOutTurnId,
      eventId: "evt-provider-turn-completed-after-timeout",
    });
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "second queued turn must drain after settlement",
    });
  });

  it("keeps the next queued turn blocked until the promoted turn settles", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const firstSendGate: {
      release: ((value: { readonly threadId: ThreadId; readonly turnId: TurnId }) => void) | null;
    } = { release: null };

    harness.setRuntimeSessionTurnState({
      threadId: "thread-1",
      status: "running",
      activeTurnId: asTurnId("turn-running-before-promotion"),
    });
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running-double-queue"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-running-before-promotion"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    harness.sendTurn.mockImplementationOnce(() =>
      Effect.tryPromise(
        () =>
          new Promise<{ readonly threadId: ThreadId; readonly turnId: TurnId }>((resolve) => {
            firstSendGate.release = resolve;
          }),
      ),
    );

    for (const [messageId, text] of [
      ["msg-queue-promoted-1", "first queued turn"],
      ["msg-queue-promoted-2", "second queued turn"],
    ] as const) {
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe(`cmd-turn-${messageId}`),
          threadId: ThreadId.makeUnsafe("thread-1"),
          message: {
            messageId: asMessageId(messageId),
            role: "user",
            text,
            attachments: [],
          },
          runtimeMode: "approval-required",

          createdAt: now,
        }),
      );
    }

    await harness.drain();
    expect(harness.sendTurn).not.toHaveBeenCalled();

    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    await harness.emitRuntimeEvent({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-promote-first"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-running-before-promotion"),
      payload: {
        state: "completed",
      },
      providerRefs: {},
    } as ProviderRuntimeEvent);

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "first queued turn",
    });

    harness.setRuntimeSessionTurnState({
      threadId: "thread-1",
      status: "running",
      activeTurnId: asTurnId("turn-promoted-1"),
    });
    expect(firstSendGate.release).not.toBeNull();
    firstSendGate.release?.({
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: asTurnId("turn-promoted-1"),
    });
    await harness.drain();

    // A duplicate/late terminal event for the previous turn can arrive after the promoted turn has
    // fully started. It must not release that promoted turn's session reservation or drain the next
    // queued message.
    await harness.emitRuntimeEvent({
      type: "turn.aborted",
      eventId: asEventId("evt-late-turn-aborted-after-promotion-started"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-running-before-promotion"),
      payload: {
        reason: "interrupted",
      },
      providerRefs: {},
    } as ProviderRuntimeEvent);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(harness.sendTurn).toHaveBeenCalledTimes(1);

    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    await harness.emitRuntimeEvent({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-promoted-first"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-promoted-1"),
      payload: {
        state: "completed",
      },
      providerRefs: {},
    } as ProviderRuntimeEvent);

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "second queued turn",
    });
  });

  it("queues a child-thread turn while the shared parent session runs and drains it on settle", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-child-thread-create"),
        threadId: ThreadId.makeUnsafe("thread-child"),
        projectId: asProjectId("project-1"),
        parentThreadId: ThreadId.makeUnsafe("thread-1"),
        title: "Child",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },

        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
      }),
    );

    harness.setRuntimeSessionTurnState({
      threadId: "thread-1",
      status: "running",
      activeTurnId: asTurnId("turn-parent-running"),
    });
    harness.sendTurn.mockClear();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-child-turn-start"),
        threadId: ThreadId.makeUnsafe("thread-child"),
        message: {
          messageId: asMessageId("msg-child-queued"),
          role: "user",
          text: "child follow-up",
          attachments: [],
        },
        runtimeMode: "approval-required",

        createdAt: now,
      }),
    );

    await harness.drain();

    expect(harness.sendTurn).not.toHaveBeenCalled();

    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    await harness.emitRuntimeEvent({
      type: "turn.completed",
      eventId: asEventId("evt-parent-turn-completed"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-parent-running"),
      payload: {
        state: "completed",
      },
      providerRefs: {},
    } as ProviderRuntimeEvent);

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-child"),
      input: "child follow-up",
    });
  });
});
