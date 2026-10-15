import { describe, it, assert } from "@effect/vitest";
import { Effect, Exit, Stream, Fiber, Random, Schema } from "effect";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter.ts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { TurnId } from "@glade/contracts/core/baseSchemas";
import { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
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

  it.effect("trims task strings so SDK descriptions ending in a newline stay journalable", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter(
          (event) =>
            (event.type === "task.started" ||
              event.type === "task.progress" ||
              event.type === "task.updated") &&
            event.payload.taskId === "bash-untrimmed",
        ),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      const common = { type: "system", task_id: "bash-untrimmed", session_id: "sdk-untrimmed" };
      harness.query.emit({
        ...common,
        subtype: "task_started",
        tool_use_id: "toolu-bash-untrimmed",
        task_type: "local_bash",
        description: "bun run test\n",
        uuid: "untrimmed-started",
      } as unknown as SDKMessage);
      harness.query.emit({
        ...common,
        subtype: "task_progress",
        description: "  bun run test \n",
        last_tool_name: "Bash ",
        uuid: "untrimmed-progress",
      } as unknown as SDKMessage);
      harness.query.emit({
        ...common,
        subtype: "task_updated",
        patch: { status: "failed", error: "exit code 1\n" },
        uuid: "untrimmed-updated",
      } as unknown as SDKMessage);

      const events = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        events.map((event) => event.type),
        ["task.started", "task.progress", "task.updated"],
      );
      for (const event of events) {
        const encoded = yield* Schema.encodeEffect(ProviderRuntimeEvent)(event).pipe(Effect.exit);
        assert.isTrue(Exit.isSuccess(encoded), `${event.type} must encode`);
      }
      const [started, progress, updated] = events;
      assert.include(started?.payload, { description: "bun run test" });
      assert.include(progress?.payload, { description: "bun run test", lastToolName: "Bash" });
      assert.include(updated?.payload, { error: "exit code 1" });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("reports a foreground subagent interrupted with its parent as stopped", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const toolCompleted = yield* adapter.streamEvents.pipe(
        Stream.filter(
          (event) => event.type === "item.completed" && event.itemId === "tool-task-interrupted",
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "delegate", attachments: [] });
      const envelope = { session_id: "sdk-session-interrupt", parent_tool_use_id: null };
      harness.query.emit({
        ...envelope,
        type: "stream_event",
        uuid: "interrupt-tool-start",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-task-interrupted",
            name: "Agent",
            input: { description: "Sleep", prompt: "sleep", subagent_type: "general-purpose" },
          },
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        ...envelope,
        type: "system",
        subtype: "task_started",
        task_id: "task-interrupted",
        tool_use_id: "tool-task-interrupted",
        subagent_type: "general-purpose",
        description: "Sleep",
        uuid: "interrupt-task-started",
      } as unknown as SDKMessage);
      yield* adapter.interruptTurn(session.threadId);
      // Claude Code delivers the rejected tool result before it reports the subagent task killed.
      harness.query.emit({
        ...envelope,
        type: "user",
        uuid: "interrupt-tool-result",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-task-interrupted",
              is_error: true,
              content: "The user doesn't want to proceed with this tool use.",
            },
          ],
        },
      } as unknown as SDKMessage);

      const [completed] = Array.from(yield* Fiber.join(toolCompleted));
      assert.equal(completed?.type, "item.completed");
      if (completed?.type !== "item.completed") return;
      assert.equal(completed.payload.status, "declined");
      assert.deepEqual((completed.payload.data as { agentStates?: unknown }).agentStates, {
        "tool-task-interrupted": { status: "stopped" },
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("settles a foreground subagent with the turn that failed under it", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) => event.type === "task.completed" && event.payload.taskId === "task-bg",
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "delegate", attachments: [] });
      const envelope = { session_id: "sdk-session-limit", parent_tool_use_id: null };
      harness.query.emit({
        ...envelope,
        type: "stream_event",
        uuid: "limit-tool-start",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-fg",
            name: "Agent",
            input: { description: "Audit", prompt: "audit", subagent_type: "general-purpose" },
          },
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        ...envelope,
        type: "system",
        subtype: "task_started",
        task_id: "task-fg",
        tool_use_id: "tool-fg",
        subagent_type: "general-purpose",
        description: "Audit",
        is_backgrounded: false,
        uuid: "limit-task-fg-started",
      } as unknown as SDKMessage);
      harness.query.emit({
        ...envelope,
        type: "assistant",
        uuid: "limit-child-assistant",
        parent_tool_use_id: "tool-fg",
        message: { id: "limit-child-message", content: [{ type: "text", text: "Auditing." }] },
      } as unknown as SDKMessage);
      harness.query.emit({
        ...envelope,
        type: "system",
        subtype: "task_started",
        task_id: "task-bg",
        task_type: "local_bash",
        description: "Watch logs",
        is_backgrounded: true,
        uuid: "limit-task-bg-started",
      } as unknown as SDKMessage);
      // A usage limit ends the turn mid-subagent and the CLI never reports the subagent task.
      harness.query.emit({
        ...envelope,
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["You've hit your usage limit."],
        uuid: "limit-result",
      } as unknown as SDKMessage);
      harness.query.emit({
        ...envelope,
        type: "system",
        subtype: "task_progress",
        task_id: "task-fg",
        tool_use_id: "tool-fg",
        description: "Audit",
        uuid: "limit-late-progress",
      } as unknown as SDKMessage);
      harness.query.emit({
        ...envelope,
        type: "system",
        subtype: "task_notification",
        task_id: "task-bg",
        status: "completed",
        summary: "Logs watched.",
        uuid: "limit-task-bg-notification",
      } as unknown as SDKMessage);

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const rootTurnCompletedAt = events.findIndex(
        (event) =>
          event.type === "turn.completed" && event.providerRefs?.providerThreadId === undefined,
      );
      const taskCompletions = events.flatMap((event) =>
        event.type === "task.completed" ? [event.payload] : [],
      );
      assert.deepEqual(
        taskCompletions.map(({ taskId, status }) => ({ taskId, status })),
        [
          { taskId: "task-fg", status: "failed" },
          { taskId: "task-bg", status: "completed" },
        ],
      );
      const childTurnCompleted = events.find(
        (event) =>
          event.type === "turn.completed" && event.providerRefs?.providerThreadId === "tool-fg",
      );
      assert.equal(
        childTurnCompleted?.type === "turn.completed"
          ? childTurnCompleted.payload.state
          : undefined,
        "failed",
      );
      assert.equal(
        events
          .slice(rootTurnCompletedAt)
          .some((event) => event.type === "task.progress" && event.payload.taskId === "task-fg"),
        false,
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("attributes a wake only to the task that settled while the agent was idle", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      let mainTurnsCompleted = 0;
      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) =>
            event.type === "turn.completed" &&
            event.providerRefs?.providerThreadId === undefined &&
            ++mainTurnsCompleted === 2,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "run checks", attachments: [] });

      const system = (subtype: string, fields: Record<string, unknown>) =>
        harness.query.emit({
          type: "system",
          subtype,
          session_id: "sdk-session-wake",
          uuid: `${subtype}-${String(fields.task_id)}`,
          ...fields,
        } as unknown as SDKMessage);
      const result = (uuid: string) =>
        harness.query.emit({
          type: "result",
          subtype: "success",
          is_error: false,
          errors: [],
          session_id: "sdk-session-wake",
          uuid,
        } as unknown as SDKMessage);

      for (const taskId of ["mid-turn", "background"]) {
        system("task_started", {
          task_id: taskId,
          tool_use_id: `tool-${taskId}`,
          task_type: "local_bash",
          description: taskId,
        });
      }
      system("task_notification", {
        task_id: "mid-turn",
        tool_use_id: "tool-mid-turn",
        status: "completed",
        summary: "Finished while the turn ran.",
      });
      result("result-first");

      system("task_updated", { task_id: "background", patch: { status: "completed" } });
      system("task_notification", {
        task_id: "background",
        tool_use_id: "tool-background",
        status: "completed",
        summary: "Finished after the turn.",
      });
      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-wake",
        uuid: "wake-message-start",
        parent_tool_use_id: null,
        event: { type: "message_start", message: { id: "wake-message" } },
      } as unknown as SDKMessage);
      result("result-wake");

      const mainEvents = Array.from(yield* Fiber.join(runtimeEventsFiber)).filter(
        (event) => event.providerRefs?.providerThreadId === undefined,
      );
      const [firstTurn, wakeTurn] = mainEvents.filter((event) => event.type === "turn.started");
      assert.ok(firstTurn?.type === "turn.started" && wakeTurn?.type === "turn.started");
      assert.equal(wakeTurn.payload.backgroundParentTurnId, firstTurn.turnId);
      assert.equal(wakeTurn.payload.backgroundReplySource, undefined);

      const wakeFlags = mainEvents.flatMap((event) =>
        (event.type === "task.updated" || event.type === "task.completed") &&
        (event.payload.status === "completed" || event.type === "task.completed")
          ? [[String(event.payload.taskId), event.payload.wakesAgent ?? false] as const]
          : [],
      );
      assert.deepEqual(wakeFlags, [
        ["mid-turn", false],
        ["background", true],
      ]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });
});
