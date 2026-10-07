import { isRecord } from "@glade/shared/transport/payloadValues";
import { makeNativeToolCallRegistry } from "./nativeToolCalls.ts";
import { assert, describe, it } from "@effect/vitest";
import { ProjectId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationThreadShell } from "@glade/contracts/orchestration/threadEntities";
import { Deferred, Effect, Fiber, Option } from "effect";

import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeAgentGatewaySessionRegistry } from "./Layers/AgentGatewaySessionRegistry.ts";
import type { AgentGatewayCredentialsShape } from "./Services/AgentGatewayCredentials.ts";
import { makeAgentGatewayInFlightRequestRegistry } from "./inFlightRequestRegistry.ts";
import { makeAgentGatewayMcpTransport } from "./mcpTransport.ts";
import { FALLBACK_OBJECT_DESCRIPTION } from "./sanitizeToolInputSchema.ts";
import { countSchemaKeyOccurrences } from "./schemaTestUtils.ts";
import { GladeAppOpenInput } from "@glade/contracts/provider/agentGatewayTools";
import { toolInputSchema } from "./protocol.ts";
import {
  acquireAgentGatewaySessionLease,
  AGENT_GATEWAY_NO_CAPABILITIES,
  type AgentGatewayCapabilityInput,
  type AgentGatewaySessionLease,
} from "./sessionLease.ts";
import type { ToolEntry } from "./toolRuntime.ts";

class InjectedFailure extends Error {
  readonly _tag = "InjectedFailure";
}

const NOW = "2026-07-22T03:00:00.000Z";

function makeThread(threadId: string): OrchestrationThreadShell {
  return {
    id: ThreadId.makeUnsafe(threadId),
    projectId: ProjectId.makeUnsafe("project-mcp-cancellation"),
    title: threadId,
    modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
    runtimeMode: "full-access",

    envMode: "local",
    branch: null,
    worktreePath: null,
    associatedWorktreePath: null,
    associatedWorktreeBranch: null,
    associatedWorktreeRef: null,
    createBranchFlowCompleted: false,
    isPinned: false,
    parentThreadId: null,
    subagentAgentId: null,
    subagentNickname: null,
    subagentRole: null,
    forkSourceThreadId: null,
    lastKnownPr: null,
    latestTurn: {
      turnId: TurnId.makeUnsafe(`turn-${threadId}`),
      state: "running",
      requestedAt: NOW,
      startedAt: NOW,
      completedAt: null,
      assistantMessageId: null,
    },
    latestUserMessageAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    handoff: null,
    session: null,
  };
}

