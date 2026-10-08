import { describe, it, assert } from "@effect/vitest";
import { Effect, Random, Stream, Fiber, Exit } from "effect";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter.ts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  makeHarness,
  RESUME_THREAD_ID,
  makeDeterministicRandomService,
  makeMultiQueryHarness,
  THREAD_ID,
} from "./adapterTestFixtures";

describe("Claude sessionHistory", () => {
  it.effect("passes Claude resume ids without pinning a stale assistant checkpoint", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: RESUME_THREAD_ID,
        provider: "claudeAgent",
        resumeCursor: {
          threadId: "resume-thread-1",
          resume: "550e8400-e29b-41d4-a716-446655440000",
          resumeSessionAt: "assistant-99",
          turnCount: 3,
        },
        runtimeMode: "full-access",
      });

      assert.equal(session.threadId, RESUME_THREAD_ID);
      assert.deepEqual(session.resumeCursor, {
        threadId: RESUME_THREAD_ID,
        resume: "550e8400-e29b-41d4-a716-446655440000",
        resumeSessionAt: "assistant-99",
        turnCount: 3,
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.equal(createInput?.options.resume, "550e8400-e29b-41d4-a716-446655440000");
      assert.equal(createInput?.options.sessionId, undefined);
      assert.equal(createInput?.options.resumeSessionAt, undefined);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("keeps a generated session id unresumable until Claude records output", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const readResume = Effect.map(
        adapter.listSessions(),
        (sessions) =>
          (sessions[0]?.resumeCursor as { readonly resume?: string } | undefined)?.resume,
      );
      const awaitResume = Effect.gen(function* () {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const resume = yield* readResume;
          if (resume !== undefined) return resume;
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)));
        }
        return undefined;
      });

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      const generatedSessionId = harness.getLastCreateQueryInput()?.options.sessionId;
      assert.isString(generatedSessionId);
      assert.equal(adapter.canResumeNativeConversation?.(session.resumeCursor), false);

      yield* adapter.sendTurn({ threadId: session.threadId, input: "hello", attachments: [] });
      harness.query.emit({
        type: "stream_event",
        session_id: generatedSessionId,
        uuid: "fresh-stream",
        parent_tool_use_id: null,
        event: { type: "message_start", message: { id: "msg-fresh" } },
      } as unknown as SDKMessage);
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 50)));
      assert.equal(yield* readResume, undefined);

      harness.query.emit({
        type: "assistant",
        session_id: generatedSessionId,
        uuid: "fresh-assistant",
        parent_tool_use_id: null,
        message: {
          id: "msg-fresh",
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
        },
      } as unknown as SDKMessage);
      assert.equal(yield* awaitResume, generatedSessionId);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("preserves durable resume ids across Claude resume hooks", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const durableSessionId = "550e8400-e29b-41d4-a716-446655440000";
      const transientHookSessionId = "7368d0c7-40a3-4d8a-bcc1-ac80c49f2719";

      const threadStartedFiber = yield* Stream.filter(
        adapter.streamEvents,
        (event) => event.type === "thread.started",
      ).pipe(Stream.runHead, Effect.forkChild);

      const session = yield* adapter.startSession({
        threadId: RESUME_THREAD_ID,
        provider: "claudeAgent",
        resumeCursor: {
          threadId: RESUME_THREAD_ID,
          resume: durableSessionId,
          resumeSessionAt: "assistant-99",
          turnCount: 3,
        },
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "continue",
        attachments: [],
      });

      harness.query.emit({
        type: "system",
        subtype: "hook_started",
        hook_id: "resume-hook-1",
        hook_name: "SessionStart:resume",
        hook_event: "SessionStart",
        session_id: transientHookSessionId,
        uuid: "resume-hook-started",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "system",
        subtype: "hook_response",
        hook_id: "resume-hook-1",
        hook_name: "SessionStart:resume",
        hook_event: "SessionStart",
        output: "",
        stdout: "",
        stderr: "",
        outcome: "success",
        session_id: transientHookSessionId,
        uuid: "resume-hook-response",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: durableSessionId,
        uuid: "resume-stream-durable",
        parent_tool_use_id: null,
        event: {
          type: "message_start",
          message: {
            id: "msg-resume-durable",
          },
        },
      } as unknown as SDKMessage);

      const threadStarted = yield* Fiber.join(threadStartedFiber);
      assert.equal(threadStarted._tag, "Some");
      if (threadStarted._tag === "Some" && threadStarted.value.type === "thread.started") {
        const rawPayload =
          threadStarted.value.raw?.payload &&
          typeof threadStarted.value.raw.payload === "object" &&
          "session_id" in threadStarted.value.raw.payload
            ? threadStarted.value.raw.payload.session_id
            : undefined;
        assert.equal(threadStarted.value.payload?.providerThreadId ?? rawPayload, durableSessionId);
      }

      const activeSessions = yield* adapter.listSessions();
      const resumeCursor = activeSessions[0]?.resumeCursor as
        | {
            readonly resume?: string;
          }
        | undefined;
      assert.equal(resumeCursor?.resume, durableSessionId);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect(
    "rewinds Claude through the native parent including hidden tool output, then resumes it",
    () => {
      const forks: unknown[] = [];
      const deleted: string[] = [];
      const harness = makeMultiQueryHarness({
        nativeHistory: {
          deleteNativeSession: async (sessionId) => {
            assert.equal(
              harness.createInputs[1]?.options.resume,
              "24dbd86f-55d1-4de2-8138-7d7bd04563c5",
            );
            deleted.push(sessionId);
          },
          readNativeSessionMessages: async () => [
            {
              type: "user",
              uuid: "kept-user",
              message: { content: "remember 42" },
              session_id: "9b37f02e-489d-4454-9f76-67a571840245",
              parent_tool_use_id: null,
              parent_agent_id: null,
            },
            {
              type: "assistant",
              uuid: "kept-assistant",
              message: { content: [{ type: "tool_use" }] },
              session_id: "9b37f02e-489d-4454-9f76-67a571840245",
              parent_tool_use_id: null,
              parent_agent_id: null,
            },
            {
              type: "user",
              uuid: "tool-result",
              message: { content: [{ type: "tool_result" }] },
              session_id: "9b37f02e-489d-4454-9f76-67a571840245",
              parent_tool_use_id: null,
              parent_agent_id: null,
            },
            {
              type: "user",
              uuid: "edited-user",
              message: { content: "discard this" },
              session_id: "9b37f02e-489d-4454-9f76-67a571840245",
              parent_tool_use_id: null,
              parent_agent_id: null,
            },
          ],
          readNativeMessageParent: async ({ messageId }) => {
            assert.equal(messageId, "edited-user");
            return "structured-output-after-tool-result";
          },
          forkNativeSession: async (sessionId, options) => {
            forks.push({ sessionId, options });
            return { sessionId: "24dbd86f-55d1-4de2-8138-7d7bd04563c5" };
          },
        },
      });
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "full-access",
          resumeCursor: { resume: "9b37f02e-489d-4454-9f76-67a571840245" },
        });
        yield* adapter.rollbackThread(THREAD_ID, 1);
        assert.deepEqual(deleted, ["9b37f02e-489d-4454-9f76-67a571840245"]);
        assert.deepEqual(forks, [
          {
            sessionId: "9b37f02e-489d-4454-9f76-67a571840245",
            options: { upToMessageId: "structured-output-after-tool-result" },
          },
        ]);
        assert.equal(
          harness.createInputs[1]?.options.resume,
          "24dbd86f-55d1-4de2-8138-7d7bd04563c5",
        );
        const sessions = yield* adapter.listSessions();
        assert.equal(
          (sessions[0]!.resumeCursor as { resume: string }).resume,
          "24dbd86f-55d1-4de2-8138-7d7bd04563c5",
        );
        const turn = yield* adapter.sendTurn({ threadId: THREAD_ID, input: "edited prompt" });
        assert.ok(turn.turnId);
        assert.equal(harness.queries.length, 2);
      }).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect(
    "refuses to edit when native history is unavailable instead of trimming only local turns",
    () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;

        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "full-access",
        });

        const firstTurn = yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "first",
          attachments: [],
        });

        const firstCompletedFiber = yield* Stream.filter(
          adapter.streamEvents,
          (event) => event.type === "turn.completed",
        ).pipe(Stream.runHead, Effect.forkChild);

        harness.query.emit({
          type: "result",
          subtype: "success",
          is_error: false,
          errors: [],
          session_id: "sdk-session-rollback",
          uuid: "result-first",
        } as unknown as SDKMessage);

        const firstCompleted = yield* Fiber.join(firstCompletedFiber);
        assert.equal(firstCompleted._tag, "Some");
        if (firstCompleted._tag === "Some" && firstCompleted.value.type === "turn.completed") {
          assert.equal(String(firstCompleted.value.turnId), String(firstTurn.turnId));
        }

        const secondTurn = yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "second",
          attachments: [],
        });

        const secondCompletedFiber = yield* Stream.filter(
          adapter.streamEvents,
          (event) => event.type === "turn.completed",
        ).pipe(Stream.runHead, Effect.forkChild);

        harness.query.emit({
          type: "result",
          subtype: "success",
          is_error: false,
          errors: [],
          session_id: "sdk-session-rollback",
          uuid: "result-second",
        } as unknown as SDKMessage);

        const secondCompleted = yield* Fiber.join(secondCompletedFiber);
        assert.equal(secondCompleted._tag, "Some");
        if (secondCompleted._tag === "Some" && secondCompleted.value.type === "turn.completed") {
          assert.equal(String(secondCompleted.value.turnId), String(secondTurn.turnId));
        }

        const threadBeforeRollback = yield* adapter.readThread(session.threadId);
        assert.equal(threadBeforeRollback.turns.length, 2);

        const rolledBack = yield* Effect.exit(adapter.rollbackThread(session.threadId, 1));
        assert.ok(Exit.isFailure(rolledBack));

        const threadAfterRollback = yield* adapter.readThread(session.threadId);
        assert.equal(threadAfterRollback.turns.length, 2);
        assert.equal(threadAfterRollback.turns[0]?.id, firstTurn.turnId);
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );
});
