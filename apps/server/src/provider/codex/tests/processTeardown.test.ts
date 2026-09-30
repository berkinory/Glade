import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { CodexAppServerManager } from "../codexAppServerManager";
import { CodexAppServerTransportError } from "../codexAppServerTransport";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { CodexProcessPool } from "../processPool/codexProcessPool";
import {
  AGENT_GATEWAY_NO_CAPABILITIES,
  acquireAgentGatewaySessionLease,
} from "../../../agentGateway/sessionLease.ts";

class FakeCodexChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();

  constructor(readonly pid: number) {
    super();
  }
}

async function createTeardownContext(
  threadId: ThreadId,
  child: FakeCodexChild,
  manager: CodexAppServerManager,
) {
  const processLease = await (
    manager as unknown as { processPool: CodexProcessPool }
  ).processPool.acquire({
    binaryPath: "codex",
    cwd: "/repo",
    env: {},
    argv: ["app-server"],
  });
  return {
    session: {
      provider: "codex",
      status: "ready",
      threadId,
      runtimeMode: "full-access",
      lastError: undefined as string | undefined,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
    },
    account: { type: "unknown", planType: null, sparkEnabled: true },
    child,
    processLease,
    stdinWriter: processLease.writer,
    pending: new Map(),
    pendingApprovals: new Map(),
    pendingUserInputs: new Map(),
    collabReceiverTurns: new Map(),
    collabReceiverParents: new Map(),
    reviewTurnIds: new Set(),
    stopping: false,
  };
}

describe("Codex app-server teardown", () => {
  it("keeps a live process routable when only the last turn status is error", async () => {
    const child = new FakeCodexChild(5050);
    const manager = new CodexAppServerManager(undefined, {
      spawnAppServer: () => child as unknown as ChildProcessWithoutNullStreams,
      teardownProcessTree: async () => ({ escalated: false, signalErrors: [] }),
    });
    const threadId = ThreadId.makeUnsafe("thread-codex-failed-turn");
    const context = await createTeardownContext(threadId, child, manager);
    context.session.status = "error";
    context.session.lastError = "Turn failed";
    const internals = manager as unknown as {
      sessions: Map<ThreadId, unknown>;
      requireSession: (threadId: ThreadId) => unknown;
    };
    internals.sessions.set(threadId, context);

    expect(manager.hasSession(threadId)).toBe(true);
    expect(manager.listSessions()).toEqual([
      expect.objectContaining({ threadId, status: "error" }),
    ]);
    expect(internals.requireSession(threadId)).toBe(context);

    child.stdin.end();

    expect(manager.hasSession(threadId)).toBe(false);
    expect(manager.listSessions()).toEqual([]);
    expect(() => internals.requireSession(threadId)).toThrow("Session is closed");
  });

  it("makes the session unroutable immediately while stop awaits exit proof", async () => {
    const child = new FakeCodexChild(5151);
    let exitProven = false;
    const teardownProcessTree = vi.fn(
      async (input: { readonly rootPid: number; readonly rootExited: Promise<unknown> }) => {
        expect(input.rootPid).toBe(5151);
        await input.rootExited;
        exitProven = true;
        return { escalated: false as const, signalErrors: [] };
      },
    );
    const manager = new CodexAppServerManager(undefined, {
      teardownProcessTree,
      spawnAppServer: () => child as unknown as ChildProcessWithoutNullStreams,
    });
    const threadId = ThreadId.makeUnsafe("thread-codex-exit-proof");
    const revokeSessionToken = vi.fn();
    const gatewaySessionLease = acquireAgentGatewaySessionLease(
      {
        connectionForThread: () => ({
          url: "http://127.0.0.1:48123/mcp",
          bearerToken: "gateway-token",
        }),
        revokeSessionToken,
      },
      threadId,
      "codex",
      AGENT_GATEWAY_NO_CAPABILITIES,
    );
    const context = {
      ...(await createTeardownContext(threadId, child, manager)),
      gatewaySessionLease,
    };
    (
      manager as unknown as {
        sessions: Map<ThreadId, unknown>;
      }
    ).sessions.set(threadId, context);

    const stopping = manager.stopSession(threadId);
    await vi.waitFor(() => expect(teardownProcessTree).toHaveBeenCalledTimes(1));
    expect(revokeSessionToken).toHaveBeenCalledOnce();
    expect(teardownProcessTree).toHaveBeenCalledTimes(1);

    expect(manager.hasSession(threadId)).toBe(false);
    expect(exitProven).toBe(false);

    child.exitCode = 0;
    child.emit("exit", 0, null);
    await stopping;
    expect(revokeSessionToken).toHaveBeenCalledOnce();
    expect(exitProven).toBe(true);
    expect(manager.hasSession(threadId)).toBe(false);
  });

  it("releases the session lease once when the app-server exits spontaneously", async () => {
    const child = new FakeCodexChild(5252);
    const teardownProcessTree = vi.fn(async () => ({
      escalated: false,
      signalErrors: [],
      capturedBeforeRootExit: false,
    }));
    const manager = new CodexAppServerManager(undefined, {
      teardownProcessTree,
      spawnAppServer: () => child as unknown as ChildProcessWithoutNullStreams,
    });
    const threadId = ThreadId.makeUnsafe("thread-codex-spontaneous-exit");
    const revokeSessionToken = vi.fn();
    const gatewaySessionLease = acquireAgentGatewaySessionLease(
      {
        connectionForThread: () => ({
          url: "http://127.0.0.1:48123/mcp",
          bearerToken: "gateway-token",
        }),
        revokeSessionToken,
      },
      threadId,
      "codex",
      AGENT_GATEWAY_NO_CAPABILITIES,
    );
    const context = {
      ...(await createTeardownContext(threadId, child, manager)),
      gatewaySessionLease,
    };
    const internals = manager as unknown as {
      sessions: Map<ThreadId, unknown>;
      attachProcessListeners: (context: unknown) => void;
    };
    internals.sessions.set(threadId, context);
    internals.attachProcessListeners(context);

    child.exitCode = 1;
    child.emit("exit", 1, null);
    child.emit("exit", 1, null);

    expect(revokeSessionToken).toHaveBeenCalledOnce();
    expect(manager.hasSession(threadId)).toBe(false);
    await vi.waitFor(() => expect(internals.sessions.has(threadId)).toBe(false));
    expect(teardownProcessTree).toHaveBeenCalledOnce();
  });
});

