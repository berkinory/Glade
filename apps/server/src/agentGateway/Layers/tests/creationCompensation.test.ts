import { assert, describe, it } from "@effect/vitest";
import { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";

import type { AgentGatewayOperationRecord } from "../../Services/AgentGatewayOperationRepository.ts";
import {
  baseThreads,
  isToolError,
  makeHarnessLayer,
  makeThreadShell,
  NOW,
  toolResultJson,
} from "./gatewayTestFixtures.ts";

function interruptedCreateOperation(input: {
  readonly slug: string;
  readonly environment: "local" | "worktree";
  readonly newBranch?: string;
  readonly plannedPath?: string;
  readonly ownershipToken?: string;
}): AgentGatewayOperationRecord {
  const operationId = `gateway:create:${input.slug}`;
  const threadId = `agent:${input.slug}-child`;
  return {
    operationId,
    callerThreadId: "thread-parent",
    callerTurnId: "turn-parent-active",
    operationKind: "create_threads",
    requestId: `${input.slug}-request`,
    fingerprint: `${input.slug}-fingerprint`,
    requestedCount: 1,
    planJson: JSON.stringify([
      {
        workspaceRoot: "/tmp/demo",
        environment: input.environment,
        newBranch: input.newBranch ?? null,
        plannedWorktreePath: input.plannedPath ?? null,
        ownershipPreflightPassed: true,
        ...(input.ownershipToken === undefined
          ? {}
          : {
              worktreeOwnership: {
                operationId,
                path: input.plannedPath,
                branch: input.newBranch,
                token: input.ownershipToken,
                gitDir: `/tmp/git-admin/${input.slug}`,
                head: `head:${input.newBranch}`,
                recordedAt: NOW,
              },
            }),
        ids: { threadId, compensateCommandId: `${threadId}:compensate-delete` },
      },
    ]),
    status: "dispatching",
    resultJson: null,
    errorJson: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("AgentGateway creation compensation", () => {
  it.effect("compensates deterministic interrupted operations during gateway startup", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer(
      [
        ...baseThreads,
        makeThreadShell("agent:restart-child", {
          creationSource: "glade_mcp",
          sourceThreadId: ThreadId.makeUnsafe("thread-parent"),
          sourceTurnId: TurnId.makeUnsafe("turn-parent-active"),
          gatewayOperationId: "gateway:create:restart",
          gatewayOperationIndex: 0,
        }),
      ],
      {
        interruptedOperations: [
          interruptedCreateOperation({ slug: "restart", environment: "local" }),
        ],
      },
    );
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      assert.deepEqual(
        harness.dispatched.filter((command) => command.type === "thread.delete"),
        [
          {
            type: "thread.delete",
            commandId: "agent:restart-child:compensate-delete",
            threadId: "agent:restart-child",
          },
        ],
      );
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.create").length,
        0,
      );
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect.each([
    {
      name: "leaves worktree resources from the crash window before ownership was recorded",
      slug: "unrecorded-worktree",
      plannedPath: "/tmp/unrelated-after-crash",
      registeredPath: "/tmp/unrelated-after-crash",
      ownershipToken: undefined,
      verified: false,
    },
    {
      name: "refuses recorded cleanup when git registers the branch at a different worktree",
      slug: "mismatched-registration",
      plannedPath: process.cwd(),
      registeredPath: "/tmp/different-registration",
      ownershipToken: "ownership-mismatched-registration",
      verified: false,
    },
    {
      name: "refuses a same-path same-branch replacement without the ownership token",
      slug: "same-path-replacement",
      plannedPath: process.cwd(),
      registeredPath: process.cwd(),
      ownershipToken: "ownership-original-worktree",
      verified: false,
    },
    {
      name: "removes only a clean worktree carrying the persisted ownership token",
      slug: "verified-owned-worktree",
      plannedPath: process.cwd(),
      registeredPath: process.cwd(),
      ownershipToken: "ownership-verified-owned-worktree",
      verified: true,
    },
  ])("$name", ({ slug, plannedPath, registeredPath, ownershipToken, verified }) => {
    const newBranch = `agent/${slug}`;
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads, {
      interruptedOperations: [
        interruptedCreateOperation({
          slug,
          environment: "worktree",
          newBranch,
          plannedPath,
          ...(ownershipToken === undefined ? {} : { ownershipToken }),
        }),
      ],
      existingWorktrees: { [newBranch]: registeredPath },
      verifiedOwnershipTokens: verified && ownershipToken ? [ownershipToken] : [],
    });
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      assert.deepEqual(
        harness.worktreeRemoves.map(({ path }) => path),
        verified ? [plannedPath] : [],
      );
      assert.deepEqual(
        harness.branchDeletes.map(({ branch }) => branch),
        verified ? [newBranch] : [],
      );
      assert.equal(
        harness.getOperationStatus("turn-parent-active"),
        verified ? "failed" : "compensating",
      );
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect(
    "safely removes a just-created worktree when its ownership marker cannot persist",
    () => {
      const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads, {
        failRecordWorktreeOwnership: true,
      });
      return Effect.gen(function* () {
        const harness = yield* makeHarness;
        const response = yield* harness.callTool({
          token: "token-parent",
          name: "glade_create_threads",
          args: {
            requestId: "ownership-marker-failure",
            threads: [
              {
                prompt: "must not leak a worktree",
                target: { provider: "codex", model: "gpt-5.5" },
                environment: "worktree",
              },
            ],
          },
        });

        assert.equal(
          (toolResultJson(response.result).error as { code: string }).code,
          "operation_failed",
        );
        assert.equal(harness.worktreeCreates.length, 1);
        assert.equal(harness.worktreeRemoves.length, 1);
        assert.deepEqual(
          harness.branchDeletes.map(({ branch }) => branch),
          [harness.worktreeCreates[0]?.newBranch],
        );
        assert.equal(harness.dispatched.length, 0);
        assert.equal(harness.getOperationStatus("turn-parent-active"), "failed");
      }).pipe(Effect.provide(gatewayLayer));
    },
  );

  it.effect("compensates a worktree when the MCP request fiber is interrupted mid-create", () => {
    const worktreeCreated = Deferred.makeUnsafe<void>();
    const releaseWorktreeCreate = Deferred.makeUnsafe<void>();
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads, {
      pauseAfterWorktreeCreate: {
        entered: worktreeCreated,
        release: releaseWorktreeCreate,
      },
    });
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const requestFiber = yield* harness
        .callTool({
          token: "token-parent",
          name: "glade_create_threads",
          args: {
            requestId: "interrupt-after-worktree-create",
            threads: [
              {
                prompt: "must compensate the interrupted worktree",
                target: { provider: "codex", model: "gpt-5.5" },
                environment: "worktree",
              },
            ],
          },
        })
        .pipe(Effect.forkChild);
      yield* Deferred.await(worktreeCreated);
      const interruptFiber = yield* Fiber.interrupt(requestFiber).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Deferred.succeed(releaseWorktreeCreate, undefined);
      yield* Fiber.join(interruptFiber);

      const exit = yield* Fiber.await(requestFiber);
      assert.isTrue(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause));
      assert.equal(harness.worktreeCreates.length, 1);
      assert.equal(harness.worktreeRemoves.length, 1);
      assert.deepEqual(
        harness.branchDeletes.map(({ branch }) => branch),
        [harness.worktreeCreates[0]?.newBranch],
      );
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.create").length,
        0,
      );
      assert.equal(harness.getOperationStatus("turn-parent-active"), "failed");
      assert.equal(harness.getOperationErrorCode("turn-parent-active"), "request_interrupted");
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("compensates a created thread when its MCP request fiber is interrupted", () => {
    const threadCreated = Deferred.makeUnsafe<void>();
    const releaseThreadCreate = Deferred.makeUnsafe<void>();
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads, {
      pauseAfterDispatch: {
        commandType: "thread.create",
        entered: threadCreated,
        release: releaseThreadCreate,
      },
    });
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const requestFiber = yield* harness
        .callTool({
          token: "token-parent",
          name: "glade_create_threads",
          args: {
            requestId: "interrupt-after-thread-create",
            threads: [
              {
                prompt: "must compensate the interrupted child",
                target: { provider: "codex", model: "gpt-5.5" },
              },
            ],
          },
        })
        .pipe(Effect.forkChild);
      yield* Deferred.await(threadCreated);
      const interruptFiber = yield* Fiber.interrupt(requestFiber).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Deferred.succeed(releaseThreadCreate, undefined);
      yield* Fiber.join(interruptFiber);

      const exit = yield* Fiber.await(requestFiber);
      assert.isTrue(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause));
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.create").length,
        1,
      );
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.turn.start").length,
        0,
      );
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.delete").length,
        1,
      );
      assert.equal(harness.getOperationStatus("turn-parent-active"), "failed");
      assert.equal(harness.getOperationErrorCode("turn-parent-active"), "request_interrupted");
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("compensates operation-owned threads and worktrees after dispatch failure", () => {
    let turnStarts = 0;
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads, {
      failDispatch: (command) => {
        if (command.type !== "thread.turn.start") return false;
        turnStarts += 1;
        return turnStarts === 2;
      },
    });
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const response = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_threads",
        args: {
          requestId: "compensated-batch",
          threads: [
            {
              prompt: "first",
              target: { provider: "codex", model: "gpt-5.5" },
              environment: "worktree",
            },
            {
              prompt: "second",
              target: { provider: "claudeAgent", model: "claude-sonnet-5" },
              environment: "worktree",
            },
          ],
        },
      });
      assert.isTrue(isToolError(response.result));
      assert.equal(
        (toolResultJson(response.result).error as { code: string }).code,
        "operation_failed",
      );
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.create").length,
        2,
      );
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.delete").length,
        2,
      );
      assert.equal(harness.worktreeCreates.length, 2);
      assert.equal(harness.worktreeRemoves.length, 2);
      assert.deepEqual(
        harness.branchDeletes.map(({ branch }) => branch).toSorted(),
        harness.worktreeCreates.map(({ newBranch }) => newBranch).toSorted(),
      );
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("compensates successful dispatches when the replayable result cannot persist", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads, {
      failOperationComplete: true,
    });
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const response = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_threads",
        args: {
          requestId: "completion-persistence-failure",
          threads: [
            {
              prompt: "dispatch then compensate",
              target: { provider: "codex", model: "gpt-5.5" },
            },
          ],
        },
      });
      assert.isTrue(isToolError(response.result));
      assert.equal(
        (toolResultJson(response.result).error as { code: string }).code,
        "operation_failed",
      );
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.create").length,
        1,
      );
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.delete").length,
        1,
      );
      assert.equal(harness.getOperationStatus("turn-parent-active"), "failed");
    }).pipe(Effect.provide(gatewayLayer));
  });

  it.effect("keeps a durable compensating status when cleanup itself fails", () => {
    const { gatewayLayer, makeHarness } = makeHarnessLayer(baseThreads, {
      failDispatch: (command) =>
        command.type === "thread.turn.start" || command.type === "thread.delete",
    });
    return Effect.gen(function* () {
      const harness = yield* makeHarness;
      const response = yield* harness.callTool({
        token: "token-parent",
        name: "glade_create_threads",
        args: {
          requestId: "cleanup-failure",
          threads: [
            {
              prompt: "fail and compensate",
              target: { provider: "codex", model: "gpt-5.5" },
            },
          ],
        },
      });
      const payload = toolResultJson(response.result);
      assert.equal((payload.error as { code: string }).code, "operation_failed");
      assert.equal(
        (payload.error as { details: { compensationPending: boolean } }).details
          .compensationPending,
        true,
      );
      assert.equal(harness.getOperationStatus("turn-parent-active"), "compensating");
      assert.equal(
        harness.dispatched.filter((command) => command.type === "thread.create").length,
        1,
      );
    }).pipe(Effect.provide(gatewayLayer));
  });
});
