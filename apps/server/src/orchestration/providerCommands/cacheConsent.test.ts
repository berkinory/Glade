import { describe, it, expect } from "vitest";
import type { ClaudeCacheObservation } from "@glade/contracts/provider/claudeCache";
import { Effect } from "effect";
import { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { makeReactorTestHarness, waitFor } from "./reactorTestFixtures";
import { makeCacheReviewTestFixtures } from "./cacheReviewTestFixtures";

describe("Provider reactor cacheConsent", () => {
  const { createHarness, readHarnessThread, dispatchHarnessUserTurn } = makeReactorTestHarness();
  const { expiredCacheObservation, createCacheHarness, sendHeldMessage, respondToReview } =
    makeCacheReviewTestFixtures({ createHarness, dispatchHarnessUserTurn, readHarnessThread });
  it.each(["archive", "stop", "rollback"] as const)(
    "revokes an accepted Continue when %s arrives during cache revalidation",
    async (action) => {
      const observation = expiredCacheObservation();
      let getterCalls = 0;
      let releaseObservation!: (observation: ClaudeCacheObservation) => void;
      const observationGate = new Promise<ClaudeCacheObservation>((resolve) => {
        releaseObservation = resolve;
      });
      const harness = await createHarness({
        threadModelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
        getClaudeCacheObservation: () => {
          getterCalls += 1;
          return getterCalls === 2
            ? Effect.promise(() => observationGate)
            : Effect.succeed(observation);
        },
      });
      const review = await sendHeldMessage(harness);
      try {
        await Effect.runPromise(
          harness.engine.dispatch({
            type: "thread.claude-cache.respond",
            commandId: CommandId.makeUnsafe("cmd-cache-continue-during-revalidation"),
            threadId: ThreadId.makeUnsafe("thread-1"),
            reviewId: review.reviewId,
            messageId: review.messageId,
            decision: "continue",
            createdAt: new Date().toISOString(),
          }),
        );
        await waitFor(() => getterCalls === 2);
        await Effect.runPromise(
          harness.engine.dispatch(
            action === "archive"
              ? {
                  type: "thread.archive",
                  commandId: CommandId.makeUnsafe("cmd-cache-archive-during-revalidation"),
                  threadId: ThreadId.makeUnsafe("thread-1"),
                }
              : action === "stop"
                ? {
                    type: "thread.session.stop",
                    commandId: CommandId.makeUnsafe("cmd-cache-stop-during-revalidation"),
                    threadId: ThreadId.makeUnsafe("thread-1"),
                    createdAt: new Date().toISOString(),
                  }
                : {
                    type: "thread.conversation.rollback.complete",
                    commandId: CommandId.makeUnsafe("cmd-cache-rollback-during-revalidation"),
                    threadId: ThreadId.makeUnsafe("thread-1"),
                    messageId: review.messageId,
                    numTurns: 1,
                    createdAt: new Date().toISOString(),
                  },
          ),
        );
      } finally {
        releaseObservation(observation);
      }
      await harness.drain();

      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect((await readHarnessThread(harness))?.claudeCacheReview?.status).not.toBe("responding");
      if (action === "rollback") {
        expect((await readHarnessThread(harness))?.claudeCacheReview?.status).toBe("failed");
        expect((await readHarnessThread(harness))?.messages).toEqual([]);
      }
    },
  );

  it("holds the first large expired-cache send and later queued messages", async () => {
    const harness = await createCacheHarness();
    const review = await sendHeldMessage(harness);

    expect(harness.sendTurn).not.toHaveBeenCalled();
    expect(review).toMatchObject({
      messageId: "cache-held-message",
      assessment: { state: "likely-expired", contextTokens: 120_000 },
    });
    expect((await readHarnessThread(harness))?.session?.status).toBe("ready");

    await dispatchHarnessUserTurn(harness, {
      messageId: "cache-later-message",
      text: "This message must remain queued",
      createdAt: new Date().toISOString(),
    });
    await harness.drain();

    const thread = await readHarnessThread(harness);
    expect(thread?.claudeCacheReview?.reviewId).toBe(review.reviewId);
    expect(thread?.messages.map((message) => message.id)).toEqual([
      "cache-held-message",
      "cache-later-message",
    ]);
    expect(harness.sendTurn).not.toHaveBeenCalled();
  });

  it("continues the persisted original message once and does not replay duplicate responses", async () => {
    const observation = expiredCacheObservation();
    const harness = await createCacheHarness(() => observation);
    const review = await sendHeldMessage(harness);

    const continueCommand = await respondToReview(harness, review, "continue");
    await waitFor(async () => (await readHarnessThread(harness))?.claudeCacheReview == null);

    expect(harness.sendTurn).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: "thread-1",
      input: "Continue with this exact message",
    });

    await Effect.runPromise(harness.engine.dispatch(continueCommand));
    await harness.drain();
    await expect(respondToReview(harness, review, "continue", "duplicate")).rejects.toThrow(
      "Command produced no events.",
    );
    expect(harness.sendTurn).toHaveBeenCalledTimes(1);
    expect(
      (await readHarnessThread(harness))?.messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
  });

  it("cancels the send while retaining the original user message", async () => {
    const harness = await createCacheHarness();
    const review = await sendHeldMessage(harness);
    const pendingBeforeCancel = await Effect.runPromise(harness.sql`
        SELECT pending_message_id FROM projection_turns
        WHERE thread_id = 'thread-1' AND turn_id IS NULL
      `);
    expect(pendingBeforeCancel).toHaveLength(1);

    await respondToReview(harness, review, "cancel");
    await waitFor(async () => (await readHarnessThread(harness))?.claudeCacheReview == null);

    expect(harness.sendTurn).not.toHaveBeenCalled();
    expect((await readHarnessThread(harness))?.messages).toContainEqual(
      expect.objectContaining({
        id: "cache-held-message",
        role: "user",
        text: "Continue with this exact message",
      }),
    );
    expect(
      await Effect.runPromise(harness.sql`
        SELECT pending_message_id FROM projection_turns
        WHERE thread_id = 'thread-1' AND turn_id IS NULL
      `),
    ).toEqual([]);
  });

  it("deletes a held pending turn when its thread is deleted", async () => {
    const harness = await createCacheHarness();
    await sendHeldMessage(harness);
    expect(
      await Effect.runPromise(harness.sql`
        SELECT pending_message_id FROM projection_turns
        WHERE thread_id = 'thread-1' AND turn_id IS NULL
      `),
    ).toHaveLength(1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.delete",
        commandId: CommandId.makeUnsafe("cmd-delete-cache-hold"),
        threadId: ThreadId.makeUnsafe("thread-1"),
      }),
    );
    await harness.drain();

    expect(harness.sendTurn).not.toHaveBeenCalled();
    expect(
      await Effect.runPromise(harness.sql`
        SELECT pending_message_id FROM projection_turns
        WHERE thread_id = 'thread-1' AND turn_id IS NULL
      `),
    ).toEqual([]);
  });

  it("settles a removed held message as failed instead of leaving the review responding", async () => {
    const observation = expiredCacheObservation();
    const harness = await createCacheHarness(() => observation);
    const review = await sendHeldMessage(harness);
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.conversation.rollback.complete",
        commandId: CommandId.makeUnsafe("cmd-remove-held-message"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: review.messageId,
        numTurns: 1,
        createdAt: new Date().toISOString(),
      }),
    );
    expect((await readHarnessThread(harness))?.messages).toEqual([]);

    await respondToReview(harness, review, "continue");

    expect(harness.sendTurn).not.toHaveBeenCalled();
    expect((await readHarnessThread(harness))?.claudeCacheReview).toMatchObject({
      reviewId: review.reviewId,
      status: "failed",
      error: expect.stringContaining("could not start"),
    });
  });

  it.each(["nativeSessionId", "lifecycleGeneration", "model"] as const)(
    "requires a new review when %s changes before Continue",
    async (field) => {
      let observation = expiredCacheObservation();
      const harness = await createCacheHarness(() => observation);
      const review = await sendHeldMessage(harness);
      observation = { ...observation, [field]: `${observation[field]}-changed` };

      await respondToReview(harness, review, "continue");
      await waitFor(
        async () => (await readHarnessThread(harness))?.claudeCacheReview?.status === "pending",
      );

      const renewedReview = (await readHarnessThread(harness))?.claudeCacheReview;
      expect(renewedReview?.reviewId).not.toBe(review.reviewId);
      expect(renewedReview?.messageId).toBe(review.messageId);
      expect(renewedReview?.assessment[field]).toBe(observation[field]);
      expect(harness.sendTurn).not.toHaveBeenCalled();
    },
  );
});