describe("CodexAppServerManager discovery", () => {
  it("waits for an in-flight discovery startup before stopAll completes", async () => {
    const manager = new CodexAppServerManager();
    let resolveStartup!: (value: unknown) => void;
    const startup = new Promise<unknown>((resolve) => {
      resolveStartup = resolve;
    });
    vi.spyOn(
      manager as unknown as {
        createDiscoverySession: (cwd: string) => Promise<unknown>;
      },
      "createDiscoverySession",
    ).mockReturnValue(startup);
    const stopDiscoverySession = vi
      .spyOn(
        manager as unknown as {
          stopDiscoverySession: (cwd: string) => Promise<void>;
        },
        "stopDiscoverySession",
      )
      .mockResolvedValue(undefined);

    const pendingStartup = (
      manager as unknown as {
        getOrCreateDiscoverySession: (cwd: string) => Promise<unknown>;
      }
    ).getOrCreateDiscoverySession("/repo");
    (
      manager as unknown as {
        discoverySessions: Map<string, unknown>;
      }
    ).discoverySessions.set("/repo", { status: "connecting" });
    const stopping = manager.stopAll();
    await Promise.resolve();
    expect(stopDiscoverySession).not.toHaveBeenCalled();

    resolveStartup({ discovery: true });
    await expect(Promise.all([pendingStartup, stopping])).resolves.toEqual([
      { discovery: true },
      undefined,
    ]);
    expect(stopDiscoverySession).toHaveBeenCalledWith("/repo");
    expect(stopDiscoverySession).toHaveBeenCalledTimes(1);
  });
});

