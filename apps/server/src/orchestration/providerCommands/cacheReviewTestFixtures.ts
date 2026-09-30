import type { ReactorTestHarness } from "./reactorTestTypes";
import type { ClaudeCacheObservation } from "@glade/contracts/provider/claudeCache";
import { Effect } from "effect";
import { expect, vi } from "vitest";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { CommandId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { type ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { makeReactorTestHarness, waitFor, asEventId } from "./reactorTestFixtures";

export function makeCacheReviewTestFixtures(
  input: Pick<
    ReturnType<typeof makeReactorTestHarness>,
    "createHarness" | "dispatchHarnessUserTurn" | "readHarnessThread"
  >,
) {
  const { createHarness, dispatchHarnessUserTurn, readHarnessThread } = input;
  function expiredCacheObservation(): ClaudeCacheObservation {
    return {
      nativeSessionId: "native-claude-session-1",
      lifecycleGeneration: "generation-1",
      model: "claude-opus-4-6",
      observedAt: new Date().toISOString(),
      contextTokens: 120_000,
      lastResponseAt: new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString(),
      ttlSeconds: 3_600,
      state: "likely-expired",
      source: "request-usage",
    };
  }

  async function createCacheHarness(
    observation: () => ClaudeCacheObservation | undefined = expiredCacheObservation,
    startReactor = true,
  ): Promise<ReactorTestHarness> {
    return createHarness({
      threadModelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
      getClaudeCacheObservation: () => Effect.sync(observation),
      startReactor,
    });
  }

  async function sendHeldMessage(harness: Awaited<ReturnType<typeof createHarness>>) {
    await dispatchHarnessUserTurn(harness, {
      messageId: "cache-held-message",
      text: "Continue with this exact message",
      createdAt: new Date().toISOString(),
    });
    await waitFor(
      async () => (await readHarnessThread(harness))?.claudeCacheReview?.status === "pending",
    );
    await harness.drain();
    const review = (await readHarnessThread(harness))?.claudeCacheReview;
    expect(review).toBeTruthy();
    return review!;
  }

  async function respondToReview(
    harness: Awaited<ReturnType<typeof createHarness>>,
    review: NonNullable<Awaited<ReturnType<typeof readHarnessThread>>>["claudeCacheReview"],
    decision: "continue" | "compact" | "cancel",
    suffix: string = decision,
  ) {
    const command: OrchestrationCommand = {
      type: "thread.claude-cache.respond",
      commandId: CommandId.makeUnsafe(`cmd-cache-${suffix}`),
      threadId: ThreadId.makeUnsafe("thread-1"),
      reviewId: review!.reviewId,
      messageId: review!.messageId,
      decision,
      createdAt: new Date().toISOString(),
    };
    await Effect.runPromise(harness.engine.dispatch(command));
    await harness.drain();
    return command;
  }

  async function createCompactionHarness() {
    let observation = expiredCacheObservation();
    const startClaudeCompaction = vi.fn<NonNullable<ProviderServiceShape["startClaudeCompaction"]>>(
      ({ threadId, turnId }) => Effect.succeed({ threadId, turnId }),
    );
    const harness = await createHarness({
      threadModelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
      getClaudeCacheObservation: () => Effect.sync(() => observation),
      startClaudeCompaction,
    });
    return {
      harness,
      startClaudeCompaction,
      setObservation: (next: ClaudeCacheObservation) => {
        observation = next;
      },
    };
  }

  async function emitCompactionTerminal(
    harness: Awaited<ReturnType<typeof createHarness>>,
    turnId: TurnId,
    input: {
      readonly state: "completed" | "failed" | "cancelled" | "aborted";
      readonly contextCompacted?: boolean;
    },
    suffix: string = input.state,
  ) {
    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    const base = {
      eventId: asEventId(`evt-cache-compaction-${suffix}`),
      provider: "claudeAgent" as const,
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId,
      providerRefs: {},
    };
    await harness.emitRuntimeEvent(
      input.state === "aborted"
        ? { ...base, type: "turn.aborted", payload: { reason: "Compaction interrupted" } }
        : ({
            ...base,
            type: "turn.completed",
            payload: {
              state: input.state,
              ...(input.contextCompacted !== undefined
                ? { contextCompacted: input.contextCompacted }
                : {}),
            },
          } as ProviderRuntimeEvent),
    );
    await harness.drain();
  }
  return {
    expiredCacheObservation,
    createCacheHarness,
    sendHeldMessage,
    respondToReview,
    createCompactionHarness,
    emitCompactionTerminal,
  };
}
