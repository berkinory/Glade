import { assert, describe, it } from "@effect/vitest";
import { MessageId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { isTemporaryWorktreeBranch } from "@glade/shared/git/git";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import {
  baseThreads,
  isToolError,
  makeHarnessLayer,
  makeThreadDetail,
  makeThreadShell,
  NOW,
  PROJECT_ID,
  toolErrorText,
  toolResultJson,
} from "./gatewayTestFixtures.ts";

describe("AgentGateway thread workers", () => {
  it.effect("creates a standalone cross-provider thread and dispatches the initial turn", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads);
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const response = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_thread",
        args: {
          requestId: "create-claude",
          prompt: "analyze the feature",
          target: { provider: "claudeAgent", model: "claude-sonnet-5" },
        },
      });
      assert.isFalse(isToolError(response.result), toolErrorText(response.result));
      const payload = toolResultJson(response.result);
      assert.equal(payload.provider, "claudeAgent");
      assert.strictEqual("parentThreadId" in payload, false);

      assert.equal(harness.dispatched.length, 3);
      const create = harness.dispatched[0]!;
      assert.equal(create.type, "thread.create");
      if (create.type === "thread.create") {
        assert.strictEqual("parentThreadId" in create, false);
        assert.strictEqual("subagentNickname" in create, false);
        assert.equal(create.modelSelection.provider, "claudeAgent");
        assert.equal(create.modelSelection.model, "claude-sonnet-5");

        assert.equal(create.projectId, PROJECT_ID);
        assert.equal(create.runtimeMode, "approval-required");

        assert.equal(create.title, "analyze the feature");
      }
      const turn = harness.dispatched[1]!;
      assert.equal(turn.type, "thread.turn.start");
      if (turn.type === "thread.turn.start") {
        assert.equal(turn.dispatchOrigin, "agent");
        assert.equal(turn.message.text, "analyze the feature");
      }
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("creates a detached worktree when environment=worktree", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads);
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const response = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_thread",
        args: {
          requestId: "create-worktree",
          prompt: "refactor module X",
          target: { provider: "claudeAgent", model: "claude-sonnet-5" },
          environment: "worktree",
        },
      });
      assert.isFalse(isToolError(response.result), toolErrorText(response.result));
      const payload = toolResultJson(response.result);
      assert.isString(payload.branch);
      assert.isTrue(isTemporaryWorktreeBranch(payload.branch as string));
      assert.equal(payload.branch, harness.worktreeCreates[0]?.newBranch);
      assert.equal(payload.worktreePath, harness.worktreeCreates[0]?.path);
      assert.equal(harness.worktreeCreates[0]?.ref, "0123456789abcdef0123456789abcdef01234567");
      const create = harness.dispatched[0]!;
      if (create.type === "thread.create") {
        assert.equal(create.envMode, "worktree");
        assert.equal(create.branch, payload.branch);
        assert.equal(create.associatedWorktreeRef, "0123456789abcdef0123456789abcdef01234567");
      }
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("replays an identical exact batch without creating more threads", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads);
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const args = {
        requestId: "two-workers",
        threads: [
          { prompt: "worker one", target: { provider: "codex", model: "gpt-5.5" } },
          {
            prompt: "worker two",
            target: { provider: "claudeAgent", model: "claude-sonnet-5" },
          },
        ],
      };
      const first = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_threads",
        args,
      });
      harness.setProviderStatuses([
        {
          provider: "codex",
          status: "error",
          available: false,
          authStatus: "unauthenticated",
          checkedAt: NOW,
          message: "temporarily unavailable after dispatch",
        },
        {
          provider: "claudeAgent",
          status: "error",
          available: false,
          authStatus: "unauthenticated",
          checkedAt: NOW,
          message: "temporarily unavailable after dispatch",
        },
      ]);
      const replay = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_threads",
        args,
      });
      assert.isFalse(isToolError(first.result), toolErrorText(first.result));
      assert.isFalse(isToolError(replay.result), toolErrorText(replay.result));
      assert.deepEqual(
        toolResultJson(replay.result).threadIds,
        toolResultJson(first.result).threadIds,
      );
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.create").length,
        2,
      );
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.turn.start").length,
        2,
      );
      const creationRecaps = harness.dispatched.filter(
        (command) =>
          command.type === "thread.activity.append" &&
          command.activity.kind === "glade.threads.created",
      );
      assert.equal(creationRecaps.length, 1);
      const creationRecap = creationRecaps[0];
      assert.equal(creationRecap?.type, "thread.activity.append");
      if (creationRecap?.type === "thread.activity.append") {
        assert.equal(creationRecap.threadId, ThreadId.makeUnsafe("thread-parent"));
        assert.equal(creationRecap.activity.turnId, TurnId.makeUnsafe("turn-parent-active"));
        assert.deepInclude(creationRecap.activity.payload as Record<string, unknown>, {
          source: "glade_mcp",
          requestedCount: 2,
          createdCount: 2,
        });
      }
      const conflict = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_threads",
        args: {
          ...args,
          threads: [
            {
              prompt: "changed payload",
              target: { provider: "codex", model: "made-up-model" },
            },
          ],
        },
      });
      assert.equal(
        (toolResultJson(conflict.result).error as { code: string }).code,
        "idempotency_conflict",
      );
      const operationId = toolResultJson(first.result).operationId as string;
      const creates = harness.dispatched.filter((command) => command.type === "thread.create");
      assert.deepEqual(
        creates.map((command) => ({
          creationSource: command.creationSource,
          sourceThreadId: command.sourceThreadId,
          sourceTurnId: command.sourceTurnId,
          gatewayOperationId: command.gatewayOperationId,
          gatewayOperationIndex: command.gatewayOperationIndex,
          parentThreadId: command.parentThreadId,
        })),
        [0, 1].map((index) => ({
          creationSource: "glade_mcp" as const,
          sourceThreadId: ThreadId.makeUnsafe("thread-parent"),
          sourceTurnId: TurnId.makeUnsafe("turn-parent-active"),
          gatewayOperationId: operationId,
          gatewayOperationIndex: index,
          parentThreadId: undefined,
        })),
      );
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("coalesces concurrent identical creation calls onto one operation", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads, {
      dispatchDelayMs: 15,
    });
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const call = () =>
        harness.callTool({
          token: "token-parent",
          name: "glade_create_threads",
          args: {
            requestId: "concurrent-exact-plan",
            threads: [
              {
                prompt: "one exact worker",
                target: { provider: "codex", model: "gpt-5.5" },
                environment: "worktree",
              },
            ],
          },
        });
      const fibers = yield* Effect.forEach([call(), call()], (effect) =>
        effect.pipe(Effect.forkChild),
      );
      yield* TestClock.adjust("1 second");
      const responses = yield* Effect.forEach(fibers, (fiber) => Fiber.join(fiber));
      const first = responses[0]!;
      const second = responses[1]!;
      assert.isFalse(isToolError(first.result), toolErrorText(first.result));
      assert.isFalse(isToolError(second.result), toolErrorText(second.result));
      assert.deepEqual(toolResultJson(first.result), toolResultJson(second.result));
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.create").length,
        1,
      );
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.turn.start").length,
        1,
      );
      assert.equal(harness.worktreeCreates.length, 1);
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("rejects an unavailable or unauthenticated provider before dispatch", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads, {
      providerStatuses: [
        {
          provider: "claudeAgent",
          status: "error",
          available: false,
          authStatus: "unauthenticated",
          checkedAt: NOW,
          message: "Claude is not authenticated.",
        },
      ],
    });
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const response = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_threads",
        args: {
          requestId: "unavailable-provider",
          threads: [
            {
              prompt: "must not dispatch",
              target: { provider: "claudeAgent", model: "claude-sonnet-5" },
            },
          ],
        },
      });
      assert.equal(
        (toolResultJson(response.result).error as { code: string }).code,
        "provider_unavailable",
      );
      assert.equal(harness.dispatched.length, 0);
      assert.equal(harness.worktreeCreates.length, 0);
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("preflights the whole batch so one invalid target creates nothing", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads);
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const response = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_threads",
        args: {
          requestId: "atomic-preflight",
          threads: [
            { prompt: "valid", target: { provider: "codex", model: "gpt-5.5" } },
            {
              prompt: "invalid",
              target: { provider: "claudeAgent", model: "made-up-claude" },
            },
          ],
        },
      });
      assert.isTrue(isToolError(response.result));
      assert.equal(
        (toolResultJson(response.result).error as { code: string }).code,
        "model_unavailable",
      );
      assert.equal(harness.dispatched.length, 0);
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("wait reports idle, failure, timeout, and a later-completed pinned run", () => {
    const idle = makeThreadShell("thread-wait-idle");
    const failed = makeThreadShell("thread-wait-failed", {
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-wait-failed"),
        state: "error",
        requestedAt: NOW,
        startedAt: NOW,
        completedAt: NOW,
        assistantMessageId: null,
      },
      session: {
        threadId: ThreadId.makeUnsafe("thread-wait-failed"),
        status: "error",
        providerName: "claudeAgent",
        runtimeMode: "approval-required",
        activeTurnId: null,
        lastError: "Child failed",
        updatedAt: NOW,
      },
    });
    const running = makeThreadShell("thread-wait-running", {
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-wait-pinned"),
        state: "running",
        requestedAt: NOW,
        startedAt: NOW,
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const { gatewayLayer, makeHarness } = makeHarnessLayer([
      makeThreadShell("thread-parent"),
      idle,
      failed,
      running,
    ]);
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const first = yield* harness.callTool({
        token: "token-parent",
        name: "glade_wait_for_threads",
        args: {
          threadIds: ["thread-wait-idle", "thread-wait-failed", "thread-wait-running"],
          timeoutMs: 0,
        },
      });
      const firstThreads = toolResultJson(first.result).threads as Array<{
        state: string;
        timedOut: boolean;
        error: string | null;
      }>;
      assert.deepEqual(
        firstThreads.map(({ state, timedOut }) => ({ state, timedOut })),
        [
          { state: "idle", timedOut: false },
          { state: "error", timedOut: false },
          { state: "running", timedOut: true },
        ],
      );
      assert.equal(firstThreads[1]?.error, "Child failed");

      harness.setProjectionTurn({
        threadId: "thread-wait-running",
        turnId: "turn-wait-pinned",
        state: "completed",
        assistantMessageId: "message-wait-pinned",
      });
      harness.setThreadDetail({
        ...makeThreadDetail(
          makeThreadShell("thread-wait-running", {
            latestTurn: {
              turnId: TurnId.makeUnsafe("turn-wait-later"),
              state: "running",
              requestedAt: NOW,
              startedAt: NOW,
              completedAt: null,
              assistantMessageId: null,
            },
          }),
        ),
        messages: [
          {
            id: MessageId.makeUnsafe("message-wait-pinned"),
            role: "assistant",
            text: "Pinned run finished",
            turnId: TurnId.makeUnsafe("turn-wait-pinned"),
            streaming: false,
            source: "native",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      });
      harness.setThreadDetail(
        makeThreadDetail(
          makeThreadShell("thread-parent", {
            latestTurn: {
              turnId: TurnId.makeUnsafe("turn-parent-active"),
              state: "interrupted",
              requestedAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
              assistantMessageId: null,
            },
          }),
        ),
      );
      const second = yield* harness.callTool({
        token: "token-parent",
        name: "glade_wait_for_threads",
        args: {
          threadIds: ["thread-wait-running"],
          runIds: ["turn-wait-pinned"],
          timeoutMs: 0,
        },
      });
      const secondThread = (
        toolResultJson(second.result).threads as Array<{
          state: string;
          summary: string;
        }>
      )[0];
      assert.equal(secondThread?.state, "completed");
      assert.equal(secondThread?.summary, "Pinned run finished");
      assert.equal(harness.dispatched.length, 0);
    }).pipe(Effect.provide(gatewayLayer));
  });
});