describe("CodexAppServerManager process teardown", () => {
  it("preserves the first transport failure and its pending operation through teardown", async () => {
    const teardownProcessTree = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    const child = new FakeCodexChild(42_426);
    const manager = new CodexAppServerManager(undefined, {
      teardownProcessTree,
      spawnAppServer: () => child as unknown as ChildProcessWithoutNullStreams,
    });
    const threadId = ThreadId.makeUnsafe("thread-transport-root-cause");
    const rejected = vi.fn();
    const writerClose = vi.fn();
    const events: Array<{ kind: string; method: string; message?: string }> = [];
    manager.on("event", (event) => {
      events.push({
        kind: event.kind,
        method: event.method,
        ...(event.message ? { message: event.message } : {}),
      });
    });
    const context = {
      ...(await createTeardownContext(threadId, child, manager)),
      session: {
        provider: "codex",
        status: "connecting",
        threadId,
        runtimeMode: "full-access",
        createdAt: "2026-09-08T08:03:37.000Z",
        updatedAt: "2026-09-08T08:03:37.000Z",
      },
      account: { type: "unknown", planType: null, sparkEnabled: true },
      child,
      stdinWriter: { close: writerClose },
      pending: new Map([
        [
          "7",
          {
            method: "thread/resume",
            timeout: setTimeout(() => {}, 60_000),
            resolve: vi.fn(),
            reject: rejected,
          },
        ],
      ]),
      pendingApprovals: new Map(),
      pendingUserInputs: new Map(),
      collabReceiverTurns: new Map(),
      collabReceiverParents: new Map(),
      reviewTurnIds: new Set(),
      nextRequestId: 8,
      stopping: false,
      sessionAttemptId: "attempt-transport-root-cause",
    };
    const internals = manager as unknown as {
      sessions: Map<ThreadId, unknown>;
      handleTransportFailure: (context: unknown, cause: unknown) => void;
    };
    internals.sessions.set(threadId, context);

    internals.handleTransportFailure(
      context,
      new CodexAppServerTransportError({
        reason: "frame-too-large",
        observedBytes: 16_842_743,
        maxBytes: 16_777_216,
      }),
    );
    await manager.stopSession(threadId);

    const expectedMessage =
      "Codex app-server JSONL frame exceeded its byte limit (16842743/16777216). Operation: thread/resume.";
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(rejected.mock.calls[0]?.[0]).toMatchObject({ message: expectedMessage });
    expect(writerClose).toHaveBeenCalledWith(expect.objectContaining({ message: expectedMessage }));
    expect(context.session).toMatchObject({ status: "closed", lastError: expectedMessage });
    expect(
      (
        context as typeof context & {
          terminalFailure?: Record<string, unknown>;
        }
      ).terminalFailure,
    ).toMatchObject({
      kind: "frame-too-large",
      operation: "thread/resume",
      observedBytes: 16_842_743,
      limitBytes: 16_777_216,
      source: "transport",
      sessionAttemptId: "attempt-transport-root-cause",
    });
    expect(events.filter((event) => event.kind === "error")).toEqual([
      {
        kind: "error",
        method: "protocol/transportError",
        message: expectedMessage,
      },
    ]);
    expect(events.some((event) => event.message?.includes("Session stopped before"))).toBe(false);
    expect(teardownProcessTree).toHaveBeenCalledTimes(1);
  });

  it("keeps one stop in flight and publishes closed eagerly", async () => {
    let proveExit: (() => void) | undefined;
    const exitProof = new Promise<void>((resolve) => {
      proveExit = resolve;
    });
    const teardownProcessTree = vi.fn(async () => {
      await exitProof;
      return { escalated: false, signalErrors: [] };
    });
    const child = new FakeCodexChild(42_424);
    const manager = new CodexAppServerManager(undefined, {
      teardownProcessTree,
      spawnAppServer: () => child as unknown as ChildProcessWithoutNullStreams,
    });
    const threadId = ThreadId.makeUnsafe("thread-stop-proof");
    const closedEvents: string[] = [];
    manager.on("event", (event) => {
      if (event.method === "session/closed") {
        closedEvents.push(event.method);
      }
    });
    const context = {
      ...(await createTeardownContext(threadId, child, manager)),
      session: {
        provider: "codex",
        status: "ready",
        threadId,
        runtimeMode: "full-access",
        model: "gpt-5.3-codex",
        activeTurnId: "turn-active",
        createdAt: "2026-02-10T00:00:00.000Z",
        updatedAt: "2026-02-10T00:00:00.000Z",
      },
      account: { type: "unknown", planType: null, sparkEnabled: true },
      child,
      pending: new Map(),
      pendingApprovals: new Map(),
      pendingUserInputs: new Map(),
      collabReceiverTurns: new Map(),
      collabReceiverParents: new Map(),
      reviewTurnIds: new Set(),
      stopping: false,
    };
    (
      manager as unknown as {
        sessions: Map<ThreadId, unknown>;
      }
    ).sessions.set(threadId, context);

    const firstStop = manager.stopSession(threadId);
    const concurrentStop = manager.stopSession(threadId);

    await vi.waitFor(() => expect(teardownProcessTree).toHaveBeenCalledTimes(1));

    expect(closedEvents).toEqual(["session/closed"]);
    expect(manager.hasSession(threadId)).toBe(false);
    expect(manager.listSessions()).toHaveLength(0);
    expect(
      (
        manager as unknown as {
          sessions: Map<ThreadId, unknown>;
        }
      ).sessions.has(threadId),
    ).toBe(true);

    proveExit?.();
    await Promise.all([firstStop, concurrentStop]);

    expect(closedEvents).toEqual(["session/closed"]);
    expect(manager.hasSession(threadId)).toBe(false);
    expect(manager.listSessions()).toHaveLength(0);
  });

  it("retains the replacement barrier and retries after teardown proof fails", async () => {
    const teardownProcessTree = vi
      .fn()
      .mockRejectedValueOnce(new Error("rootExited=false; surviving process remains"))
      .mockResolvedValueOnce({
        escalated: true,
        signalErrors: [],
      });
    const child = new FakeCodexChild(42_425);
    const manager = new CodexAppServerManager(undefined, {
      teardownProcessTree,
      spawnAppServer: () => child as unknown as ChildProcessWithoutNullStreams,
    });
    const threadId = ThreadId.makeUnsafe("thread-stop-proof-retry");
    const closedEvents: string[] = [];
    manager.on("event", (event) => {
      if (event.method === "session/closed") {
        closedEvents.push(event.method);
      }
    });
    const context = {
      ...(await createTeardownContext(threadId, child, manager)),
      session: {
        provider: "codex",
        status: "ready",
        threadId,
        runtimeMode: "full-access",
        model: "gpt-5.3-codex",
        createdAt: "2026-02-10T00:00:00.000Z",
        updatedAt: "2026-02-10T00:00:00.000Z",
      },
      account: { type: "unknown", planType: null, sparkEnabled: true },
      child,
      pending: new Map(),
      pendingApprovals: new Map(),
      pendingUserInputs: new Map(),
      collabReceiverTurns: new Map(),
      collabReceiverParents: new Map(),
      reviewTurnIds: new Set(),
      stopping: false,
    };
    (
      manager as unknown as {
        sessions: Map<ThreadId, unknown>;
      }
    ).sessions.set(threadId, context);

    await expect(manager.stopSession(threadId)).rejects.toThrow(
      "Failed to prove Codex app-server process-tree exit",
    );
    expect(manager.hasSession(threadId)).toBe(false);
    expect(manager.listSessions()).toHaveLength(0);
    expect(closedEvents).toEqual(["session/closed"]);

    await manager.stopSession(threadId);
    expect(teardownProcessTree).toHaveBeenCalledTimes(2);
    expect(manager.listSessions()).toHaveLength(0);
    expect(closedEvents).toEqual(["session/closed"]);
  });
});
