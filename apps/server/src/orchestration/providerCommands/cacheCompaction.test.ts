import { describe, it, expect, vi } from "vitest";
import { Effect } from "effect";
import type { ClaudeCacheObservation } from "@glade/contracts/provider/claudeCache";
import { type ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { makeReactorTestHarness, waitFor } from "./reactorTestFixtures";
import { makeCacheReviewTestFixtures } from "./cacheReviewTestFixtures";

describe("Provider reactor cacheCompaction", () => {
  const { createHarness, readHarnessThread, dispatchHarnessUserTurn } = makeReactorTestHarness();
  const {
    expiredCacheObservation,
    sendHeldMessage,
    respondToReview,
    createCompactionHarness,
    emitCompactionTerminal,
  } = makeCacheReviewTestFixtures({ createHarness, dispatchHarnessUserTurn, readHarnessThread });
  it("persists compacting before native dispatch and keeps the user message pending", async () => {
    const { harness, startClaudeCompaction } = await createCompactionHarness();
    const review = await sendHeldMessage(harness);
    startClaudeCompaction.mockImplementation(({ threadId, turnId }) =>
      Effect.gen(function* () {
        const readModel = yield* harness.engine.getReadModel();
        expect(
          readModel.threads.find((thread) => thread.id === threadId)?.claudeCacheReview,
        ).toMatchObject({
          reviewId: review.reviewId,
          status: "compacting",
          compactionTurnId: turnId,
        });
        return { threadId, turnId };
      }),
    );

    await respondToReview(harness, review, "compact");

    expect(startClaudeCompaction).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn).not.toHaveBeenCalled();
    const thread = await readHarnessThread(harness);
    expect(thread?.claudeCacheReview?.status).toBe("compacting");
    expect(thread?.messages.find((message) => message.id === review.messageId)?.turnId).toBeNull();
    await dispatchHarnessUserTurn(harness, {
      messageId: "cache-message-during-compaction",
      text: "Remain queued until the pending message is released",
      createdAt: new Date().toISOString(),
    });
    await harness.drain();
    expect(harness.sendTurn).not.toHaveBeenCalled();
  });

  it("releases the original message exactly once after matching successful compaction", async () => {
    const { harness, startClaudeCompaction, setObservation } = await createCompactionHarness();
    const review = await sendHeldMessage(harness);
    await respondToReview(harness, review, "compact");
    const turnId = startClaudeCompaction.mock.calls[0]?.[0].turnId;
    expect(turnId).toBeTruthy();
    setObservation({
      ...review.assessment,
      contextTokens: 16_000,
      state: "likely-warm",
      lastResponseAt: new Date().toISOString(),
    });

    await emitCompactionTerminal(harness, turnId!, {
      state: "completed",
      contextCompacted: true,
    });
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await harness.drain();

    expect(harness.sendTurn.mock.calls[0]?.[0].input).toBe("Continue with this exact message");
    expect((await readHarnessThread(harness))?.claudeCacheReview).toBeNull();
    expect(
      (await readHarnessThread(harness))?.messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
    expect((await readHarnessThread(harness))?.messages[0]?.turnId).not.toBe(turnId);
    await emitCompactionTerminal(
      harness,
      turnId!,
      { state: "completed", contextCompacted: true },
      "completed-duplicate",
    );
    expect(harness.sendTurn).toHaveBeenCalledTimes(1);
  });

  it("does not release a failed compaction even when a native boundary was observed", async () => {
    const { harness, startClaudeCompaction } = await createCompactionHarness();
    const review = await sendHeldMessage(harness);
    await respondToReview(harness, review, "compact");
    const turnId = startClaudeCompaction.mock.calls[0]?.[0].turnId;
    expect(turnId).toBeTruthy();

    await emitCompactionTerminal(harness, turnId!, { state: "failed", contextCompacted: true });
    await waitFor(
      async () => (await readHarnessThread(harness))?.claudeCacheReview?.status === "failed",
    );

    expect(harness.sendTurn).not.toHaveBeenCalled();
  });

  it("does not compact before an original message that already requests /compact", async () => {
    const { harness, startClaudeCompaction } = await createCompactionHarness();
    await dispatchHarnessUserTurn(harness, {
      messageId: "cache-original-compact",
      text: "/compact Preserve the pending task",
      createdAt: new Date().toISOString(),
    });
    await waitFor(
      async () => (await readHarnessThread(harness))?.claudeCacheReview?.status === "pending",
    );
    const review = (await readHarnessThread(harness))?.claudeCacheReview;

    await respondToReview(harness, review, "compact");

    expect(startClaudeCompaction).not.toHaveBeenCalled();
    expect(harness.sendTurn).not.toHaveBeenCalled();
    expect((await readHarnessThread(harness))?.claudeCacheReview?.status).toBe("failed");
  });

  it.each(["cache-revalidation", "persisted-compacting"] as const)(
    "fails a compact request when rollback removes its message during %s",
    async (stage) => {
      const observation = expiredCacheObservation();
      let getterCalls = 0;
      let releaseObservation!: (observation: ClaudeCacheObservation) => void;
      const observationGate = new Promise<ClaudeCacheObservation>((resolve) => {
        releaseObservation = resolve;
      });
      const startClaudeCompaction = vi.fn<
        NonNullable<ProviderServiceShape["startClaudeCompaction"]>
      >((input) => Effect.succeed(input));
      const harness = await createHarness({
        threadModelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
        startClaudeCompaction,
        getClaudeCacheObservation: () => {
          getterCalls += 1;
          return stage === "cache-revalidation" && getterCalls === 2
            ? Effect.promise(() => observationGate)
            : Effect.succeed(observation);
        },
      });
      const review = await sendHeldMessage(harness);
      const rollback: OrchestrationCommand = {
        type: "thread.conversation.rollback.complete",
        commandId: CommandId.makeUnsafe("cmd-compact-authorization-rollback"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: review.messageId,
        numTurns: 1,
        createdAt: new Date().toISOString(),
      };
      let sawPersistedCompacting = false;
      if (stage === "persisted-compacting") {
        const dispatch = harness.engine.dispatch;
        harness.interceptEngineDispatch((command) => {
          if (command.type !== "thread.claude-cache.set" || command.review?.status !== "compacting")
            return undefined;
          return Effect.gen(function* () {
            const receipt = yield* dispatch(command);
            const thread = (yield* harness.engine.getReadModel()).threads.find(
              (candidate) => candidate.id === rollback.threadId,
            );
            expect(thread?.claudeCacheReview?.status).toBe("compacting");
            sawPersistedCompacting = true;
            yield* dispatch(rollback);
            return receipt;
          });
        });
      }
      try {
        await Effect.runPromise(
          harness.engine.dispatch({
            type: "thread.claude-cache.respond",
            commandId: CommandId.makeUnsafe("cmd-compact-authorization-respond"),
            threadId: ThreadId.makeUnsafe("thread-1"),
            reviewId: review.reviewId,
            messageId: review.messageId,
            decision: "compact",
            createdAt: new Date().toISOString(),
          }),
        );
        if (stage === "cache-revalidation") {
          await waitFor(() => getterCalls === 2);
          await Effect.runPromise(harness.engine.dispatch(rollback));
        }
      } finally {
        releaseObservation(observation);
      }
      await harness.drain();

      if (stage === "persisted-compacting") expect(sawPersistedCompacting).toBe(true);
      expect(startClaudeCompaction).not.toHaveBeenCalled();
      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect((await readHarnessThread(harness))?.messages).toEqual([]);
      expect((await readHarnessThread(harness))?.claudeCacheReview?.status).toBe("failed");
    },
  );
});
