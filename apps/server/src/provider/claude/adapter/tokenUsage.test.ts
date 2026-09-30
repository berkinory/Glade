import { describe, it, assert } from "@effect/vitest";
import { Effect, Stream, Fiber, Random } from "effect";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter.ts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  makeHarness,
  THREAD_ID,
  emitSuccessResult,
  makeDeterministicRandomService,
  makeMultiQueryHarness,
  emitAssistantUsage,
} from "./adapterTestFixtures";

describe("Claude tokenUsage", () => {
  it.effect("reconciles Claude request accounting at turn completion", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      const collectTurn = () =>
        adapter.streamEvents.pipe(
          Stream.takeUntil((event) => event.type === "turn.completed"),
          Stream.runCollect,
          Effect.forkChild,
        );
      const observed = yield* collectTurn();
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "first", attachments: [] });
      const emitBlock = (uuid: string, output: number, id = "request-1") => {
        harness.query.emit({
          type: "assistant",
          session_id: "sdk-block-accounting",
          uuid,
          parent_tool_use_id: null,
          request_id: id,
          message: {
            id,
            content: [{ type: "text", text: uuid }],
            usage: {
              input_tokens: 32,
              cache_creation_input_tokens: 419,
              cache_read_input_tokens: 26_816,
              output_tokens: output,
            },
          },
        } as unknown as SDKMessage);
      };
      emitBlock("thinking-block", 59);
      emitBlock("text-block", 59);
      emitBlock("text-block", 59);
      emitBlock("later-output", 100);
      emitBlock("distinct-request", 59, "request-2");
      emitSuccessResult(harness.query, "sdk-block-accounting", "result-1", {
        total_tokens: 54_700,
      });
      const events = Array.from(yield* Fiber.join(observed));
      assert.equal(
        events.find((event) => event.type === "turn.completed")?.payload.mainLoopTokens,
        54_700,
      );

      const next = yield* collectTurn();
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "second", attachments: [] });
      emitBlock("next-request", 59, "request-3");
      emitSuccessResult(harness.query, "sdk-block-accounting", "result-2", {
        total_tokens: 27_320,
      });
      const nextEvents = Array.from(yield* Fiber.join(next));
      assert.equal(
        nextEvents.find((event) => event.type === "turn.completed")?.payload.mainLoopTokens,
        27_320,
      );
      const zero = yield* collectTurn();
      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "zero-usage command",
        attachments: [],
      });
      emitBlock("synthetic-output", 0, "request-4");
      emitSuccessResult(harness.query, "sdk-block-accounting", "result-zero", {
        input_tokens: 0,
        output_tokens: 0,
      });
      const zeroEvents = Array.from(yield* Fiber.join(zero));
      assert.equal(
        zeroEvents.find((event) => event.type === "turn.completed")?.payload.mainLoopTokens,
        0,
      );
      assert.equal(
        ((yield* adapter.listSessions())[0]?.resumeCursor as { processedTokenTotal?: number })
          ?.processedTokenTotal,
        82_020,
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect(
    "keeps request accounting across interruption, late delivery, clear, and resume",
    () => {
      const harness = makeMultiQueryHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const start = {
          threadId: THREAD_ID,
          provider: "claudeAgent" as const,
          runtimeMode: "full-access" as const,
        };
        yield* adapter.startSession(start);
        let query = harness.queries[0]!;
        const collect = () =>
          adapter.streamEvents.pipe(
            Stream.takeUntil((event) => event.type === "turn.completed"),
            Stream.runCollect,
            Effect.forkChild,
          );
        const first = yield* collect();
        yield* adapter.sendTurn({ threadId: THREAD_ID, input: "first", attachments: [] });
        emitAssistantUsage(
          query,
          "sdk-lifecycle",
          "block-1",
          "partial",
          { input_tokens: 100 },
          "call-1",
        );
        emitAssistantUsage(
          query,
          "sdk-lifecycle",
          "block-2",
          "partial",
          { input_tokens: 100 },
          "call-1",
        );
        yield* adapter.interruptTurn(THREAD_ID);
        const failed = {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          errors: ["interrupted"],
          session_id: "sdk-lifecycle",
          uuid: "failed-result",
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
          total_cost_usd: 0,
        } as unknown as SDKMessage;
        query.emit(failed);
        const firstEvents = Array.from(yield* Fiber.join(first));
        assert.equal(
          firstEvents.find((event) => event.type === "turn.completed")?.payload.mainLoopTokens,
          100,
        );
        assert.equal(
          firstEvents.find((event) => event.type === "turn.completed")?.payload.state,
          "interrupted",
        );

        const next = yield* collect();
        yield* adapter.sendTurn({ threadId: THREAD_ID, input: "next", attachments: [] });
        query.emit(failed);
        emitAssistantUsage(
          query,
          "sdk-lifecycle",
          "late-block",
          "tail",
          { input_tokens: 100 },
          "call-1",
        );
        emitAssistantUsage(
          query,
          "sdk-lifecycle",
          "new-block",
          "next",
          { input_tokens: 20 },
          "call-2",
        );
        emitSuccessResult(query, "sdk-lifecycle", "next-result", { input_tokens: 20 });
        const nextEvents = Array.from(yield* Fiber.join(next));
        assert.equal(
          nextEvents.find((event) => event.type === "turn.completed")?.payload.mainLoopTokens,
          20,
        );

        const cleared = yield* collect();
        yield* adapter.sendTurn({ threadId: THREAD_ID, input: "/clear", attachments: [] });
        query.emit({
          type: "conversation_reset",
          new_conversation_id: "new-lifecycle",
          session_id: "sdk-lifecycle",
          uuid: "clear",
        } as unknown as SDKMessage);
        emitAssistantUsage(
          query,
          "new-lifecycle",
          "after-clear",
          "cleared",
          { input_tokens: 20 },
          "call-2",
        );
        emitSuccessResult(query, "new-lifecycle", "clear-result", { input_tokens: 20 });
        yield* Fiber.join(cleared);
        const resumeCursor = (yield* adapter.listSessions())[0]!.resumeCursor;
        assert.equal((resumeCursor as { processedTokenTotal?: number }).processedTokenTotal, 140);
        yield* adapter.stopSession(THREAD_ID);
        yield* adapter.startSession({ ...start, resumeCursor });
        query = harness.queries[1]!;
        const resumed = yield* collect();
        yield* adapter.sendTurn({ threadId: THREAD_ID, input: "resumed", attachments: [] });
        emitAssistantUsage(query, "new-lifecycle", "resumed-block", "resumed", {
          input_tokens: 10,
        });
        emitSuccessResult(query, "new-lifecycle", "resumed-result", { input_tokens: 10 });
        const events = Array.from(yield* Fiber.join(resumed));
        assert.equal(
          events.find((event) => event.type === "turn.completed")?.payload.mainLoopTokens,
          10,
        );
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect("resumes cumulative token accounting from the durable cursor", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const completed = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
        resumeCursor: {
          threadId: THREAD_ID,
          processedTokenTotal: 350_000,
          tokenAccountingVersion: 1,
        },
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "continue",
        attachments: [],
      });
      emitAssistantUsage(
        harness.query,
        "sdk-session-resumed-accounting",
        "assistant-resumed-accounting",
        "Fresh response",
        { input_tokens: 1, cache_read_input_tokens: 19_999, output_tokens: 0 },
      );
      emitSuccessResult(
        harness.query,
        "sdk-session-resumed-accounting",
        "result-resumed-accounting",
        { total_tokens: 50_000 },
      );

      const events = Array.from(yield* Fiber.join(completed));
      assert.equal(
        events.find((event) => event.type === "turn.completed")?.payload.mainLoopTokens,
        50_000,
      );
      assert.equal(
        ((yield* adapter.listSessions())[0]?.resumeCursor as { processedTokenTotal?: number })
          ?.processedTokenTotal,
        400_000,
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });
});