function makeTransport(input: {
  readonly tools: ReadonlyArray<ToolEntry>;
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
  readonly leaseCapabilities?: AgentGatewayCapabilityInput;

  readonly ghostThreads?: ReadonlyArray<string>;
}) {
  const threads = new Map(input.threads.map((thread) => [String(thread.id), thread]));
  let nextSession = 0;
  let nextRandomPartIsSession = true;
  const sessionRegistry = makeAgentGatewaySessionRegistry({
    randomId: () => {
      if (nextRandomPartIsSession) {
        nextSession += 1;
        nextRandomPartIsSession = false;
        return `session-${nextSession}`;
      }
      nextRandomPartIsSession = true;
      return `token-${nextSession}`;
    },
  });
  const inFlightRequests = makeAgentGatewayInFlightRequestRegistry();
  const nativeToolCalls = makeNativeToolCallRegistry();
  const credentials = {
    nativeToolCalls,
    verifySession: sessionRegistry.verify,
    bindWriteAuthority: sessionRegistry.bindWriteAuthority,
    verifyWriteAuthority: sessionRegistry.verifyWriteAuthority,
    registerInFlightRequest: inFlightRequests.register,
    cancelInFlightRequests: inFlightRequests.cancel,
    cancelSessionTurnRequests: (token: string, turnId: string) => {
      nativeToolCalls.retire(token, turnId);
      const session = sessionRegistry.verify(token);
      return session
        ? inFlightRequests.cancelTurn(session.sessionKey, turnId).settled
        : Promise.resolve();
    },
    retireSessionTurn: (token: string, turnId: string) => {
      const session = sessionRegistry.verify(token);
      if (!session) return Promise.resolve();
      sessionRegistry.retireWriteAuthority(token, turnId);
      return inFlightRequests.cancelTurn(session.sessionKey, turnId).settled;
    },
    revokeSessionToken: (token: string) => {
      const session = sessionRegistry.verify(token);
      sessionRegistry.revoke(token);
      nativeToolCalls.revoke(token);
      if (session) inFlightRequests.revokeSession(session.sessionKey);
    },
    connectionForThread: (threadId: ThreadId) => {
      const issued = sessionRegistry.issue(threadId, "codex");
      return {
        url: "http://127.0.0.1:48123/mcp",
        bearerToken: issued.token,
      };
    },
  } as unknown as AgentGatewayCredentialsShape;
  const tokenAliases = new Map<string, string>();
  const sessionKeyAliases = new Map<string, string>();
  const leases = new Map<string, AgentGatewaySessionLease>();
  const startRuntime = (threadId: string, tokenAlias: string): AgentGatewaySessionLease => {
    const lease = acquireAgentGatewaySessionLease(
      credentials,
      ThreadId.makeUnsafe(threadId),
      "codex",
      input.leaseCapabilities ?? AGENT_GATEWAY_NO_CAPABILITIES,
    );
    if (!lease) throw new Error("Expected gateway session lease");
    tokenAliases.set(tokenAlias, lease.connection.bearerToken);
    const session = sessionRegistry.verify(lease.connection.bearerToken);
    if (!session) throw new Error("Expected registered gateway session");
    sessionKeyAliases.set(`session-${leases.size + 1}`, session.sessionKey);
    leases.set(threadId, lease);
    return lease;
  };
  input.threads.forEach((thread, index) => {
    startRuntime(String(thread.id), `token-${index + 1}`);
  });
  (input.ghostThreads ?? []).forEach((threadId, index) => {
    startRuntime(threadId, `token-ghost-${index + 1}`);
  });
  const snapshotQuery = {
    getThreadShellById: (threadId: ThreadId) =>
      Effect.succeed(Option.fromNullishOr(threads.get(String(threadId)))),
  } as unknown as ProjectionSnapshotQueryShape;

  const transport = makeAgentGatewayMcpTransport({
    credentials,
    snapshotQuery,
    tools: input.tools,
    instructions: "test",
    requireThreadShell: (threadId) => {
      const thread = threads.get(threadId);
      return thread ? Effect.succeed(thread) : Effect.fail(new InjectedFailure("missing thread"));
    },
  });
  return Object.assign(transport, {
    leases,
    resolveToken: (token: string) => tokenAliases.get(token) ?? token,
    cancelTurn: (sessionKey: string, turnId: string) =>
      inFlightRequests.cancelTurn(sessionKeyAliases.get(sessionKey) ?? sessionKey, turnId),
    setThreadTurnState: (
      threadId: string,
      state: "running" | "completed" | "error" | "interrupted",
    ) => {
      const thread = threads.get(threadId);
      if (!thread?.latestTurn) return;
      threads.set(threadId, {
        ...thread,
        latestTurn: {
          ...thread.latestTurn,
          state,
          completedAt: state === "running" ? null : NOW,
        },
      });
    },
    completeTurnAndRestartRuntime: async (
      threadId: string,
      completedTurnId: string,
      replacementTokenAlias: string,
    ) => {
      const outgoing = leases.get(threadId);
      if (!outgoing) throw new Error("Expected outgoing gateway session lease");
      await outgoing.retireTurn(completedTurnId);
      outgoing.release();
      startRuntime(threadId, replacementTokenAlias);
    },
    setThreadTurn: (threadId: string, turnId: string) => {
      const thread = threads.get(threadId);
      if (!thread?.latestTurn) return;
      threads.set(threadId, {
        ...thread,
        latestTurn: {
          ...thread.latestTurn,
          turnId: TurnId.makeUnsafe(turnId),
          state: "running",
          completedAt: null,
        },
      });
    },
  });
}

