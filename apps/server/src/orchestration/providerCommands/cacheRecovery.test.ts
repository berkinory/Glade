import { describe, it, vi, expect } from "vitest";
import { ThreadId, CommandId } from "@glade/contracts/core/baseSchemas";
import { type ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import { Effect } from "effect";
import { PROVIDER_COMMAND_REACTOR_CONSUMER } from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { PROVIDER_RUNTIME_INGESTION_CONSUMER } from "../../persistence/Services/ProviderRuntimeEvents.ts";
import { DEFAULT_PROVIDER_INTERACTION_MODE } from "@glade/contracts/provider/sessionPolicy";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import {
  makeReactorTestHarness,
  asTurnId,
  asMessageId,
  asEventId,
  asProjectId,
  waitFor,
} from "./reactorTestFixtures";
import { makeCacheReviewTestFixtures } from "./cacheReviewTestFixtures";

describe("Provider reactor cacheRecovery", () => {
  const { createHarness, readHarnessThread, dispatchHarnessUserTurn } = makeReactorTestHarness();
  const { expiredCacheObservation, respondToReview } = makeCacheReviewTestFixtures({
    createHarness,
    dispatchHarnessUserTurn,
    readHarnessThread,
  });
  it.each([
    "confirmed",
    "confirmed-after-reconciliation",
    "cancelled-confirmed",
    "cancelled-missing",
    "confirmed-unacknowledged",
    "confirmed-invariant-failure",
    "confirmed-infrastructure-defect",
    "confirmed-recovery-interrupted",
    "uncertain-missing",
    "failed-recovery-interrupted",
    "uncertain-user-delivery",
    "missing",
    "failed",
  ] as const)(
    "recovers %s compaction journal evidence without repeating native compaction",
    async (evidence) => {
      const now = new Date().toISOString();
      const threadId = ThreadId.makeUnsafe("thread-1");
      const turnId = asTurnId("persisted-native-compaction-turn");
      const startClaudeCompaction = vi.fn<
        NonNullable<ProviderServiceShape["startClaudeCompaction"]>
      >((input) => Effect.succeed(input));
      const harness = await createHarness({
        threadModelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
        startReactor: false,
        startClaudeCompaction,
        getClaudeCacheObservation: () =>
          Effect.succeed({
            ...expiredCacheObservation(),
            contextTokens: 16_000,
            state: "likely-warm",
            lastResponseAt: now,
          }),
      });
      const source = await dispatchHarnessUserTurn(harness, {
        messageId: "persisted-compaction-user",
        text: "Resume the saved original message",
        createdAt: now,
      });
      const review = {
        reviewId: "persisted-compaction-review",
        messageId: asMessageId("persisted-compaction-user"),
        sourceEventSequence: source.sequence,
        assessment: expiredCacheObservation(),
        status: "pending" as const,
        createdAt: now,
      };
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.claude-cache.set",
          commandId: CommandId.makeUnsafe("cmd-seed-compaction-review"),
          threadId,
          review,
          expectedReviewId: null,
          createdAt: now,
        }),
      );
      const compactResponse = await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.claude-cache.respond",
          commandId: CommandId.makeUnsafe("cmd-seed-compact-response"),
          threadId,
          reviewId: review.reviewId,
          messageId: review.messageId,
          decision: "compact",
          createdAt: now,
        }),
      );
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.claude-cache.set",
          commandId: CommandId.makeUnsafe("cmd-seed-compacting"),
          threadId,
          review: {
            ...review,
            status:
              evidence === "failed-recovery-interrupted"
                ? "failed"
                : evidence === "confirmed-after-reconciliation" ||
                    evidence === "uncertain-missing" ||
                    evidence.startsWith("cancelled-")
                  ? "uncertain"
                  : "compacting",
            compactionTurnId: turnId,
            compactionResponseEventSequence: compactResponse.sequence,
          },
          expectedReviewId: review.reviewId,
          createdAt: now,
        }),
      );
      for (const eventSequence of [source.sequence, compactResponse.sequence]) {
        await Effect.runPromise(
          harness.deliveryRepository.claim({
            consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
            eventSequence,
            threadId,
            claimOwner: "previous-process",
            claimedAt: now,
            claimExpiresAt: now,
          }),
        );
        await Effect.runPromise(
          (evidence === "uncertain-missing" ||
            evidence === "failed-recovery-interrupted" ||
            evidence.startsWith("cancelled-")) &&
            eventSequence === compactResponse.sequence
            ? harness.deliveryRepository.markTerminalFailure({
                consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
                eventSequence,
                expectedClaimOwner: "previous-process",
                state: "uncertain",
                error: "Lost native compaction acknowledgement",
                updatedAt: now,
              })
            : harness.deliveryRepository.complete({
                consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
                eventSequence,
                claimOwner: "previous-process",
                completedAt: now,
              }),
        );
      }
      let uncertainUserDeliverySequence: number | undefined;
      if (evidence === "uncertain-user-delivery") {
        const continued = await Effect.runPromise(
          harness.engine.dispatch({
            type: "thread.claude-cache.compacted",
            commandId: CommandId.makeUnsafe("cmd-previous-compact-release"),
            threadId,
            reviewId: review.reviewId,
            turnId,
            createdAt: now,
          }),
        );
        uncertainUserDeliverySequence = continued.sequence;
        await Effect.runPromise(
          harness.deliveryRepository.claim({
            consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
            eventSequence: continued.sequence,
            threadId,
            claimOwner: "previous-process",
            claimedAt: now,
            claimExpiresAt: now,
          }),
        );
        await Effect.runPromise(
          harness.deliveryRepository.markTerminalFailure({
            consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
            eventSequence: continued.sequence,
            expectedClaimOwner: "previous-process",
            state: "uncertain",
            error: "Lost user message acknowledgement",
            updatedAt: now,
          }),
        );
        await Effect.runPromise(
          harness.engine.dispatch({
            type: "thread.claude-cache.set",
            commandId: CommandId.makeUnsafe("cmd-uncertain-user-delivery"),
            threadId,
            review: {
              ...review,
              status: "uncertain",
              compactionTurnId: turnId,
              compactionResponseEventSequence: compactResponse.sequence,
            },
            expectedReviewId: review.reviewId,
            createdAt: now,
          }),
        );
      }
      let terminalSequence: number | undefined;
      if (
        evidence !== "missing" &&
        evidence !== "cancelled-missing" &&
        evidence !== "uncertain-missing" &&
        evidence !== "failed-recovery-interrupted" &&
        evidence !== "uncertain-user-delivery"
      ) {
        const terminal = await Effect.runPromise(
          harness.runtimeEventRepository.append({
            eventId: asEventId("journal-cache-compaction-terminal"),
            provider: "claudeAgent",
            threadId,
            createdAt: now,
            turnId,
            providerRefs: {},
            type: "turn.completed",
            payload: {
              state: evidence === "failed" ? "failed" : "completed",
              contextCompacted: true,
            },
          } as ProviderRuntimeEvent),
        );
        terminalSequence = terminal.sequence;
        if (evidence !== "confirmed-unacknowledged") {
          await Effect.runPromise(
            harness.runtimeEventRepository.advanceConsumerCursor({
              consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
              eventSequence: terminal.sequence,
              updatedAt: now,
            }),
          );
        }
      }

      if (evidence === "confirmed-invariant-failure") {
        const nextThreadId = ThreadId.makeUnsafe("thread-2");
        const nextTurnId = asTurnId("next-native-compaction-turn");
        await Effect.runPromise(
          harness.engine.dispatch({
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-next-cache-thread"),
            threadId: nextThreadId,
            projectId: asProjectId("project-1"),
            title: "Next recovered task",
            modelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "approval-required",
            branch: null,
            worktreePath: null,
            createdAt: now,
          }),
        );
        const nextSource = await Effect.runPromise(
          harness.engine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.makeUnsafe("cmd-next-cache-message"),
            threadId: nextThreadId,
            message: {
              messageId: asMessageId("next-cache-message"),
              role: "user",
              text: "Continue the unaffected task",
              attachments: [],
            },
            runtimeMode: "approval-required",
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            createdAt: now,
          }),
        );
        await Effect.runPromise(
          harness.engine.dispatch({
            type: "thread.claude-cache.set",
            commandId: CommandId.makeUnsafe("cmd-next-cache-review"),
            threadId: nextThreadId,
            review: {
              ...review,
              reviewId: "next-cache-review",
              messageId: asMessageId("next-cache-message"),
              sourceEventSequence: nextSource.sequence,
              status: "compacting",
              compactionTurnId: nextTurnId,
            },
            expectedReviewId: null,
            createdAt: now,
          }),
        );
        const nextTerminal = await Effect.runPromise(
          harness.runtimeEventRepository.append({
            eventId: asEventId("next-cache-terminal"),
            provider: "claudeAgent",
            threadId: nextThreadId,
            createdAt: now,
            turnId: nextTurnId,
            providerRefs: {},
            type: "turn.completed",
            payload: { state: "completed", contextCompacted: true },
          } as ProviderRuntimeEvent),
        );
        await Effect.runPromise(
          harness.runtimeEventRepository.advanceConsumerCursor({
            consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
            eventSequence: nextTerminal.sequence,
            updatedAt: now,
          }),
        );
      }
      if (
        evidence.startsWith("confirmed-") &&
        [
          "confirmed-invariant-failure",
          "confirmed-infrastructure-defect",
          "confirmed-recovery-interrupted",
        ].includes(evidence)
      ) {
        harness.interceptEngineDispatch((command) => {
          if (command.type !== "thread.claude-cache.compacted" || command.threadId !== threadId)
            return undefined;
          if (evidence === "confirmed-infrastructure-defect")
            return Effect.die(new Error("Simulated recovery infrastructure defect"));
          if (evidence === "confirmed-recovery-interrupted") return Effect.interrupt;
          return Effect.fail(
            new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "Simulated per-thread recovery invariant failure",
            }),
          );
        });
      }
      if (
        evidence === "confirmed-infrastructure-defect" ||
        evidence === "confirmed-recovery-interrupted"
      ) {
        await expect(harness.startReactor()).rejects.toThrow();
        expect(harness.sendTurn).not.toHaveBeenCalled();
        return;
      }
      if (evidence.startsWith("cancelled-")) {
        await Effect.runPromise(
          harness.engine.dispatch({
            type: "thread.session.stop",
            commandId: CommandId.makeUnsafe("cancel-before-recovery"),
            threadId,
            createdAt: now,
          }),
        );
        await dispatchHarnessUserTurn(harness, {
          messageId: "blocked-before-startup-recovery",
          text: "Do not replay this blocked send at startup",
          createdAt: now,
        });
      }
      await harness.startReactor();
      await harness.drain();

      expect(startClaudeCompaction).not.toHaveBeenCalled();
      if (evidence.startsWith("cancelled-")) {
        expect(harness.sendTurn).not.toHaveBeenCalled();
        expect((await readHarnessThread(harness))?.claudeCacheReview).toBeNull();
        expect(
          await Effect.runPromise(harness.reactor.listBlockingDeliveries({ threadId, limit: 10 })),
        ).toEqual([]);
        return;
      }
      if (evidence === "uncertain-user-delivery") {
        expect(harness.sendTurn).not.toHaveBeenCalled();
        expect((await readHarnessThread(harness))?.claudeCacheReview?.status).toBe("uncertain");
        expect(
          await Effect.runPromise(harness.reactor.listBlockingDeliveries({ threadId, limit: 10 })),
        ).toMatchObject([{ eventSequence: uncertainUserDeliverySequence, state: "uncertain" }]);
        return;
      }
      if (evidence === "confirmed-invariant-failure") {
        await waitFor(() => harness.sendTurn.mock.calls.length === 1);
        expect((await readHarnessThread(harness))?.claudeCacheReview).toMatchObject({
          status: "failed",
          error: "Simulated per-thread recovery invariant failure",
        });
        expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
          threadId: "thread-2",
          input: "Continue the unaffected task",
        });
        return;
      }
      if (evidence === "confirmed-unacknowledged") {
        expect(harness.sendTurn).not.toHaveBeenCalled();
        expect((await readHarnessThread(harness))?.claudeCacheReview?.status).toBe("compacting");
        await Effect.runPromise(
          harness.runtimeEventRepository.advanceConsumerCursor({
            consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
            eventSequence: terminalSequence!,
            updatedAt: new Date().toISOString(),
          }),
        );
      }
      if (
        evidence === "confirmed" ||
        evidence === "confirmed-after-reconciliation" ||
        evidence === "confirmed-unacknowledged"
      ) {
        await waitFor(() => harness.sendTurn.mock.calls.length === 1);

        await waitFor(async () => (await readHarnessThread(harness))?.claudeCacheReview === null);
        expect(harness.sendTurn.mock.calls[0]?.[0].input).toBe("Resume the saved original message");
        expect((await readHarnessThread(harness))?.claudeCacheReview).toBeNull();
      } else {
        expect(harness.sendTurn).not.toHaveBeenCalled();
        expect((await readHarnessThread(harness))?.claudeCacheReview?.status).toBe("failed");
        if (evidence === "uncertain-missing" || evidence === "failed-recovery-interrupted") {
          expect(
            await Effect.runPromise(
              harness.reactor.listBlockingDeliveries({ threadId, limit: 10 }),
            ),
          ).toEqual([]);
          const failedReview = (await readHarnessThread(harness))!.claudeCacheReview!;
          await respondToReview(harness, failedReview, "continue");
          await harness.drain();
          expect(harness.sendTurn).toHaveBeenCalledTimes(1);
          expect(harness.sendTurn.mock.calls[0]?.[0].input).toBe(
            "Resume the saved original message",
          );
          expect(startClaudeCompaction).not.toHaveBeenCalled();
        }
      }
    },
  );
});
