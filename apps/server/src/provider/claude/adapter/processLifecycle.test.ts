import { describe, it, assert } from "@effect/vitest";
import { Effect, Stream, Fiber, Random, Layer, Exit, ServiceMap } from "effect";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter.ts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { type ClaudeOwnedProcess } from "./adapterConfiguration.ts";
import {
  makeHarness,
  THREAD_ID,
  makeDeterministicRandomService,
  FakeClaudeQuery,
  makeClaudeAdapterTestLayer,
  makeMultiQueryHarness,
  makeGatewayCredentialsHarness,
} from "./adapterTestFixtures";

describe("Claude processLifecycle", () => {
  it.effect("keeps separately built adapters isolated in one parent scope", () => {
    const firstQuery = new FakeClaudeQuery();
    const secondQuery = new FakeClaudeQuery();
    const firstLayer = makeClaudeAdapterTestLayer({ createQuery: () => firstQuery });
    const secondLayer = makeClaudeAdapterTestLayer({ createQuery: () => secondQuery });

    return Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        const first = ServiceMap.get(yield* Layer.buildWithScope(firstLayer, scope), ClaudeAdapter);
        const second = ServiceMap.get(
          yield* Layer.buildWithScope(secondLayer, scope),
          ClaudeAdapter,
        );

        yield* first.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "full-access",
        });
        assert.equal(yield* first.hasSession(THREAD_ID), true);
        assert.equal(yield* second.hasSession(THREAD_ID), false);

        yield* second.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "full-access",
        });
        yield* first.stopAll();
        assert.equal(yield* second.hasSession(THREAD_ID), true);
        yield* second.stopAll();
        assert.equal(firstQuery.closeCalls, 1);
        assert.equal(secondQuery.closeCalls, 1);
      }),
    ).pipe(Effect.provideService(Random.Random, makeDeterministicRandomService()));
  });

  it.effect("treats user-aborted Claude results as interrupted without a runtime error", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 6).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "result",
        subtype: "error_during_execution",
        is_error: false,
        errors: ["Error: Request was aborted."],
        stop_reason: "tool_use",
        session_id: "sdk-session-abort",
        uuid: "result-abort",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
          "turn.completed",
        ],
      );

      const turnCompleted = runtimeEvents[runtimeEvents.length - 1];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(String(turnCompleted.turnId), String(turn.turnId));
        assert.equal(turnCompleted.payload.state, "interrupted");
        assert.equal(turnCompleted.payload.errorMessage, "Error: Request was aborted.");
        assert.equal(turnCompleted.payload.stopReason, "tool_use");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("closes the session when the Claude stream aborts after a turn starts", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "session.exited"),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        lifecycleGeneration: "generation-claude-a",
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello",
        attachments: [],
      });

      harness.query.fail(new Error("All fibers interrupted without error"));

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "turn.completed",
          "session.exited",
        ],
      );
      assert.equal(
        runtimeEvents.every((event) => event.lifecycleGeneration === "generation-claude-a"),
        true,
      );

      const turnCompleted = runtimeEvents[4];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(String(turnCompleted.turnId), String(turn.turnId));
        assert.equal(turnCompleted.payload.state, "interrupted");
        assert.equal(turnCompleted.payload.errorMessage, "Claude runtime interrupted.");
      }

      const sessionExited = runtimeEvents[5];
      assert.equal(sessionExited?.type, "session.exited");

      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
      const sessions = yield* adapter.listSessions();
      assert.equal(sessions.length, 0);
      assert.equal(harness.query.closeCalls, 1);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("invalidates a missing resumed conversation reported by the async stream", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        resumeCursor: {
          threadId: THREAD_ID,
          resume: "44c0b890-8775-4f30-b47f-0709d29cc9e1",
          resumeSessionAt: "assistant-stale",
          turnCount: 2,
        },
        runtimeMode: "full-access",
      });
      const turn = yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "continue",
        attachments: [],
      });

      harness.query.fail(
        new Error("No conversation found with session ID: 44c0b890-8775-4f30-b47f-0709d29cc9e1"),
      );

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "runtime.error",
          "turn.completed",
          "session.exited",
        ],
      );
      const turnCompleted = runtimeEvents[5];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(String(turnCompleted.turnId), String(turn.turnId));
        assert.equal(turnCompleted.payload.state, "failed");
        assert.equal(turnCompleted.providerRefs?.providerThreadId, undefined);
      }
      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("retains Claude session ownership until subprocess-tree exit is proven", () => {
    const query = new FakeClaudeQuery();
    let proveExit: (() => void) | undefined;
    const exitProof = new Promise<void>((resolve) => {
      proveExit = resolve;
    });
    let teardownCalls = 0;
    const ownedProcess = {
      pid: 73_311,
      exitCode: 0,
      signalCode: null,
    } as unknown as ClaudeOwnedProcess;
    const layer = makeClaudeAdapterTestLayer({
      spawnClaudeCodeProcess: () => ownedProcess,
      teardownProcessTree: async () => {
        teardownCalls += 1;
        await exitProof;
        return { escalated: false, signalErrors: [] };
      },
      createQuery: (input) => {
        input.options.spawnClaudeCodeProcess?.({
          command: "claude",
          args: [],
          env: {},
          signal: new AbortController().signal,
        });
        return query;
      },
    });

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      const stopping = yield* adapter.stopSession(THREAD_ID).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      assert.equal(query.closeCalls, 1);
      assert.equal(teardownCalls, 1);
      assert.equal((yield* adapter.listSessions()).length, 1);

      proveExit?.();
      yield* Fiber.join(stopping);
      assert.equal((yield* adapter.listSessions()).length, 0);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("retains Claude ownership and retries when teardown proof fails", () => {
    const query = new FakeClaudeQuery();
    let teardownCalls = 0;
    const ownedProcess = {
      pid: 73_312,
      exitCode: 0,
      signalCode: null,
    } as unknown as ClaudeOwnedProcess;
    const layer = makeClaudeAdapterTestLayer({
      spawnClaudeCodeProcess: () => ownedProcess,
      teardownProcessTree: async () => {
        teardownCalls += 1;
        if (teardownCalls === 1) {
          throw new Error("rootExited=false; surviving process remains");
        }
        return { escalated: true, signalErrors: [] };
      },
      createQuery: (input) => {
        input.options.spawnClaudeCodeProcess?.({
          command: "claude",
          args: [],
          env: {},
          signal: new AbortController().signal,
        });
        return query;
      },
    });

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      const failedStop = yield* Effect.exit(adapter.stopSession(THREAD_ID));
      assert.isTrue(Exit.isFailure(failedStop));
      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
      assert.equal((yield* adapter.listSessions()).length, 1);

      yield* adapter.stopSession(THREAD_ID);
      assert.equal(teardownCalls, 2);
      assert.equal((yield* adapter.listSessions()).length, 0);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("blocks a retry when createQuery spawned before failing cleanup", () => {
    const query = new FakeClaudeQuery();
    let allowStart = false;
    let createCalls = 0;
    let spawnCalls = 0;
    let teardownCalls = 0;
    const ownedProcess = {
      pid: 73_313,
      exitCode: null,
      signalCode: null,
      once: () => undefined,
      removeListener: () => undefined,
    } as unknown as ClaudeOwnedProcess;
    const layer = makeClaudeAdapterTestLayer({
      spawnClaudeCodeProcess: () => {
        spawnCalls += 1;
        return ownedProcess;
      },
      teardownProcessTree: async () => {
        teardownCalls += 1;
        if (teardownCalls < 3) {
          throw new Error("rootExited=false; surviving process remains");
        }
        return { escalated: true, signalErrors: [] };
      },
      createQuery: (input) => {
        createCalls += 1;
        input.options.spawnClaudeCodeProcess?.({
          command: "claude",
          args: [],
          env: {},
          signal: new AbortController().signal,
        });
        if (!allowStart) {
          throw new Error("simulated failure after spawn");
        }
        return query;
      },
    });

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const input = {
        threadId: THREAD_ID,
        provider: "claudeAgent" as const,
        runtimeMode: "full-access" as const,
      };

      assert.isTrue(Exit.isFailure(yield* Effect.exit(adapter.startSession(input))));
      assert.equal(createCalls, 1);
      assert.equal(spawnCalls, 1);
      assert.equal(teardownCalls, 1);

      assert.isTrue(Exit.isFailure(yield* Effect.exit(adapter.startSession(input))));
      assert.equal(createCalls, 1);
      assert.equal(spawnCalls, 1);
      assert.equal(teardownCalls, 2);

      allowStart = true;
      yield* adapter.startSession(input);
      assert.equal(createCalls, 2);
      assert.equal(spawnCalls, 2);
      assert.equal(teardownCalls, 3);

      yield* adapter.stopSession(THREAD_ID);
      assert.equal(teardownCalls, 4);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("blocks command rediscovery until an unproven process tree is reaped", () => {
    const query = new FakeClaudeQuery();
    let spawnCalls = 0;
    let teardownCalls = 0;
    const ownedProcess = {
      pid: 73_314,
      exitCode: null,
      signalCode: null,
      once: () => undefined,
      removeListener: () => undefined,
    } as unknown as ClaudeOwnedProcess;
    const layer = makeClaudeAdapterTestLayer({
      spawnClaudeCodeProcess: () => {
        spawnCalls += 1;
        return ownedProcess;
      },
      teardownProcessTree: async () => {
        teardownCalls += 1;
        if (teardownCalls < 3) {
          throw new Error("rootExited=false; discovery process remains");
        }
        return { escalated: true, signalErrors: [] };
      },
      createQuery: (input) => {
        input.options.spawnClaudeCodeProcess?.({
          command: "claude",
          args: [],
          env: {},
          signal: new AbortController().signal,
        });
        return query;
      },
    });

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const listCommands = adapter.listCommands;
      if (!listCommands) {
        assert.fail("Expected Claude adapter to support command discovery.");
      }
      const input = {
        provider: "claudeAgent" as const,
        cwd: "/tmp/project",
        forceReload: true,
      };

      assert.isTrue(Exit.isFailure(yield* Effect.exit(listCommands(input))));
      assert.equal(spawnCalls, 1);
      assert.equal(teardownCalls, 1);

      assert.isTrue(Exit.isFailure(yield* Effect.exit(listCommands(input))));
      assert.equal(spawnCalls, 1);
      assert.equal(teardownCalls, 2);

      yield* adapter.stopAll();
      assert.equal(teardownCalls, 3);
    }).pipe(Effect.provide(layer));
  });

  it.effect("leaves no Claude runtime when replacement spawn fails", () => {
    const harness = makeMultiQueryHarness({ failCreateAt: 1 });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
        modelSelection: { provider: "claudeAgent", model: "claude-opus-4-8" },
      });
      const firstQuery = harness.queries[0];
      assert.ok(firstQuery);

      const replacement = yield* Effect.exit(
        adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "full-access",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-opus-4-8",
            options: { effort: "max" },
          },
        }),
      );

      assert.ok(Exit.isFailure(replacement));
      assert.equal(firstQuery.closeCalls, 1);
      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
      assert.equal((yield* adapter.listSessions()).length, 0);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("releases the gateway lease when the Claude stream aborts spontaneously", () => {
    const gateway = makeGatewayCredentialsHarness();
    const harness = makeMultiQueryHarness({ gatewayCredentials: gateway.credentials });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello",
        attachments: [],
      });

      harness.queries[0]?.fail(new Error("All fibers interrupted without error"));
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      assert.deepEqual(gateway.revokedTokens, ["gateway-token-1"]);
      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });
});