const post = (transport: ReturnType<typeof makeTransport>, token: string, body: unknown) =>
  transport({ authorizationHeader: `Bearer ${transport.resolveToken(token)}`, body });

describe("makeAgentGatewayMcpTransport cancellation", () => {
  it.effect(
    "rejects turn A's credential after production completion and restart admit turn B",
    () =>
      Effect.gen(function* () {
        let handlerCalls = 0;
        const transport = makeTransport({
          threads: [makeThread("thread-rotated")],
          tools: [
            {
              definition: {
                name: "glade_test_write",
                description: "test",
                inputSchema: { type: "object" },
              },
              requiredCapability: "thread:write",
              requiresActiveTurn: true,
              handler: () => {
                handlerCalls += 1;
                return Effect.succeed({ content: [{ type: "text" as const, text: "ok" }] });
              },
            },
          ],
        });
        yield* Effect.promise(() =>
          transport.completeTurnAndRestartRuntime(
            "thread-rotated",
            "turn-thread-rotated",
            "token-b",
          ),
        );
        transport.setThreadTurn("thread-rotated", "turn-b");
        const body = {
          jsonrpc: "2.0",
          id: "test-write",
          method: "tools/call",
          params: { name: "glade_test_write", arguments: {} },
        };

        const lateA = yield* post(transport, "token-1", body);
        assert.equal(lateA.status, 401);
        const turnB = yield* post(transport, "token-b", body);
        assert.equal(turnB.status, 200);
        assert.equal(handlerCalls, 1);
      }),
  );

  it.effect(
    "cancels a detached MCP call by gateway session and turn without a client notification",
    () =>
      Effect.gen(function* () {
        const hostStarted = yield* Deferred.make<void>();
        const hostAbortObserved = yield* Deferred.make<void>();
        let hostCalls = 0;
        const waitingTool: ToolEntry = {
          definition: {
            name: "glade_test_wait",
            description: "test",
            inputSchema: { type: "object" },
          },
          requiredCapability: "thread:write",
          requiresActiveTurn: true,
          handler: () => {
            hostCalls += 1;
            return Effect.promise(
              (signal) =>
                new Promise<never>(() => {
                  signal.addEventListener(
                    "abort",
                    () => Deferred.doneUnsafe(hostAbortObserved, Effect.void),
                    { once: true },
                  );
                  Deferred.doneUnsafe(hostStarted, Effect.void);
                }),
            );
          },
        };
        const transport = makeTransport({
          threads: [makeThread("thread-detached")],
          tools: [waitingTool],
        });
        const body = {
          jsonrpc: "2.0",
          id: "detached-wait",
          method: "tools/call",
          params: { name: "glade_test_wait", arguments: {} },
        };

        const request = yield* post(transport, "token-1", body).pipe(Effect.forkChild);
        yield* Deferred.await(hostStarted);

        const cancellation = transport.cancelTurn("session-1", "turn-thread-detached");
        assert.equal(cancellation.count, 1);
        yield* Effect.promise(() => cancellation.settled);
        yield* Deferred.await(hostAbortObserved);
        assert.deepEqual(yield* Fiber.join(request), { status: 202 });

        // A detached cell can race and issue the request after Stop. The turn tombstone must reject it
        // before the handler starts.
        assert.deepEqual(yield* post(transport, "token-1", { ...body, id: "late-request" }), {
          status: 202,
        });
        transport.setThreadTurnState("thread-detached", "interrupted");
        const afterProjectionSettled = yield* post(transport, "token-1", {
          ...body,
          id: "after-turn-terminal",
        });
        assert.equal(afterProjectionSettled.status, 200);
        assert.equal(hostCalls, 1);
      }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("cleans a completed request before the same JSON-RPC id is reused", () =>
    Effect.gen(function* () {
      const transport = makeTransport({
        threads: [makeThread("thread-reuse")],
        tools: [
          {
            definition: {
              name: "unused",
              description: "unused",
              inputSchema: { type: "object" },
            },
            requiredCapability: "thread:read",
            handler: () => Effect.never,
          },
        ],
      });
      const ping = { jsonrpc: "2.0", id: "reusable", method: "ping" };

      for (let iteration = 0; iteration < 25; iteration += 1) {
        const response = yield* post(transport, "token-1", ping);
        assert.deepEqual(response, {
          status: 200,
          body: { jsonrpc: "2.0", id: "reusable", result: {} },
        });
      }
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect(
    "interrupts only the matching session request and keeps a following ping responsive",
    () =>
      Effect.gen(function* () {
        const startedOne = yield* Deferred.make<void>();
        const startedTwo = yield* Deferred.make<void>();
        const interruptedOne = yield* Deferred.make<void>();
        const interruptedTwo = yield* Deferred.make<void>();
        const releaseFirstCleanup = yield* Deferred.make<void>();
        const tool: ToolEntry = {
          definition: {
            name: "slow",
            description: "Wait until cancelled",
            inputSchema: { type: "object" },
          },
          requiredCapability: "thread:read",
          handler: (_args, context) => {
            const first = context.callerSessionKey.endsWith(":session-1");
            return Deferred.succeed(first ? startedOne : startedTwo, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Effect.gen(function* () {
                  yield* Deferred.succeed(first ? interruptedOne : interruptedTwo, undefined);
                  if (first) yield* Deferred.await(releaseFirstCleanup);
                }),
              ),
            );
          },
        };
        const transport = makeTransport({
          tools: [tool],
          threads: [makeThread("thread-one"), makeThread("thread-two")],
        });
        const slowBody = {
          jsonrpc: "2.0",
          id: "shared-id",
          method: "tools/call",
          params: { name: "slow", arguments: {} },
        };
        const requestOne = yield* post(transport, "token-1", slowBody).pipe(Effect.forkChild);
        const requestTwo = yield* post(transport, "token-2", slowBody).pipe(Effect.forkChild);
        yield* Deferred.await(startedOne);
        yield* Deferred.await(startedTwo);

        const cancellation = yield* post(transport, "token-1", {
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: "shared-id", reason: "test" },
        });
        assert.deepEqual(cancellation, { status: 202 });
        yield* Deferred.await(interruptedOne);
        assert.isUndefined(yield* Deferred.poll(interruptedTwo));

        const ping = yield* post(transport, "token-1", {
          jsonrpc: "2.0",
          id: "ping-after-cancel",
          method: "ping",
        });
        assert.equal(ping.status, 200);
        assert.deepEqual(ping.body, {
          jsonrpc: "2.0",
          id: "ping-after-cancel",
          result: {},
        });
        assert.isUndefined(requestOne.pollUnsafe());
        yield* Deferred.succeed(releaseFirstCleanup, undefined);

        yield* post(transport, "token-2", {
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: "shared-id" },
        });
        yield* Deferred.await(interruptedTwo);
        assert.deepEqual(yield* Fiber.join(requestOne), { status: 202 });
        assert.deepEqual(yield* Fiber.join(requestTwo), { status: 202 });
      }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect(
    "runs batch requests concurrently and applies cancellation without head-of-line blocking",
    () =>
      Effect.gen(function* () {
        const interrupted = yield* Deferred.make<void>();
        const transport = makeTransport({
          threads: [makeThread("thread-batch")],
          tools: [
            {
              definition: {
                name: "slow",
                description: "Wait until cancelled",
                inputSchema: { type: "object" },
              },
              requiredCapability: "thread:read",
              handler: () =>
                Effect.never.pipe(
                  Effect.onInterrupt(() =>
                    Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid),
                  ),
                ),
            },
          ],
        });

        const response = yield* post(transport, "token-1", [
          {
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: { requestId: "slow-batch" },
          },
          {
            jsonrpc: "2.0",
            id: "slow-batch",
            method: "tools/call",
            params: { name: "slow", arguments: {} },
          },
          { jsonrpc: "2.0", id: "fast-batch", method: "ping" },
        ]);

        yield* Deferred.await(interrupted);
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, [{ jsonrpc: "2.0", id: "fast-batch", result: {} }]);
      }).pipe(Effect.timeout("2 seconds")),
  );
});

const findToolOrThrow = (tools: ReadonlyArray<unknown>, name: string): Record<string, unknown> => {
  const found = tools.find((candidate) => isRecord(candidate) && candidate.name === name);
  if (!isRecord(found)) {
    throw new Error(`Expected tools/list to serve ${name}.`);
  }
  return found;
};

describe("makeAgentGatewayMcpTransport tools/list schema sanitization", () => {
  it.effect("advertises object unions as MCP object inputs and preserves branch validation", () =>
    Effect.gen(function* () {
      const transport = makeTransport({
        threads: [makeThread("thread-union")],
        tools: [
          {
            definition: {
              name: "glade_open_in_app",
              description: "Open a workspace surface",
              inputSchema: toolInputSchema(GladeAppOpenInput),
            },
            requiredCapability: "thread:read",
            handler: () => Effect.succeed({ content: [{ type: "text" as const, text: "opened" }] }),
          },
        ],
      });
      const response = yield* post(transport, "token-1", {
        jsonrpc: "2.0",
        id: "union-list",
        method: "tools/list",
      });
      const tool = findToolOrThrow(listedTools(response.body), "glade_open_in_app");
      assert.equal((tool.inputSchema as Record<string, unknown>).type, "object");
      for (const args of [
        { kind: "file", path: "README.md" },
        { kind: "diff" },
        { kind: "terminal" },
      ]) {
        const call = yield* post(transport, "token-1", toolCallBody("glade_open_in_app", args));
        assert.equal(
          (call.body as { result: { content: Array<{ text: string }> } }).result.content[0]?.text,
          "opened",
        );
      }
      const invalid = yield* post(
        transport,
        "token-1",
        toolCallBody("glade_open_in_app", { kind: "file" }),
      );
      assert.equal((invalid.body as { error: { code: number } }).error.code, -32602);
    }),
  );

  it.effect("serves sanitized schemas while keeping stored definitions dirty", () =>
    Effect.gen(function* () {
      const recursiveTool: ToolEntry = {
        definition: {
          name: "glade_recursive",
          description: "tool with a cyclic schema",
          inputSchema: {
            type: "object",
            properties: { payload: { $ref: "#/$defs/JsonValue" } },
            $defs: {
              JsonValue: {
                anyOf: [
                  { type: "string" },
                  { type: "array", items: { $ref: "#/$defs/JsonValue" } },
                ],
              },
            },
          },
        },
        requiredCapability: "thread:read",
        handler: () => Effect.succeed({ content: [{ type: "text" as const, text: "ok" }] }),
      };
      const transport = makeTransport({
        threads: [makeThread("thread-schema")],
        tools: [recursiveTool],
      });
      const response = yield* post(transport, "token-1", {
        jsonrpc: "2.0",
        id: "list-schemas",
        method: "tools/list",
      });
      assert.equal(response.status, 200);
      if (!isRecord(response.body) || !isRecord(response.body.result)) {
        throw new Error("Expected tools/list to answer with a result object.");
      }
      if (!Array.isArray(response.body.result.tools)) {
        throw new Error("Expected tools/list to answer with a tools array.");
      }
      const listed = findToolOrThrow(response.body.result.tools, "glade_recursive");
      assert.deepEqual(listed.inputSchema, {
        type: "object",
        properties: {
          payload: {
            type: "object",
            description: FALLBACK_OBJECT_DESCRIPTION,
          },
        },
      });
      assert.isAbove(countSchemaKeyOccurrences(recursiveTool.definition.inputSchema, "$ref"), 0);
    }),
  );
});

function listedTools(body: unknown): ReadonlyArray<Record<string, unknown>> {
  const result = (body as { result?: { tools?: ReadonlyArray<Record<string, unknown>> } }).result;
  return result?.tools ?? [];
}

describe("makeAgentGatewayMcpTransport tools/list", () => {
  const ok = () => Effect.succeed({ content: [{ type: "text" as const, text: "ok" }] });
  const catalog: ReadonlyArray<ToolEntry> = [
    {
      definition: {
        name: "glade_context",
        description: "Read current context",
        inputSchema: { type: "object" },
      },
      requiredCapability: "thread:read",
      handler: ok,
    },
    {
      definition: {
        name: "glade_test_hinted",
        description: "Hinted",
        inputSchema: { type: "object" },
        annotations: { title: "Hinted" },
        _meta: { "anthropic/searchHint": "test hint" },
      },
      requiredCapability: "thread:read",
      handler: ok,
    },
  ];
  const listBody = { jsonrpc: "2.0", id: "list", method: "tools/list" };

  it.effect(
    "applies eager loading to core tools and preserves search hints on deferred tools",
    () =>
      Effect.gen(function* () {
        const transport = makeTransport({ threads: [makeThread("thread-hinted")], tools: catalog });
        const response = yield* post(transport, "token-1", listBody);
        assert.equal(response.status, 200);
        const tools = listedTools(response.body);
        assert.deepEqual(
          tools.map((tool) => tool.name),
          ["glade_context", "glade_test_hinted"],
        );
        assert.deepEqual(tools[1], {
          name: "glade_test_hinted",
          description: "Hinted",
          inputSchema: { type: "object" },
          annotations: { title: "Hinted" },
          _meta: { "anthropic/alwaysLoad": false, "anthropic/searchHint": "test hint" },
        });
        assert.deepEqual(tools[0]!._meta, { "anthropic/alwaysLoad": true });
      }),
  );

  it.effect("withholds discovery-only tools from the list but still dispatches them", () =>
    Effect.gen(function* () {
      const discoveryCatalog: ReadonlyArray<ToolEntry> = [
        ...catalog,
        {
          definition: {
            name: "glade_test_hidden",
            description: "Hidden",
            inputSchema: { type: "object" },
          },
          requiredCapability: "thread:read",
          discoveryOnly: true,
          handler: ok,
        },
      ];
      const transport = makeTransport({
        threads: [makeThread("thread-discovery")],
        tools: discoveryCatalog,
      });
      const listResponse = yield* post(transport, "token-1", listBody);
      assert.equal(listResponse.status, 200);
      assert.deepEqual(
        listedTools(listResponse.body).map((tool) => tool.name),
        ["glade_context", "glade_test_hinted"],
      );
      const callResponse = yield* post(transport, "token-1", toolCallBody("glade_test_hidden"));
      assert.equal(callResponse.status, 200);
      assert.equal(
        (callResponse.body as { result: { content: Array<{ text: string }> } }).result.content[0]
          ?.text,
        "ok",
      );
    }),
  );
});

const toolCallBody = (name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id: `call-${name}`,
  method: "tools/call",
  params: { name, arguments: args },
});

const rpcErrorOf = (response: { body?: unknown }): { code: number; message: string } =>
  (response.body as { error: { code: number; message: string } }).error;

const authorityDataOf = (response: { body?: unknown }): { code: string; retry: string } =>
  (response.body as { data: { code: string; retry: string } }).data;

describe("makeAgentGatewayMcpTransport session authority", () => {
  it.effect("reports structured authority codes with retry rules", () =>
    Effect.gen(function* () {
      const transport = makeTransport({
        threads: [
          makeThread("thread-authority"),
          {
            ...makeThread("thread-mismatch"),
            session: {
              threadId: ThreadId.makeUnsafe("thread-mismatch"),
              status: "running",
              providerName: "claudeAgent",
              runtimeMode: "full-access",
              activeTurnId: TurnId.makeUnsafe("turn-thread-mismatch"),
              lastError: null,
              updatedAt: NOW,
            },
          },
        ],
        ghostThreads: ["thread-ghost"],
        tools: [],
      });
      const listBody = { jsonrpc: "2.0", id: "list", method: "tools/list" };
      const missing = yield* transport({ authorizationHeader: undefined, body: listBody });
      assert.equal(missing.status, 401);
      assert.deepEqual(authorityDataOf(missing), {
        code: "revoked-token",
        retry: "reauthenticate",
      });
      assert.include(rpcErrorOf(missing).message, "Do not retry with this token");
      const invalid = yield* transport({ authorizationHeader: "Bearer nope", body: listBody });
      assert.equal(invalid.status, 401);
      assert.deepEqual(authorityDataOf(invalid), {
        code: "revoked-token",
        retry: "reauthenticate",
      });
      const gone = yield* post(transport, "token-ghost-1", listBody);
      assert.equal(gone.status, 401);
      assert.deepEqual(authorityDataOf(gone), { code: "thread-gone", retry: "do-not-retry" });
      assert.include(rpcErrorOf(gone).message, "Do not retry");

      const mismatch = yield* post(transport, "token-2", listBody);
      assert.equal(mismatch.status, 401);
      assert.deepEqual(authorityDataOf(mismatch), {
        code: "provider-mismatch",
        retry: "re-lease",
      });
      assert.include(rpcErrorOf(mismatch).message, "Do not retry with this token");
    }),
  );
});

describe("native MCP turn provenance", () => {
  it.effect(
    "keeps a session alive while rejecting stale, missing and mismatched call proofs in one batch",
    () =>
      Effect.gen(function* () {
        const handled: string[] = [];
        const transport = makeTransport({
          threads: [makeThread("native")],
          leaseCapabilities: { nativeToolCallScope: true },
          tools: [
            {
              definition: { name: "write", description: "Write", inputSchema: { type: "object" } },
              requiredCapability: "thread:write",
              requiresActiveTurn: true,
              handler: (_args, context) =>
                Effect.sync(() => {
                  handled.push(context.callerTurnId!);
                  return { content: [{ type: "text" as const, text: "done" }] };
                }),
            },
          ],
        });
        const lease = transport.leases.get("native")!;
        lease.registerNativeToolCall!({ callId: "old", turnId: "turn-native", toolName: "write" });
        transport.setThreadTurn("native", "next");
        lease.registerNativeToolCall!({ callId: "new", turnId: "next", toolName: "write" });
        lease.registerNativeToolCall!({ callId: "other", turnId: "next", toolName: "different" });
        const result = yield* post(
          transport,
          "token-1",
          ["old", "new", "other", null].map((callId, id) => ({
            jsonrpc: "2.0",
            id,
            method: "tools/call",
            params: { name: "write", arguments: {}, ...(callId ? { _meta: { callId } } : {}) },
          })),
        );
        assert.equal(result.status, 200);
        assert.deepEqual(handled, ["next"]);
        assert.equal((result.body as unknown[]).length, 4);
        yield* Effect.promise(() => lease.retireTurn("next"));
        transport.setThreadTurn("native", "third");
        lease.registerNativeToolCall!({ callId: "third-call", turnId: "third", toolName: "write" });
        yield* post(transport, "token-1", {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "write", _meta: { callId: "third-call" } },
        });
        assert.deepEqual(handled, ["next", "third"]);
      }),
  );
});

