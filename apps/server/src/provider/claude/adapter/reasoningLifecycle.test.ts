import { describe, it, assert } from "@effect/vitest";
import { Effect, Stream, Fiber } from "effect";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter";
import { makeHarness, THREAD_ID } from "./adapterTestFixtures";

describe("Claude reasoning lifecycle", () => {
  it.effect("keeps message identities, reconciles snapshots and fences interrupted history", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const collected = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "auth.status"),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "hello", attachments: [] });
      const emit = (message: unknown) => harness.query.emit(message as SDKMessage);
      const envelope = { session_id: "reasoning-session", parent_tool_use_id: null };
      const stream = (uuid: string, event: unknown) =>
        emit({ ...envelope, type: "stream_event", uuid, event } as SDKMessage);
      const snapshot = (id: string, text: string, uuid = id) =>
        emit({
          ...envelope,
          type: "assistant",
          uuid,
          message: {
            id,
            role: "assistant",
            content: [{ type: "thinking", thinking: text, signature: "" }],
          },
        });
      for (const id of ["message-a", "message-b"]) {
        stream(`${id}-start`, { type: "message_start", message: { id } });
        stream(`${id}-delta`, {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: id },
        });
        stream(`${id}-stop`, { type: "content_block_stop", index: 0 });
        snapshot(id, `${id} complete`);
        snapshot(id, `${id} complete`, `${id}-duplicate`);
      }
      stream("message-c-start", { type: "message_start", message: { id: "message-c" } });
      stream("message-c-delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "unfinished" },
      });
      yield* adapter.interruptTurn(session.threadId);
      emit({
        ...envelope,
        type: "result",
        uuid: "interrupted-result",
        subtype: "error_during_execution",
        errors: ["Interrupted"],
        is_error: true,
      });
      snapshot("message-c", "late text must not reopen work");
      emit({
        ...envelope,
        type: "auth_status",
        uuid: "auth-marker",
        isAuthenticating: false,
        output: ["https://signin.example/?token=fixture-secret"],
        error: "apiKey=fixture-secret",
      });
      const events = [...(yield* Fiber.join(collected))];
      const completed = events
        .filter((event) => event.type === "item.completed")
        .filter((event) => event.payload.itemType === "reasoning");
      assert.equal(new Set(completed.map((event) => event.itemId)).size, 3);
      for (const id of ["message-a", "message-b"]) {
        const matches = completed.filter((event) => String(event.itemId).includes(id));
        assert.equal(matches.length, 2);
        assert.equal(matches.at(-1)?.payload.detail, `${id} complete`);
      }
      assert.equal(completed.at(-1)?.payload.status, "declined");
      assert.equal(events.filter((event) => event.type === "turn.started").length, 1);
      const auth = events.at(-1)!;
      assert.equal(JSON.stringify(auth).includes("fixture-secret"), false);
    }).pipe(Effect.provide(harness.layer));
  });
});
