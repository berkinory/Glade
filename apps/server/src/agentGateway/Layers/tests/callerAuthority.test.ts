import { assert, describe, it } from "@effect/vitest";
import { TurnId } from "@glade/contracts/core/baseSchemas";
import { Effect } from "effect";

import {
  baseThreads,
  isToolError,
  makeHarnessLayer,
  makeThreadShell,
  NOW,
  toolErrorText,
  toolResultJson,
} from "./gatewayTestFixtures.ts";

describe("AgentGateway caller authority", () => {
  it.effect.each([
    {
      tool: "glade_create_threads",
      args: {
        requestId: "readonly-create",
        threads: [{ prompt: "should not run", target: { provider: "codex", model: "gpt-5.5" } }],
      },
      requiredCapability: "thread:write",
    },
    {
      tool: "glade_diagnose_thread",
      args: { threadId: "thread-parent" },
      requiredCapability: "diagnostics:read",
    },
  ])("denies $tool without $requiredCapability", ({ tool, args, requiredCapability }) => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads);
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const response = yield* harness.callTool({
        token: "token-parent-readonly",
        name: tool,
        args,
      });
      const error = toolResultJson(response.result).error as {
        code: string;
        details: { requiredCapability: string };
      };
      assert.equal(error.code, "capability_denied");
      assert.equal(error.details.requiredCapability, requiredCapability);
      assert.equal(harness.dispatched.length, 0);
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("rejects every destructive tool after the caller turn completes", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer([
      makeThreadShell("thread-parent", {
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-parent-complete"),
          state: "completed",
          requestedAt: NOW,
          startedAt: NOW,
          completedAt: NOW,
          assistantMessageId: null,
        },
      }),
      makeThreadShell("thread-child"),
    ]);
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const attempts = [
        {
          name: "glade_create_threads",
          args: {
            requestId: "late-batch",
            threads: [{ prompt: "late", target: { provider: "codex", model: "gpt-5.5" } }],
          },
        },
        {
          name: "glade_create_thread",
          args: {
            requestId: "late-single",
            prompt: "late",
            target: { provider: "codex", model: "gpt-5.5" },
          },
        },
        {
          name: "glade_send_message",
          args: { threadId: "thread-child", message: "late" },
        },
        { name: "glade_interrupt_thread", args: { threadId: "thread-child" } },
        {
          name: "glade_set_thread_title",
          args: { threadId: "thread-child", title: "Late rename" },
        },
        {
          name: "glade_set_thread_archived",
          args: { threadId: "thread-child", archived: true },
        },
      ];

      for (const attempt of attempts) {
        const response = yield* harness.callTool({ token: "token-parent", ...attempt });
        assert.equal(
          (toolResultJson(response.result).error as { code: string }).code,
          "caller_turn_inactive",
          attempt.name,
        );
      }
      assert.equal(harness.dispatched.length, 0);

      const read = yield* harness.callTool({
        token: "token-parent",
        name: "glade_list_threads",
        args: {},
      });
      assert.isFalse(isToolError(read.result), toolErrorText(read.result));
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect.each([
    {
      tool: "glade_send_message",
      args: { threadId: "thread-elevated", message: "run something dangerous" },
    },
    { tool: "glade_interrupt_thread", args: { threadId: "thread-elevated" } },
    { tool: "glade_set_thread_title", args: { threadId: "thread-elevated", title: "Hidden work" } },
    {
      tool: "glade_set_thread_archived",
      args: { threadId: "thread-elevated", archived: true },
    },
  ])("rejects $tool targeting a higher-privileged thread", ({ tool, args }) => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer([
      ...baseThreads,
      makeThreadShell("thread-elevated", { runtimeMode: "full-access" }),
    ]);
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const response = yield* harness.callTool({ token: "token-parent", name: tool, args });
      assert.isTrue(isToolError(response.result));
      assert.include(toolErrorText(response.result), "full-access");
      assert.equal(harness.dispatched.length, 0);
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("rejects sends from worktree-isolated callers to local-checkout threads", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer([
      makeThreadShell("thread-parent", {
        envMode: "worktree",
        worktreePath: "/tmp/worktrees/caller",
        branch: "agent/caller",
      }),
      makeThreadShell("thread-local"),
    ]);
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const response = yield* harness.callTool({
        token: "token-parent",
        name: "glade_send_message",
        args: { threadId: "thread-local", message: "edit the main checkout" },
      });
      assert.isTrue(isToolError(response.result));
      assert.include(toolErrorText(response.result), "local");
      assert.equal(harness.dispatched.length, 0);
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("keeps worktree-isolated callers from spawning local workers", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer([
      makeThreadShell("thread-parent", {
        envMode: "worktree",
        worktreePath: "/tmp/worktrees/caller",
        branch: "agent/caller",
      }),
    ]);
    return Effect.gen(function* () {
      const harness = yield* makeHarness;

      const rejected = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_thread",
        args: {
          requestId: "create-local-rejected",
          prompt: "touch the main checkout",
          target: { provider: "codex", model: "gpt-5.5" },
          environment: "local",
        },
      });
      assert.isTrue(isToolError(rejected.result));
      assert.include(toolErrorText(rejected.result), "isolated worktree");
      assert.equal(harness.dispatched.length, 0);

      const defaulted = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_thread",
        args: {
          requestId: "create-isolated",
          prompt: "do isolated work",
          target: { provider: "codex", model: "gpt-5.5" },
        },
      });
      assert.isFalse(isToolError(defaulted.result), toolErrorText(defaulted.result));
      assert.equal(toolResultJson(defaulted.result).environment, "worktree");
      const create = harness.dispatched[0]!;
      assert.equal(create.type, "thread.create");
      if (create.type === "thread.create") {
        assert.equal(create.envMode, "worktree");
      }
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("rejects runtime-mode escalation beyond the calling thread", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads);
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const response = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_thread",
        args: {
          requestId: "create-escalated",
          prompt: "escalate please",
          target: { provider: "codex", model: "gpt-5.5" },
          runtimeMode: "full-access",
        },
      });
      assert.isTrue(isToolError(response.result));
      assert.include(toolErrorText(response.result), "approval-required");
      assert.equal(harness.dispatched.length, 0);
    }).pipe(Effect.provide(gatewayLayer));
  });
});