describe("MCP input trust boundary", () => {
  it.effect("rejects invalid and undeclared arguments before executing a handler", () =>
    Effect.gen(function* () {
      let calls = 0;
      const transport = makeTransport({
        threads: [makeThread("schema-validation")],
        tools: [
          {
            requiredCapability: "thread:write",
            requiresActiveTurn: true,
            definition: {
              name: "validated",
              description: "Validated mutation",
              inputSchema: {
                type: "object",
                properties: { count: { type: "integer", minimum: 1, maximum: 100 } },
                required: ["count"],
                additionalProperties: false,
              },
            },
            handler: () =>
              Effect.sync(() => {
                calls++;
                return { content: [{ type: "text", text: "ok" }] };
              }),
          },
        ],
      });
      for (const args of [
        null,
        [],
        { count: 1.5 },
        { count: 101 },
        { count: 1, permissions: "full-access" },
      ]) {
        const response = yield* post(transport, "token-1", {
          jsonrpc: "2.0",
          id: "invalid",
          method: "tools/call",
          params: { name: "validated", arguments: args },
        });
        assert.isTrue(
          isRecord(response.body) &&
            isRecord(response.body.error) &&
            response.body.error.code === -32602,
        );
      }
      assert.equal(calls, 0);
      const response = yield* post(transport, "token-1", {
        jsonrpc: "2.0",
        id: "valid",
        method: "tools/call",
        params: { name: "validated", arguments: { count: 1 } },
      });
      assert.equal(response.status, 200);
      assert.equal(calls, 1);
    }),
  );
});
