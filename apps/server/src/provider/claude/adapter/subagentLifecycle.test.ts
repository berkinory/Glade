import { describe, it, assert } from "@effect/vitest";
import { Effect, Stream, Fiber, Random } from "effect";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter.ts";
import type { SDKMessage, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { TurnId } from "@glade/contracts/core/baseSchemas";
import {
  makeHarness,
  THREAD_ID,
  makeDeterministicRandomService,
  makeGatewayCredentialsHarness,
  makeMultiQueryHarness,
} from "./adapterTestFixtures";

describe("Claude subagentLifecycle", () => {
  it.effect("routes subagent-tagged messages to a child provider thread", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) =>
            event.type === "turn.completed" && event.providerRefs?.providerThreadId === undefined,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "delegate this",
        attachments: [],
      });

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-subagent",
        uuid: "stream-subagent-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-task-1",
            name: "Task",
            input: {
              description: "Review the database layer",
              prompt: "Audit the SQL changes",
              subagent_type: "code-reviewer",
            },
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "tool-task-1",
        subagent_type: "code-reviewer",
        description: "Review the database layer",
        session_id: "sdk-session-subagent",
        uuid: "task-started-1",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-subagent",
        uuid: "assistant-subagent-1",
        parent_tool_use_id: "tool-task-1",
        message: {
          id: "assistant-message-subagent-1",
          content: [{ type: "text", text: "Reviewing the migration now." }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-subagent",
        uuid: "assistant-subagent-block-2",
        parent_tool_use_id: "tool-task-1",
        message: {
          id: "assistant-message-subagent-1",
          content: [{ type: "text", text: "The migration looks correct." }],
          usage: { input_tokens: 10, output_tokens: 8 },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "tool_progress",
        tool_use_id: "tool-subagent-heartbeat-1",
        tool_name: "Grep",
        parent_tool_use_id: "tool-task-1",
        elapsed_time_seconds: 5,
        heartbeat: true,
        session_id: "sdk-session-subagent",
        uuid: "tool-progress-subagent-1",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "system",
        subtype: "task_progress",
        task_id: "task-1",
        tool_use_id: "tool-task-1",
        description: "Review the database layer",
        usage: { total_tokens: 123, tool_uses: 4, duration_ms: 987 },
        session_id: "sdk-session-subagent",
        uuid: "task-progress-subagent-1",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        tool_use_id: "tool-task-1",
        status: "completed",
        output_file: "/tmp/task-1-output.md",
        summary: "Reviewed the migration.",
        session_id: "sdk-session-subagent",
        uuid: "task-notification-1",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-subagent",
        uuid: "result-subagent-1",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const childEvents = runtimeEvents.filter(
        (event) => event.providerRefs?.providerThreadId === "tool-task-1",
      );
      assert.equal(
        childEvents.every((event) => event.providerRefs?.providerParentThreadId === THREAD_ID),
        true,
      );
      assert.equal(
        childEvents.some((event) => event.type === "turn.started"),
        true,
      );
      assert.equal(
        childEvents.some(
          (event) => event.type === "tool.progress" && event.payload.toolName === "Grep",
        ),
        true,
      );

      const collabStarted = runtimeEvents.find(
        (event) =>
          event.type === "item.started" && event.payload.itemType === "collab_agent_tool_call",
      );
      assert.equal(collabStarted?.type, "item.started");
      if (collabStarted?.type === "item.started") {
        const data = collabStarted.payload.data as Record<string, unknown>;
        assert.equal(data.receiverThreadId, "tool-task-1");
        assert.equal(data.agentType, "code-reviewer");
        assert.equal(data.nickname, "Review the database layer");
      }

      const textDeltas = runtimeEvents.filter(
        (event) =>
          event.type === "content.delta" && event.payload.delta.includes("Reviewing the migration"),
      );
      assert.equal(textDeltas.length > 0, true);
      assert.equal(
        textDeltas.every((event) => event.providerRefs?.providerThreadId === "tool-task-1"),
        true,
      );

      const childTurnCompleted = childEvents.find((event) => event.type === "turn.completed");
      assert.equal(childTurnCompleted?.type, "turn.completed");
      if (childTurnCompleted?.type === "turn.completed") {
        assert.equal(childTurnCompleted.payload.state, "completed");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("stops a targeted subagent task instead of interrupting the whole turn", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "task.started"),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      assert.equal(harness.getLastCreateQueryInput()?.options.forwardSubagentText, true);

      harness.query.emit({
        type: "system",
        subtype: "task_started",
        task_id: "task-stop-1",
        tool_use_id: "tool-task-stop-1",
        subagent_type: "code-reviewer",
        description: "Long-running review",
        session_id: "sdk-session-stop",
        uuid: "task-started-stop-1",
      } as unknown as SDKMessage);
      yield* Fiber.join(runtimeEventsFiber);

      yield* adapter.interruptTurn(session.threadId, undefined, "tool-task-stop-1");
      assert.deepEqual(harness.query.stopTaskCalls, ["task-stop-1"]);
      assert.equal(harness.query.interruptCalls.length, 0);
      assert.equal(harness.query.backgroundTasksCalls.length, 0);

      yield* adapter.interruptTurn(session.threadId, undefined, "tool-task-pending");
      assert.equal(harness.query.backgroundTasksCalls.length, 0);
      assert.deepEqual(harness.query.stopTaskCalls, ["task-stop-1"]);

      harness.query.emit({
        type: "system",
        subtype: "task_started",
        task_id: "task-pending-1",
        tool_use_id: "tool-task-pending",
        subagent_type: "code-reviewer",
        description: "Stopped before task_started",
        session_id: "sdk-session-stop",
        uuid: "task-started-pending-1",
      } as unknown as SDKMessage);

      for (let i = 0; i < 10_000 && harness.query.stopTaskCalls.length < 2; i += 1) {
        yield* Effect.yieldNow;
      }
      assert.deepEqual(harness.query.stopTaskCalls, ["task-stop-1", "task-pending-1"]);
      assert.equal(harness.query.backgroundTasksCalls.length, 0);
      assert.equal(harness.query.interruptCalls.length, 0);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect(
    "revokes the shared gateway on child stop and still routes an exact whole-turn interrupt",
    () => {
      let releaseGateway!: () => void;
      const gatewayBarrier = new Promise<void>((resolve) => {
        releaseGateway = resolve;
      });
      const gateway = makeGatewayCredentialsHarness({
        cancelSessionTurnRequests: () => gatewayBarrier,
      });
      const harness = makeMultiQueryHarness({ gatewayCredentials: gateway.credentials });

      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "full-access",
        });
        const turn = yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "wait in the visible browser",
          attachments: [],
        });
        const query = harness.queries[0]!;

        const childStopFiber = yield* adapter
          .interruptTurn(session.threadId, undefined, "tool-task-pending")
          .pipe(Effect.forkChild);
        for (let i = 0; i < 10_000 && gateway.cancelledTurns.length === 0; i += 1) {
          yield* Effect.yieldNow;
        }
        assert.deepEqual(gateway.cancelledTurns, [
          { token: "gateway-token-1", turnId: turn.turnId },
        ]);
        assert.equal(childStopFiber.pollUnsafe(), undefined);
        assert.equal(query.interruptCalls.length, 0);

        releaseGateway();
        yield* Fiber.join(childStopFiber);
        assert.deepEqual(gateway.revokedTokens, ["gateway-token-1"]);

        yield* adapter.interruptTurn(session.threadId, TurnId.makeUnsafe("stale-turn"));
        assert.equal(gateway.cancelledTurns.length, 1);
        assert.equal(query.interruptCalls.length, 0);

        const interruptFiber = yield* adapter
          .interruptTurn(session.threadId, turn.turnId)
          .pipe(Effect.forkChild);
        for (let i = 0; i < 10_000 && query.interruptCalls.length === 0; i += 1) {
          yield* Effect.yieldNow;
        }
        assert.deepEqual(gateway.cancelledTurns, [
          { token: "gateway-token-1", turnId: turn.turnId },
        ]);
        assert.equal(query.interruptCalls.length, 1);
        yield* Fiber.join(interruptFiber);
        assert.deepEqual(gateway.revokedTokens, ["gateway-token-1"]);
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect("delivers queued subagent steers through the PreToolUse hook", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.steered"),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      const hook = harness.getLastCreateQueryInput()?.options.hooks?.PreToolUse?.[0]?.hooks[0];
      assert.isDefined(hook);
      const invokeHook = (agentId: string | undefined) =>
        Effect.promise(() =>
          hook!(
            {
              hook_event_name: "PreToolUse",
              tool_name: "Read",
              tool_input: {},
              tool_use_id: "tool-read-1",
              session_id: "sdk-session-steer",
              transcript_path: "/tmp/transcript",
              cwd: "/tmp",
              ...(agentId ? { agent_id: agentId } : {}),
            } as HookInput,
            "tool-read-1",
            { signal: new AbortController().signal },
          ),
        );

      harness.query.emit({
        type: "system",
        subtype: "task_started",
        task_id: "task-steer-1",
        tool_use_id: "tool-task-steer-1",
        subagent_type: "worker-high",
        description: "Long-running task",
        session_id: "sdk-session-steer",
        uuid: "task-started-steer-1",
      } as unknown as SDKMessage);

      assert.deepEqual(yield* invokeHook("task-steer-1"), {});

      yield* adapter.steerSubagent(session.threadId, "tool-task-steer-1", {
        input: "Focus on the tests",
      });

      // Main-thread hook calls carry no agent_id and must never drain the queue.
      assert.deepEqual(yield* invokeHook(undefined), {});

      const delivered = yield* invokeHook("task-steer-1");
      assert.deepEqual(delivered, {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext:
            "The user sent you a message mid-task: Focus on the tests. Address it and adjust your work accordingly.",
        },
      });

      assert.deepEqual(yield* invokeHook("task-steer-1"), {});

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const steered = runtimeEvents.find((event) => event.type === "turn.steered");
      assert.equal(steered?.type, "turn.steered");
      if (steered?.type === "turn.steered") {
        assert.equal(steered.payload.message, "Focus on the tests");
        assert.equal(steered.providerRefs?.providerThreadId, "tool-task-steer-1");
        assert.equal(steered.providerRefs?.providerParentThreadId, THREAD_ID);
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });
});
