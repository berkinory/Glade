import { describe, expect, it, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { ApprovalRequestId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { type RuntimeMode } from "@glade/contracts/provider/sessionPolicy";

import { buildCodexProcessEnv } from "./codexProcessEnv";
import {
  buildCodexThreadOpenRequest,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
  CodexAppServerManager,
} from "./codexAppServerManager";
import { formatMissingCodexWorkingDirectoryError } from "./codexWorkingDirectory";
import {
  CodexAppServerTransportError,
  CodexJsonlFramer,
  CodexJsonlWriter,
} from "./codexAppServerTransport";

import {
  AGENT_GATEWAY_NO_CAPABILITIES,
  AGENT_GATEWAY_TURN_AUTHORITY_RETIRED,
  acquireAgentGatewaySessionLease,
} from "../../agentGateway/sessionLease.ts";
import {
  MINIMUM_CODEX_AUTO_REVIEW_CLI_VERSION,
  MINIMUM_CODEX_EXCLUDE_TURNS_CLI_VERSION,
} from "./codexCliVersion.ts";

const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

type SyntheticCodexRequest = {
  readonly id?: string | number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
};

function createSyntheticCodexAppServer(options?: { readonly forceFullHistoryResponse?: boolean }) {
  const historySentinel = "SYNTHETIC_PRIVATE_HISTORY_SENTINEL";
  const persistedTranscript = Object.freeze([
    Object.freeze({ role: "user", text: historySentinel }),
    Object.freeze({ role: "assistant", text: "synthetic reply" }),
  ]);
  const historyFingerprint = () =>
    createHash("sha256").update(JSON.stringify(persistedTranscript)).digest("hex");
  const requests: SyntheticCodexRequest[] = [];
  const historicalResponses: Array<{ readonly thread: { readonly id: string } }> = [];
  const children: ChildProcessWithoutNullStreams[] = [];
  let oversizedResponseCount = 0;
  let nextPid = 50_000;
  let nextTurn = 1;

  const buildFullHistoryFrame = (id: string | number, providerThreadId: string): Buffer => {
    const targetFrameBytes = 16_842_743;
    const prefix = Buffer.from(
      `{"id":${JSON.stringify(id)},"result":{"thread":{"id":${JSON.stringify(providerThreadId)},"turns":[{"payload":"${historySentinel}`,
      "utf8",
    );
    const suffix = Buffer.from('"}]}}}', "utf8");
    const fillerBytes = targetFrameBytes - prefix.length - suffix.length;
    if (fillerBytes < 0) throw new Error("Synthetic Codex frame prefix exceeds target size");
    return Buffer.concat(
      [prefix, Buffer.alloc(fillerBytes, 0x78), suffix, Buffer.from("\n")],
      targetFrameBytes + 1,
    );
  };

  const spawnAppServer = (): ChildProcessWithoutNullStreams => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdin,
      stdout,
      stderr,
      pid: nextPid++,
      exitCode: null,
      signalCode: null,
      killed: false,
    }) as unknown as ChildProcessWithoutNullStreams;
    children.push(child);

    let bufferedInput = "";
    stdin.on("data", (chunk: Buffer) => {
      bufferedInput += chunk.toString("utf8");
      for (;;) {
        const newline = bufferedInput.indexOf("\n");
        if (newline < 0) break;
        const line = bufferedInput.slice(0, newline);
        bufferedInput = bufferedInput.slice(newline + 1);
        if (!line) continue;
        const request = JSON.parse(line) as SyntheticCodexRequest;
        requests.push(request);
        if (request.id === undefined) continue;

        const respond = (result: unknown) => {
          queueMicrotask(() => stdout.write(`${JSON.stringify({ id: request.id, result })}\n`));
        };
        if (request.method === "initialize") {
          respond({});
        } else if (request.method === "account/read") {
          respond({ account: { type: "apiKey" } });
        } else if (request.method === "thread/resume" || request.method === "thread/fork") {
          const providerThreadId = String(request.params?.threadId ?? "provider-thread");
          if (options?.forceFullHistoryResponse === true || request.params?.excludeTurns !== true) {
            oversizedResponseCount += 1;
            queueMicrotask(() =>
              stdout.write(buildFullHistoryFrame(request.id!, providerThreadId)),
            );
          } else {
            const result = {
              thread: {
                id:
                  request.method === "thread/fork"
                    ? `${providerThreadId}-forked`
                    : providerThreadId,
              },
            };
            historicalResponses.push(result);
            respond(result);
          }
        } else if (request.method === "thread/start") {
          respond({ thread: { id: "fresh-provider-thread" } });
        } else if (request.method === "turn/start") {
          respond({ turn: { id: `synthetic-turn-${nextTurn++}` } });
        } else {
          respond({});
        }
      }
    });

    return child;
  };

  return {
    buildFullHistoryFrame,
    children,
    historyFingerprint,
    historySentinel,
    historicalResponses,
    transcriptSnapshot: () => structuredClone(persistedTranscript),
    requests,
    spawnAppServer,
    get oversizedResponseCount() {
      return oversizedResponseCount;
    },
  };
}

function createSyntheticCodexManager(fake: ReturnType<typeof createSyntheticCodexAppServer>) {
  const teardownProcessTree = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
  const manager = new CodexAppServerManager(undefined, {
    spawnAppServer: fake.spawnAppServer,
    teardownProcessTree,
  });
  const internals = manager as unknown as {
    assertSupportedCodexCliVersion: () => Promise<void>;
    buildSessionProcessEnv: () => Promise<NodeJS.ProcessEnv>;
  };
  vi.spyOn(internals, "assertSupportedCodexCliVersion").mockResolvedValue(undefined);
  vi.spyOn(internals, "buildSessionProcessEnv").mockResolvedValue({});
  return { manager, teardownProcessTree };
}

const fullAccessTurnOverrides = {
  approvalPolicy: "never",
  approvalsReviewer: "user",
  sandboxPolicy: { type: "dangerFullAccess" },
} as const;
const approvalRequiredTurnOverrides = {
  approvalPolicy: "untrusted",
  approvalsReviewer: "user",
  sandboxPolicy: { type: "readOnly" },
} as const;
const autoTurnOverrides = {
  approvalPolicy: "on-request",
  approvalsReviewer: "auto_review",
  sandboxPolicy: { type: "workspaceWrite" },
} as const;

describe("Codex Glade harness policy", () => {
  it("resolves the gateway endpoint when each session environment is built", async () => {
    const homePath = mkdtempSync(path.join(os.tmpdir(), "glade-codex-gateway-endpoint-"));
    const previousGladeHome = process.env.GLADE_HOME;
    process.env.GLADE_HOME = path.join(homePath, "glade-home");
    let endpointUrl = "http://127.0.0.1:0/mcp";
    try {
      const manager = new CodexAppServerManager(undefined, {
        agentGatewayMcp: {
          endpointUrl: () => endpointUrl,
          acquireSessionLease: () => ({
            connection: { url: endpointUrl, bearerToken: "token" },
            cancelTurn: () => Promise.resolve(),
            retireTurn: () => Promise.resolve(),
            release: () => undefined,
          }),
        },
      });
      endpointUrl = "http://127.0.0.1:48123/mcp";
      const env = await (
        manager as unknown as {
          buildSessionProcessEnv: (
            homePath: string | undefined,
            token: string | undefined,
          ) => Promise<NodeJS.ProcessEnv>;
        }
      ).buildSessionProcessEnv(homePath, "token");
      const configPath = path.join(env.CODEX_HOME ?? homePath, "config.toml");
      expect(readFileSync(configPath, "utf8")).toContain('url = "http://127.0.0.1:48123/mcp"');
    } finally {
      if (previousGladeHome === undefined) {
        delete process.env.GLADE_HOME;
      } else {
        process.env.GLADE_HOME = previousGladeHome;
      }
      rmSync(homePath, { recursive: true, force: true });
    }
  });
});

function createSendTurnHarness(runtimeMode: RuntimeMode = "full-access") {
  const manager = new CodexAppServerManager();
  const context = {
    session: {
      provider: "codex",
      status: "ready",
      threadId: "thread_1",
      runtimeMode,
      model: "gpt-5.3-codex",
      activeTurnId: undefined as string | undefined,
      resumeCursor: { threadId: "thread_1" },
      createdAt: "2026-02-10T00:00:00.000Z",
      updatedAt: "2026-02-10T00:00:00.000Z",
    },
    account: {
      type: "unknown",
      planType: null,
      sparkEnabled: true,
    },
    pendingApprovals: new Map(),
    pendingUserInputs: new Map(),
    collabReceiverTurns: new Map(),
    collabReceiverParents: new Map(),
    reviewTurnIds: new Set<string>(),
  };

  const requireSession = vi
    .spyOn(
      manager as unknown as { requireSession: (sessionId: string) => unknown },
      "requireSession",
    )
    .mockReturnValue(context);
  const sendRequest = vi
    .spyOn(
      manager as unknown as { sendRequest: (...args: unknown[]) => Promise<unknown> },
      "sendRequest",
    )
    .mockResolvedValue({
      turn: {
        id: "turn_1",
      },
    });
  const updateSession = vi
    .spyOn(manager as unknown as { updateSession: (...args: unknown[]) => void }, "updateSession")
    .mockImplementation(() => {});

  return { manager, context, requireSession, sendRequest, updateSession };
}

function createThreadControlHarness() {
  const manager = new CodexAppServerManager();
  const context = {
    lifecycleGeneration: "generation-request-a",
    session: {
      provider: "codex",
      status: "ready",
      threadId: "thread_1",
      runtimeMode: "full-access",
      model: "gpt-5.3-codex",
      activeTurnId: undefined as string | undefined,
      resumeCursor: { threadId: "thread_1" },
      createdAt: "2026-02-10T00:00:00.000Z",
      updatedAt: "2026-02-10T00:00:00.000Z",
    },
    pendingApprovals: new Map(),
    pendingUserInputs: new Map(),
    collabReceiverTurns: new Map(),
    collabReceiverParents: new Map(),
    reviewTurnIds: new Set<string>(),
  };

  const requireSession = vi
    .spyOn(
      manager as unknown as { requireSession: (sessionId: string) => unknown },
      "requireSession",
    )
    .mockReturnValue(context);
  const sendRequest = vi.spyOn(
    manager as unknown as { sendRequest: (...args: unknown[]) => Promise<unknown> },
    "sendRequest",
  );
  const updateSession = vi
    .spyOn(manager as unknown as { updateSession: (...args: unknown[]) => void }, "updateSession")
    .mockImplementation(() => {});
  const emitEvent = vi
    .spyOn(manager as unknown as { emitEvent: (...args: unknown[]) => void }, "emitEvent")
    .mockImplementation(() => {});

  return { manager, context, requireSession, sendRequest, updateSession, emitEvent };
}

function createPendingApprovalHarness(runtimeMode: RuntimeMode = "approval-required") {
  const manager = new CodexAppServerManager();
  const context = {
    lifecycleGeneration: "generation-request-a",
    session: {
      provider: "codex",
      status: "ready",
      threadId: "thread_1",
      runtimeMode,
      model: "gpt-5.3-codex",
      activeTurnId: undefined as string | undefined,
      resumeCursor: { threadId: "thread_1" },
      createdAt: "2026-02-10T00:00:00.000Z",
      updatedAt: "2026-02-10T00:00:00.000Z",
    },
    account: {
      type: "unknown",
      planType: null,
      sparkEnabled: true,
    },
    pendingApprovals: new Map([
      [
        ApprovalRequestId.makeUnsafe("req-approval-1"),
        {
          requestId: ApprovalRequestId.makeUnsafe("req-approval-1"),
          jsonRpcId: 42,
          method: "item/commandExecution/requestApproval" as const,
          requestKind: "command" as const,
          threadId: asThreadId("thread_1"),
        },
      ],
    ]),
    pendingUserInputs: new Map(),
    sessionApprovalOverride: undefined as
      | undefined
      | {
          approvalPolicy: "never";
          approvalsReviewer: "user";
          sandboxPolicy: { type: "dangerFullAccess" };
        },
    collabReceiverTurns: new Map(),
    collabReceiverParents: new Map(),
    reviewTurnIds: new Set<string>(),
  };

  const requireSession = vi
    .spyOn(
      manager as unknown as { requireSession: (sessionId: string) => unknown },
      "requireSession",
    )
    .mockReturnValue(context);
  const writeMessage = vi
    .spyOn(
      manager as unknown as { writeMessage: (...args: unknown[]) => Promise<void> },
      "writeMessage",
    )
    .mockResolvedValue(undefined);
  const emitEvent = vi
    .spyOn(manager as unknown as { emitEvent: (...args: unknown[]) => void }, "emitEvent")
    .mockImplementation(() => {});
  const sendRequest = vi
    .spyOn(
      manager as unknown as { sendRequest: (...args: unknown[]) => Promise<unknown> },
      "sendRequest",
    )
    .mockResolvedValue({
      turn: {
        id: "turn_1",
      },
    });
  const updateSession = vi
    .spyOn(manager as unknown as { updateSession: (...args: unknown[]) => void }, "updateSession")
    .mockImplementation(() => {});

  return {
    manager,
    context,
    requireSession,
    writeMessage,
    emitEvent,
    sendRequest,
    updateSession,
  };
}

function createCollabNotificationHarness() {
  const manager = new CodexAppServerManager();
  const context = {
    session: {
      provider: "codex",
      status: "running",
      threadId: asThreadId("thread_1"),
      runtimeMode: "full-access",
      model: "gpt-5.3-codex",
      activeTurnId: "turn_parent",
      resumeCursor: { threadId: "provider_parent" },
      createdAt: "2026-02-10T00:00:00.000Z",
      updatedAt: "2026-02-10T00:00:00.000Z",
    },
    account: {
      type: "unknown",
      planType: null,
      sparkEnabled: true,
    },
    pending: new Map(),
    pendingApprovals: new Map(),
    pendingUserInputs: new Map(),
    sessionApprovalOverride: undefined as
      | undefined
      | {
          approvalPolicy: "never";
          approvalsReviewer: "user";
          sandboxPolicy: { type: "dangerFullAccess" };
        },
    collabReceiverTurns: new Map<string, string>(),
    collabReceiverParents: new Map<string, string>(),
    reviewTurnIds: new Set<string>(),
    gatewayCredentialRetired: false,
    nextRequestId: 1,
    stopping: false,
  };

  const emitEvent = vi
    .spyOn(manager as unknown as { emitEvent: (...args: unknown[]) => void }, "emitEvent")
    .mockImplementation(() => {});
  const updateSession = vi
    .spyOn(manager as unknown as { updateSession: (...args: unknown[]) => void }, "updateSession")
    .mockImplementation(() => {});
  const requireSession = vi
    .spyOn(
      manager as unknown as { requireSession: (threadId: ThreadId) => unknown },
      "requireSession",
    )
    .mockReturnValue(context);
  const writeMessage = vi
    .spyOn(
      manager as unknown as { writeMessage: (...args: unknown[]) => Promise<void> },
      "writeMessage",
    )
    .mockResolvedValue(undefined);

  return { manager, context, emitEvent, updateSession, requireSession, writeMessage };
}

function handleServerNotificationForTest(
  manager: CodexAppServerManager,
  context: unknown,
  notification: Record<string, unknown>,
): void {
  (
    manager as unknown as {
      handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
    }
  ).handleServerNotification(context, notification);
}

async function handleServerRequestForTest(
  manager: CodexAppServerManager,
  context: unknown,
  request: Record<string, unknown>,
): Promise<void> {
  await (
    manager as unknown as {
      handleServerRequest: (context: unknown, request: Record<string, unknown>) => Promise<void>;
    }
  ).handleServerRequest(context, request);
}

describe("Codex app-server teardown", () => {
  it("keeps a live process routable when only the last turn status is error", () => {
    class FakeCodexChild extends EventEmitter {
      readonly pid = 5050;
      exitCode: number | null = null;
      signalCode: NodeJS.Signals | null = null;
      killed = false;
      readonly stdin = new PassThrough();
      readonly stdout = new PassThrough();
      readonly stderr = new PassThrough();
    }
    const child = new FakeCodexChild();
    const manager = new CodexAppServerManager();
    const threadId = asThreadId("thread-codex-failed-turn");
    const context = {
      session: {
        provider: "codex",
        status: "error",
        threadId,
        runtimeMode: "full-access",
        lastError: "Turn failed",
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
      },
      account: { type: "unknown", planType: null, sparkEnabled: true },
      child,
      stdoutFramer: new CodexJsonlFramer(),
      stdinWriter: new CodexJsonlWriter(child.stdin),
      pending: new Map(),
      pendingApprovals: new Map(),
      pendingUserInputs: new Map(),
      collabReceiverTurns: new Map(),
      collabReceiverParents: new Map(),
      reviewTurnIds: new Set(),
      nextRequestId: 1,
      stopping: false,
    };
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
    class FakeCodexChild extends EventEmitter {
      readonly pid = 5151;
      exitCode: number | null = null;
      signalCode: NodeJS.Signals | null = null;
      readonly stdin = new PassThrough();
      readonly stdout = new PassThrough();
      readonly stderr = new PassThrough();
    }
    const child = new FakeCodexChild();
    let exitProven = false;
    const teardownProcessTree = vi.fn(
      async (input: { readonly rootPid: number; readonly rootExited: Promise<unknown> }) => {
        expect(input.rootPid).toBe(5151);
        await input.rootExited;
        exitProven = true;
        return { escalated: false as const, signalErrors: [] };
      },
    );
    const manager = new CodexAppServerManager(undefined, { teardownProcessTree });
    const threadId = asThreadId("thread-codex-exit-proof");
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
      gatewaySessionLease,
      session: {
        provider: "codex",
        status: "ready",
        threadId,
        runtimeMode: "full-access",
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
      },
      account: { type: "unknown", planType: null, sparkEnabled: true },
      child,
      stdoutFramer: new CodexJsonlFramer(),
      stdinWriter: new CodexJsonlWriter(child.stdin),
      pending: new Map(),
      pendingApprovals: new Map(),
      pendingUserInputs: new Map(),
      collabReceiverTurns: new Map(),
      collabReceiverParents: new Map(),
      reviewTurnIds: new Set(),
      nextRequestId: 1,
      stopping: false,
    };
    (
      manager as unknown as {
        sessions: Map<ThreadId, unknown>;
      }
    ).sessions.set(threadId, context);

    const stopping = manager.stopSession(threadId);
    await Promise.resolve();
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
    class FakeCodexChild extends EventEmitter {
      readonly pid = 5252;
      exitCode: number | null = null;
      signalCode: NodeJS.Signals | null = null;
      readonly stdin = new PassThrough();
      readonly stdout = new PassThrough();
      readonly stderr = new PassThrough();
    }
    const child = new FakeCodexChild();
    const teardownProcessTree = vi.fn(async () => ({
      escalated: false,
      signalErrors: [],
      capturedBeforeRootExit: false,
    }));
    const manager = new CodexAppServerManager(undefined, { teardownProcessTree });
    const threadId = asThreadId("thread-codex-spontaneous-exit");
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
      gatewaySessionLease,
      session: {
        provider: "codex",
        status: "ready",
        threadId,
        runtimeMode: "full-access",
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
      },
      account: { type: "unknown", planType: null, sparkEnabled: true },
      child,
      stdoutFramer: new CodexJsonlFramer(),
      stdinWriter: new CodexJsonlWriter(child.stdin),
      pending: new Map(),
      pendingApprovals: new Map(),
      pendingUserInputs: new Map(),
      collabReceiverTurns: new Map(),
      collabReceiverParents: new Map(),
      reviewTurnIds: new Set(),
      nextRequestId: 1,
      stopping: false,
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

describe("buildCodexProcessEnv", () => {
  it("hydrates the active custom provider env_key from the effective CODEX_HOME", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "glade-codex-env-"));
    try {
      writeFileSync(
        path.join(tempDir, "config.toml"),
        [
          'model_provider = "my-company-proxy"',
          "",
          '[model_providers."my-company-proxy"]',
          'env_key = "MY_COMPANY_PROXY_KEY"',
        ].join("\n"),
        "utf8",
      );

      const readEnvironment = vi.fn(() => ({
        PATH: "/opt/homebrew/bin:/usr/bin",
        SSH_AUTH_SOCK: "/tmp/ssh.sock",
        MY_COMPANY_PROXY_KEY: "proxy-secret",
      }));

      const env = await buildCodexProcessEnv({
        env: {
          SHELL: "/bin/zsh",
          PATH: "/usr/bin",
        },
        homePath: tempDir,
        platform: "darwin",
        readEnvironment,
      });

      expect(readEnvironment).toHaveBeenCalledWith("/bin/zsh", [
        "PATH",
        "SSH_AUTH_SOCK",
        "MY_COMPANY_PROXY_KEY",
      ]);
      expect(env.CODEX_HOME).toContain("codex-home-overlay");
      expect(env.MY_COMPANY_PROXY_KEY).toBe("proxy-secret");
      expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps the private desktop browser host out of the Codex process", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "glade-codex-private-host-"));
    const codexHome = path.join(tempDir, "codex-home");
    mkdirSync(codexHome, { recursive: true });
    try {
      const env = await buildCodexProcessEnv({
        env: {
          CODEX_HOME: codexHome,
          GLADE_HOME: tempDir,
          GLADE_BROWSER_HOST_PIPE_PATH: "/tmp/glade-browser-host.sock",
          GLADE_BROWSER_USE_PIPE_PATH: "/tmp/legacy-browser-use.sock",
          GLADE_BROWSER_HOST_CAPABILITY: "desktop-capability",
          GLADE_BROWSER_HOST_CAPABILITY_FD: "3",
          NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS: "/tmp/existing.sock",
        },
        platform: "darwin",
      });

      expect(env.GLADE_BROWSER_HOST_PIPE_PATH).toBeUndefined();
      expect(env.GLADE_BROWSER_USE_PIPE_PATH).toBeUndefined();
      expect(env.GLADE_BROWSER_HOST_CAPABILITY).toBeUndefined();
      expect(env.GLADE_BROWSER_HOST_CAPABILITY_FD).toBeUndefined();
      expect(env.NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps Codex SQLite state out of Glade's Codex home overlay", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "glade-codex-env-"));
    const runtimeHome = mkdtempSync(path.join(os.tmpdir(), "glade-runtime-home-"));
    const lstatOrUndefined = (target: string) => {
      try {
        return lstatSync(target);
      } catch {
        return undefined;
      }
    };
    try {
      writeFileSync(path.join(tempDir, "config.toml"), 'model = "gpt-5.5"', "utf8");
      writeFileSync(path.join(tempDir, "history.jsonl"), "", "utf8");
      const sourceSqliteEntries = [
        "state_5.sqlite",
        "state_5.sqlite-wal",
        "state_5.sqlite-shm",
        "memories_1.sqlite",
      ];
      for (const entry of sourceSqliteEntries) {
        writeFileSync(path.join(tempDir, entry), "source-db", "utf8");
      }

      const overlayHome = path.join(runtimeHome, "codex-home-overlay");
      mkdirSync(overlayHome, { recursive: true });

      const legacyLinks = ["state_5.sqlite", "thread_history_1.sqlite-wal"];
      for (const entry of legacyLinks) {
        symlinkSync(path.join(tempDir, entry), path.join(overlayHome, entry), "file");
      }
      const staleOverlayDbPath = path.join(overlayHome, "memories_1.sqlite");
      writeFileSync(staleOverlayDbPath, "stale-overlay-db", "utf8");

      const env = await buildCodexProcessEnv({
        env: { GLADE_HOME: runtimeHome },
        homePath: tempDir,
        platform: "darwin",
      });

      expect(env.CODEX_HOME).toBe(overlayHome);
      expect(env.CODEX_SQLITE_HOME).toBe(tempDir);
      for (const entry of [...sourceSqliteEntries, ...legacyLinks]) {
        if (entry === "memories_1.sqlite") continue;
        expect(lstatOrUndefined(path.join(overlayHome, entry))).toBeUndefined();
      }

      expect(lstatSync(staleOverlayDbPath).isSymbolicLink()).toBe(false);
      expect(readFileSync(staleOverlayDbPath, "utf8")).toBe("stale-overlay-db");
      const overlayHistoryPath = path.join(overlayHome, "history.jsonl");
      expect(lstatSync(overlayHistoryPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(overlayHistoryPath)).toBe(path.join(tempDir, "history.jsonl"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(runtimeHome, { recursive: true, force: true });
    }
  });

  it("repairs stale auth.json files in Glade's Codex home overlay", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "glade-codex-env-"));
    const runtimeHome = mkdtempSync(path.join(os.tmpdir(), "glade-runtime-home-"));
    try {
      const sourceAuthPath = path.join(tempDir, "auth.json");
      writeFileSync(path.join(tempDir, "config.toml"), 'model = "gpt-5.5"', "utf8");
      writeFileSync(sourceAuthPath, '{"tokens":{"access_token":"fresh"}}', "utf8");

      const overlayHome = path.join(runtimeHome, "codex-home-overlay");
      const overlayAuthPath = path.join(overlayHome, "auth.json");
      mkdirSync(overlayHome, { recursive: true });
      writeFileSync(overlayAuthPath, '{"tokens":{"access_token":"stale"}}', "utf8");

      const env = await buildCodexProcessEnv({
        env: { GLADE_HOME: runtimeHome },
        homePath: tempDir,
        platform: "darwin",
      });

      expect(env.CODEX_HOME).toBe(overlayHome);
      expect(lstatSync(overlayAuthPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(overlayAuthPath)).toBe(sourceAuthPath);
      expect(readFileSync(overlayAuthPath, "utf8")).toContain("fresh");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(runtimeHome, { recursive: true, force: true });
    }
  });
});

describe("buildCodexThreadOpenRequest", () => {
  const sessionOverrides = {
    model: null,
    cwd: "/tmp/project",
    approvalPolicy: "never" as const,
    approvalsReviewer: "user" as const,
    sandbox: "danger-full-access" as const,
  };

  it("starts a fresh thread with raw events disabled", () => {
    const request = buildCodexThreadOpenRequest({ sessionOverrides });
    expect(request).toEqual({
      method: "thread/start",
      params: {
        ...sessionOverrides,
        experimentalRawEvents: false,
      },
    });
    expect(request.params).not.toHaveProperty("excludeTurns");
  });

  it("rejects conflicting resume and fork sources", () => {
    expect(() =>
      buildCodexThreadOpenRequest({
        forkSourceThreadId: "fork-source",
        resumeThreadId: "resume-source",
        sessionOverrides,
      }),
    ).toThrow("cannot resume and fork at the same time");
  });
});

describe("startSession", () => {
  it("resumes a synthetic large-history thread across restart without replay or payload exposure", async () => {
    const fake = createSyntheticCodexAppServer();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "glade-codex-large-resume-"));
    const beforeFingerprint = fake.historyFingerprint();
    const beforeTranscript = fake.transcriptSnapshot();
    const first = createSyntheticCodexManager(fake);
    const second = createSyntheticCodexManager(fake);
    const eventMessages: string[] = [];
    first.manager.on("event", (event) => {
      if (event.message) eventMessages.push(event.message);
    });
    second.manager.on("event", (event) => {
      if (event.message) eventMessages.push(event.message);
    });

    try {
      const fullHistoryFrame = fake.buildFullHistoryFrame(99, "provider-thread");
      expect(fullHistoryFrame).toHaveLength(16_842_744);
      expect(() => new CodexJsonlFramer().push(fullHistoryFrame)).toThrowError(
        expect.objectContaining({
          reason: "frame-too-large",
          observedBytes: 16_842_743,
          maxBytes: 16_777_216,
        }),
      );
      const firstSession = await first.manager.startSession({
        threadId: asThreadId("thread-synthetic-restart"),
        provider: "codex",
        runtimeMode: "full-access",
        cwd,
        resumeCursor: { threadId: "provider-thread" },
        agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
      });
      expect(firstSession).toMatchObject({
        status: "ready",
        resumeCursor: { threadId: "provider-thread" },
      });
      await first.manager.sendTurn({
        threadId: firstSession.threadId,
        input: "Unfinished original turn",
      });
      await first.manager.stopSession(firstSession.threadId);

      const resumedSession = await second.manager.startSession({
        threadId: asThreadId("thread-synthetic-restart"),
        provider: "codex",
        runtimeMode: "full-access",
        cwd,
        resumeCursor: firstSession.resumeCursor,
        agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
      });
      expect(resumedSession).toMatchObject({
        status: "ready",
        resumeCursor: { threadId: "provider-thread" },
      });
      expect(resumedSession.lastError).toBeUndefined();
      await second.manager.sendTurn({
        threadId: resumedSession.threadId,
        input: "Follow-up after restart",
      });

      const initializeRequests = fake.requests.filter((request) => request.method === "initialize");
      expect(initializeRequests).toHaveLength(2);
      for (const request of initializeRequests) {
        expect(request.params).toMatchObject({ capabilities: { experimentalApi: true } });
      }
      const historicalRequests = fake.requests.filter(
        (request) => request.method === "thread/resume",
      );
      expect(historicalRequests).toHaveLength(2);
      expect(historicalRequests.every((request) => request.params?.excludeTurns === true)).toBe(
        true,
      );
      expect(fake.requests.filter((request) => request.method === "thread/start")).toEqual([]);
      const turnRequests = fake.requests.filter((request) => request.method === "turn/start");
      expect(turnRequests).toHaveLength(2);
      const serializedTurns = JSON.stringify(turnRequests);
      expect(serializedTurns.match(/Unfinished original turn/g)).toHaveLength(1);
      expect(serializedTurns.match(/Follow-up after restart/g)).toHaveLength(1);
      expect(fake.oversizedResponseCount).toBe(0);
      expect(fake.historicalResponses).toHaveLength(2);
      expect(fake.historicalResponses.every((response) => !("turns" in response.thread))).toBe(
        true,
      );
      expect(
        Buffer.byteLength(JSON.stringify({ id: 1, result: fake.historicalResponses[0] }) + "\n"),
      ).toBeLessThan(16_777_216);
      expect(fake.historyFingerprint()).toBe(beforeFingerprint);
      expect(fake.transcriptSnapshot()).toEqual(beforeTranscript);
      expect(fake.transcriptSnapshot().map((entry) => entry.role)).toEqual(["user", "assistant"]);
      expect(eventMessages.join("\n")).not.toContain(fake.historySentinel);
      expect(JSON.stringify(fake.requests)).not.toContain(fake.historySentinel);
      expect(first.teardownProcessTree).toHaveBeenCalledTimes(1);
    } finally {
      await first.manager.stopAll();
      await second.manager.stopAll();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("forks a synthetic large-history thread with a metadata-only response", async () => {
    const fake = createSyntheticCodexAppServer();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "glade-codex-large-fork-"));
    const { manager } = createSyntheticCodexManager(fake);

    try {
      const session = await manager.startSession({
        threadId: asThreadId("thread-synthetic-fork"),
        provider: "codex",
        runtimeMode: "auto",
        cwd,
        forkSourceResumeCursor: { threadId: "provider-source-thread" },
        agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
      });

      expect(session).toMatchObject({
        status: "ready",
        resumeCursor: { threadId: "provider-source-thread-forked" },
      });
      expect(fake.requests.filter((request) => request.method === "thread/fork")).toEqual([
        expect.objectContaining({
          params: expect.objectContaining({
            threadId: "provider-source-thread",
            excludeTurns: true,
          }),
        }),
      ]);
      expect(fake.oversizedResponseCount).toBe(0);
    } finally {
      await manager.stopAll();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps the oversized resume error primary through start failure, exit, and repeated stop", async () => {
    const fake = createSyntheticCodexAppServer({ forceFullHistoryResponse: true });
    const cwd = mkdtempSync(path.join(os.tmpdir(), "glade-codex-root-cause-"));
    const { manager, teardownProcessTree } = createSyntheticCodexManager(fake);
    const events: Array<{ kind: string; method: string; message?: string }> = [];
    manager.on("event", (event) => {
      events.push({
        kind: event.kind,
        method: event.method,
        ...(event.message ? { message: event.message } : {}),
      });
    });
    const expectedMessage =
      "Codex app-server JSONL frame exceeded its byte limit (16842743/16777216). Operation: thread/resume.";

    try {
      const startError = await manager
        .startSession({
          threadId: asThreadId("thread-synthetic-root-cause"),
          provider: "codex",
          runtimeMode: "full-access",
          cwd,
          resumeCursor: { threadId: "provider-thread" },
          agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
        })
        .catch((error: unknown) => error);
      expect(startError).toBeInstanceOf(Error);
      expect(startError).toMatchObject({
        message: expectedMessage,
        cause: expect.objectContaining({
          message: "Codex app-server JSONL frame exceeded its byte limit (16842743/16777216).",
        }),
      });

      const errorSurface: string[] = [];
      const seenErrors = new Set<Error>();
      let currentError: unknown = startError;
      while (currentError instanceof Error && !seenErrors.has(currentError)) {
        seenErrors.add(currentError);
        errorSurface.push(currentError.message);
        currentError = currentError.cause;
      }
      expect(errorSurface.join("\n")).not.toContain(fake.historySentinel);

      expect(fake.oversizedResponseCount).toBe(1);
      expect(events.filter((event) => event.kind === "error")).toEqual([
        {
          kind: "error",
          method: "protocol/transportError",
          message: expectedMessage,
        },
      ]);
      expect(events.some((event) => event.message?.includes("Session stopped before"))).toBe(false);
      expect(events.map((event) => event.message).join("\n")).not.toContain(fake.historySentinel);
      expect(teardownProcessTree).toHaveBeenCalledTimes(1);
      expect(manager.hasSession(asThreadId("thread-synthetic-root-cause"))).toBe(false);

      fake.children[0]?.emit("exit", 1, null);
      await manager.stopSession(asThreadId("thread-synthetic-root-cause"));
      expect(events.filter((event) => event.kind === "error")).toHaveLength(1);
      expect(teardownProcessTree).toHaveBeenCalledTimes(1);
    } finally {
      await manager.stopAll();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps failed fork cleanup visible after an oversized historical response", async () => {
    const fake = createSyntheticCodexAppServer({ forceFullHistoryResponse: true });
    const cwd = mkdtempSync(path.join(os.tmpdir(), "glade-codex-fork-cleanup-"));
    const { manager, teardownProcessTree } = createSyntheticCodexManager(fake);
    const threadId = asThreadId("thread-synthetic-fork-cleanup");
    teardownProcessTree
      .mockRejectedValueOnce(new Error("rootExited=false; surviving fork process remains"))
      .mockResolvedValueOnce({
        escalated: true,
        signalErrors: [],
      });

    try {
      const error = await manager
        .forkThread({
          sourceThreadId: asThreadId("thread-synthetic-fork-source"),
          sourceResumeCursor: { threadId: "provider-source-thread" },
          threadId,
          runtimeMode: "full-access",
          cwd,
        })
        .catch((error: unknown) => error);

      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        message: expect.stringContaining("Failed to prove Codex app-server process-tree exit"),
      });
      expect(fake.oversizedResponseCount).toBe(1);
      expect(manager.hasSession(threadId)).toBe(false);
      expect(
        (
          manager as unknown as {
            sessions: Map<ThreadId, { terminalFailure?: { message: string } }>;
          }
        ).sessions.get(threadId)?.terminalFailure?.message,
      ).toBe(
        "Codex app-server JSONL frame exceeded its byte limit (16842743/16777216). Operation: thread/fork.",
      );
    } finally {
      await manager.stopAll();
      rmSync(cwd, { recursive: true, force: true });
    }
    expect(teardownProcessTree).toHaveBeenCalledTimes(2);
  });

  it("emits session/started after any successful thread open", () => {
    const manager = new CodexAppServerManager();
    const methods: string[] = [];
    manager.on("event", (event) => {
      methods.push(event.method);
    });
    const context = {
      session: {
        provider: "codex" as const,
        status: "connecting" as const,
        threadId: asThreadId("thread-1"),
        runtimeMode: "full-access" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        resumeCursor: undefined as unknown,
      },
    };

    for (const threadOpenMethod of ["thread/start", "thread/resume", "thread/fork"] as const) {
      methods.length = 0;
      (
        manager as unknown as {
          markSessionReadyAfterThreadOpen: (
            context: unknown,
            input: { threadOpenMethod: string; providerThreadId: string },
          ) => void;
        }
      ).markSessionReadyAfterThreadOpen(context, {
        threadOpenMethod,
        providerThreadId: "native-thread-1",
      });
      expect(methods).toEqual(["session/threadOpenResolved", "session/ready", "session/started"]);
      expect(context.session.status).toBe("ready");
      expect(context.session.resumeCursor).toEqual({ threadId: "native-thread-1" });
    }
  });

  it("fails session start with missing-cwd guidance instead of missing Codex CLI", async () => {
    const manager = new CodexAppServerManager();
    const events: Array<{ method: string; kind: string; message?: string }> = [];
    manager.on("event", (event) => {
      events.push({
        method: event.method,
        kind: event.kind,
        ...(event.message ? { message: event.message } : {}),
      });
    });
    const missingCwd = path.join(
      os.tmpdir(),
      `glade-missing-session-cwd-${randomUUID()}`,
      "old-project",
    );

    try {
      await expect(
        manager.startSession({
          threadId: asThreadId("thread-missing-cwd"),
          provider: "codex",
          runtimeMode: "full-access",
          cwd: missingCwd,
          agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
          providerOptions: {
            codex: {
              binaryPath: process.execPath,
            },
          },
        }),
      ).rejects.toThrow(formatMissingCodexWorkingDirectoryError(missingCwd));
      expect(events).toEqual([
        {
          method: "session/startFailed",
          kind: "error",
          message: formatMissingCodexWorkingDirectoryError(missingCwd),
        },
      ]);
      expect(events[0]?.message).not.toMatch(/not installed|not executable/i);
    } finally {
      await manager.stopAll();
    }
  });

  it("requires a Codex CLI version with AI approval-review support for auto mode", async () => {
    const manager = new CodexAppServerManager();
    const versionCheck = vi
      .spyOn(
        manager as unknown as {
          assertSupportedCodexCliVersion: (input: {
            binaryPath: string;
            cwd: string;
            homePath?: string;
            minimumVersion?: string;
          }) => void;
        },
        "assertSupportedCodexCliVersion",
      )
      .mockImplementation((input) => {
        expect(input.minimumVersion).toBe(MINIMUM_CODEX_AUTO_REVIEW_CLI_VERSION);
        throw new Error("Codex Auto version gate");
      });

    try {
      await expect(
        manager.startSession({
          threadId: asThreadId("thread-auto-version"),
          provider: "codex",
          runtimeMode: "auto",
          cwd: process.cwd(),
          agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
        }),
      ).rejects.toThrow("Codex Auto version gate");
      expect(versionCheck).toHaveBeenCalledTimes(1);
    } finally {
      versionCheck.mockRestore();
      await manager.stopAll();
    }
  });

  it("requires excludeTurns support before spawning a resumed Codex session", async () => {
    const spawnAppServer = vi.fn(() => {
      throw new Error("Version gate must run before spawning Codex");
    });
    const manager = new CodexAppServerManager(undefined, { spawnAppServer });
    const versionCheck = vi
      .spyOn(
        manager as unknown as {
          assertSupportedCodexCliVersion: (input: {
            binaryPath: string;
            cwd: string;
            homePath?: string;
            minimumVersion?: string;
            minimumVersionRequirement?: string;
          }) => void;
        },
        "assertSupportedCodexCliVersion",
      )
      .mockImplementation((input) => {
        expect(input.minimumVersion).toBe(MINIMUM_CODEX_EXCLUDE_TURNS_CLI_VERSION);
        expect(input.minimumVersionRequirement).toMatch(/resume|fork/i);
        throw new Error("Codex excludeTurns version gate");
      });

    try {
      await expect(
        manager.startSession({
          threadId: asThreadId("thread-resume-version"),
          provider: "codex",
          runtimeMode: "full-access",
          resumeCursor: { threadId: "provider-thread" },
          agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
        }),
      ).rejects.toThrow("Codex excludeTurns version gate");
      expect(versionCheck).toHaveBeenCalledTimes(1);
      expect(spawnAppServer).not.toHaveBeenCalled();
    } finally {
      versionCheck.mockRestore();
      await manager.stopAll();
    }
  });
});

describe("sendTurn", () => {
  it("clears stale collaboration receiver routing before a new turn", async () => {
    const { manager, context } = createSendTurnHarness();
    context.collabReceiverTurns.set("reused-child", "old-turn");
    context.collabReceiverParents.set("reused-child", "old-parent");

    await manager.sendTurn({
      threadId: asThreadId("thread_1"),
      input: "Start the next turn",
    });

    expect(context.collabReceiverTurns.size).toBe(0);
    expect(context.collabReceiverParents.size).toBe(0);
  });

  it("sends text and image user input items to turn/start", async () => {
    const { manager, context, requireSession, sendRequest, updateSession } =
      createSendTurnHarness();

    const result = await manager.sendTurn({
      threadId: asThreadId("thread_1"),
      input: "Inspect this image",
      attachments: [
        {
          type: "image",
          url: "data:image/png;base64,AAAA",
        },
      ],
      model: "gpt-5.3",
      serviceTier: "fast",
      effort: "high",
    });

    expect(result).toEqual({
      threadId: "thread_1",
      turnId: "turn_1",
      resumeCursor: { threadId: "thread_1" },
    });
    expect(requireSession).toHaveBeenCalledWith("thread_1");
    expect(sendRequest).toHaveBeenCalledWith(context, "turn/start", {
      threadId: "thread_1",
      ...fullAccessTurnOverrides,
      summary: "auto",
      input: [
        {
          type: "text",
          text: "Inspect this image",
          text_elements: [],
        },
        {
          type: "image",
          url: "data:image/png;base64,AAAA",
        },
      ],
      model: "gpt-5.3-codex",
      serviceTier: "fast",
      effort: "high",
    });
    expect(updateSession).toHaveBeenCalledWith(context, {
      status: "running",
      activeTurnId: "turn_1",
      resumeCursor: { threadId: "thread_1" },
    });
  });

  it("uses approval-required Codex overrides on turn/start", async () => {
    const { manager, context, sendRequest } = createSendTurnHarness("approval-required");

    await manager.sendTurn({
      threadId: asThreadId("thread_1"),
      input: "Check this before changing files",
    });

    expect(sendRequest).toHaveBeenCalledWith(context, "turn/start", {
      threadId: "thread_1",
      ...approvalRequiredTurnOverrides,
      summary: "auto",
      input: [
        {
          type: "text",
          text: "Check this before changing files",
          text_elements: [],
        },
      ],
      model: "gpt-5.3-codex",
    });
  });

  it("routes Codex approvals through the AI reviewer in auto mode", async () => {
    const { manager, context, sendRequest } = createSendTurnHarness("auto");

    await manager.sendTurn({
      threadId: asThreadId("thread_1"),
      input: "Make the routine workspace changes",
    });

    expect(sendRequest).toHaveBeenCalledWith(context, "turn/start", {
      threadId: "thread_1",
      ...autoTurnOverrides,
      summary: "auto",
      input: [
        {
          type: "text",
          text: "Make the routine workspace changes",
          text_elements: [],
        },
      ],
      model: "gpt-5.3-codex",
    });
  });

  it("starts a fresh turn even when the session currently reports running", async () => {
    const { manager, context, sendRequest, updateSession } = createSendTurnHarness();
    context.session.status = "running";
    context.session.activeTurnId = "turn_active";
    sendRequest.mockResolvedValueOnce({
      turn: { id: "turn_next" },
    });

    const result = await manager.sendTurn({
      threadId: asThreadId("thread_1"),
      input: "Focus on the failing tests first",
      attachments: [
        {
          type: "image",
          url: "data:image/png;base64,AAAA",
        },
      ],
      model: "gpt-5.4",
      serviceTier: "fast",
      effort: "high",
      interactionMode: "plan",
    });

    expect(result).toEqual({
      threadId: "thread_1",
      turnId: "turn_next",
      resumeCursor: { threadId: "thread_1" },
    });
    expect(sendRequest).toHaveBeenCalledWith(context, "turn/start", {
      threadId: "thread_1",
      ...fullAccessTurnOverrides,
      summary: "auto",
      input: [
        {
          type: "text",
          text: "Focus on the failing tests first",
          text_elements: [],
        },
        {
          type: "image",
          url: "data:image/png;base64,AAAA",
        },
      ],
      model: "gpt-5.4",
      serviceTier: "fast",
      effort: "high",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.4",
          reasoning_effort: "high",
          developer_instructions: CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
        },
      },
    });
    expect(updateSession).toHaveBeenCalledWith(context, {
      status: "running",
      activeTurnId: "turn_next",
      resumeCursor: { threadId: "thread_1" },
    });
  });
});

describe("steerTurn", () => {
  it("steers the active Codex turn when the session is already running", async () => {
    const { manager, context, sendRequest } = createSendTurnHarness();
    context.session.status = "running";
    context.session.activeTurnId = "turn_active";
    context.collabReceiverTurns.set("child_provider_1", "turn_active");
    sendRequest.mockResolvedValueOnce({
      turnId: "turn_active",
    });

    const result = await manager.steerTurn({
      threadId: asThreadId("thread_1"),
      input: "Keep going",
    });

    expect(result).toEqual({
      threadId: "thread_1",
      turnId: "turn_active",
      resumeCursor: { threadId: "thread_1" },
    });
    expect(sendRequest).toHaveBeenCalledWith(context, "turn/steer", {
      threadId: "thread_1",
      input: [
        {
          type: "text",
          text: "Keep going",
          text_elements: [],
        },
      ],
      expectedTurnId: "turn_active",
    });
    expect(context.collabReceiverTurns.get("child_provider_1")).toBe("turn_active");
  });

  it("requires turn/steer to return the active turn id", async () => {
    const { manager, context, sendRequest } = createSendTurnHarness();
    context.session.status = "running";
    context.session.activeTurnId = "turn_active";
    sendRequest.mockResolvedValueOnce({});

    await expect(
      manager.steerTurn({
        threadId: asThreadId("thread_1"),
        input: "Keep going",
      }),
    ).rejects.toThrow("turn/steer response did not include a turn id.");
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

describe("thread checkpoint control", () => {
  it("uses the requested binary and archive for stopped external history reads", async () => {
    const { manager, context, sendRequest } = createThreadControlHarness();
    const discovery = vi
      .spyOn(
        manager as unknown as {
          getOrCreateDiscoverySession: (...args: unknown[]) => Promise<unknown>;
        },
        "getOrCreateDiscoverySession",
      )
      .mockResolvedValue(context);
    const providerOptions = { codex: { binaryPath: "/custom/codex", homePath: "/custom/archive" } };
    sendRequest.mockResolvedValue({ thread: { id: "external", turns: [] } });
    await manager.readExternalThread({
      externalThreadId: "external",
      cwd: "/repo",
      providerOptions,
    });
    expect(discovery).toHaveBeenCalledWith("/repo", providerOptions);
  });
  it("does not spawn a fork runtime after import cancellation during version discovery", async () => {
    const { manager, sendRequest } = createThreadControlHarness();
    let releaseVersionCheck!: () => void;
    let versionCheckStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      versionCheckStarted = resolve;
    });
    vi.spyOn(
      manager as unknown as { assertSupportedCodexCliVersion: () => Promise<void> },
      "assertSupportedCodexCliVersion",
    ).mockImplementation(() => {
      versionCheckStarted();
      return new Promise<void>((resolve) => {
        releaseVersionCheck = resolve;
      });
    });
    const controller = new AbortController();
    const copied = manager.forkThread(
      {
        sourceThreadId: asThreadId("source"),
        threadId: asThreadId("target"),
        sourceResumeCursor: { threadId: "source" },
        cwd: os.tmpdir(),
        runtimeMode: "full-access",
      },
      controller.signal,
    );
    const failure = expect(copied).rejects.toThrow();
    await started;
    controller.abort();
    releaseVersionCheck();
    await failure;
    expect(manager.listSessions()).toEqual([]);
    expect(sendRequest).not.toHaveBeenCalled();
  });
  it("reads full paginated history and preserves native turn timestamps", async () => {
    const { manager, context, sendRequest } = createThreadControlHarness();
    sendRequest
      .mockRejectedValueOnce(
        new Error("includeTurns is not supported for paginated threads; use thread/turns/list"),
      )
      .mockResolvedValueOnce({ thread: { id: "thread_1", cwd: "/repo/source" } })
      .mockResolvedValueOnce({
        data: [
          {
            id: "turn_1",
            itemsView: "full",
            status: "completed",
            startedAt: 1700000000,
            completedAt: 1700000005,
            items: [{ type: "userMessage" }],
          },
        ],
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "turn_2",
            itemsView: "full",
            status: "completed",
            items: [{ type: "agentMessage", text: "done" }],
          },
        ],
        nextCursor: null,
      });
    const result = await manager.readThread(asThreadId("thread_1"));
    expect(result.cwd).toBe("/repo/source");
    expect(result.turns).toEqual([
      {
        id: "turn_1",
        status: "completed",
        startedAt: 1700000000,
        completedAt: 1700000005,
        items: [{ type: "userMessage" }],
      },
      { id: "turn_2", status: "completed", items: [{ type: "agentMessage", text: "done" }] },
    ]);
    expect(sendRequest).toHaveBeenNthCalledWith(4, context, "thread/turns/list", {
      threadId: "thread_1",
      itemsView: "full",
      sortDirection: "asc",
      limit: 100,
      cursor: "page-2",
    });
  });

  it("rejects repeated native history cursors instead of looping or truncating silently", async () => {
    const { manager, sendRequest } = createThreadControlHarness();
    sendRequest
      .mockRejectedValueOnce(new Error("full history is unavailable for paginated threads"))
      .mockResolvedValueOnce({ thread: { id: "thread_1" } })
      .mockResolvedValue({ data: [], nextCursor: "same-page" });
    await expect(manager.readThread(asThreadId("thread_1"))).rejects.toThrow("repeated");
    expect(sendRequest).toHaveBeenCalledTimes(4);
  });

  it.each([
    "ordinary",
    "completed",
    "empty",
    "inProgress",
    "legacy-completed",
    "legacy-unknown",
    "legacy-invalid-date",
  ])(
    "forks a provider thread with an explicitly selected Standard tier (%s)",
    async (sourceStatus) => {
      const requireCompletedSource = sourceStatus !== "ordinary";
      const homePath = mkdtempSync(path.join(os.tmpdir(), "glade-codex-fork-tier-"));
      writeFileSync(path.join(homePath, "app-server"), "process.stdin.resume();\n");
      const previousGladeHome = process.env.GLADE_HOME;
      process.env.GLADE_HOME = path.join(homePath, "glade-home");
      const { manager, sendRequest } = createThreadControlHarness();
      vi.spyOn(
        manager as unknown as { assertSupportedCodexCliVersion: () => Promise<void> },
        "assertSupportedCodexCliVersion",
      ).mockResolvedValue(undefined);
      sendRequest.mockResolvedValue({
        thread: {
          id: "thread_forked",
          turns:
            sourceStatus === "empty"
              ? []
              : [
                  {
                    id: "completed-source-turn",
                    ...(sourceStatus.startsWith("legacy-")
                      ? {}
                      : { status: sourceStatus === "ordinary" ? "completed" : sourceStatus }),
                    ...(sourceStatus === "legacy-completed" ? { completedAt: 1700000005 } : {}),
                    ...(sourceStatus === "legacy-invalid-date" ? { completedAt: "invalid" } : {}),
                    items: [],
                  },
                ],
        },
      });

      try {
        const fork = manager.forkThread({
          sourceThreadId: asThreadId("thread_1"),
          sourceResumeCursor: {
            threadId: "thread_1",
          },
          threadId: asThreadId("thread_2"),
          lifecycleGeneration: "import-generation",
          requireCompletedSource,
          cwd: homePath,
          providerOptions: { codex: { binaryPath: process.execPath, homePath } },
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
            options: { fastMode: false },
          },
          runtimeMode: "full-access",
        });
        if (["inProgress", "legacy-unknown", "legacy-invalid-date"].includes(sourceStatus)) {
          await expect(fork).rejects.toThrow("finish its turn");
          expect(sendRequest.mock.calls.some(([, method]) => method === "thread/fork")).toBe(false);
          return;
        }
        const result = await fork;

        const forkRequest = sendRequest.mock.calls.find(([, method]) => method === "thread/fork");
        expect(forkRequest?.[2]).toMatchObject({
          threadId: "thread_1",
          deferGoalContinuation: true,
          serviceTier: "default",
          approvalPolicy: "never",
          sandbox: "danger-full-access",
        });
        expect(forkRequest?.[2]).toMatchObject(
          requireCompletedSource
            ? {
                ...(sourceStatus === "empty" ? {} : { lastTurnId: "completed-source-turn" }),
                excludeTurns: true,
              }
            : {},
        );
        expect(forkRequest?.[0]).toMatchObject({ lifecycleGeneration: "import-generation" });
        expect(
          sendRequest.mock.calls.some(
            ([, method]) => method === "thread/resume" || method === "turn/start",
          ),
        ).toBe(false);
        expect(result).toEqual({
          threadId: "thread_2",
          resumeCursor: {
            threadId: "thread_forked",
          },
        });
      } finally {
        await manager.stopAll();
        if (previousGladeHome === undefined) {
          delete process.env.GLADE_HOME;
        } else {
          process.env.GLADE_HOME = previousGladeHome;
        }
        rmSync(homePath, { recursive: true, force: true });
      }
    },
  );

  it("rolls back turns via thread/rollback and resets session running state", async () => {
    const { manager, context, sendRequest, updateSession } = createThreadControlHarness();
    sendRequest.mockResolvedValue({
      thread: {
        id: "thread_1",
        turns: [],
      },
    });

    const result = await manager.rollbackThread(asThreadId("thread_1"), 2);

    expect(sendRequest).toHaveBeenCalledWith(context, "thread/rollback", {
      threadId: "thread_1",
      numTurns: 2,
    });
    expect(updateSession).toHaveBeenCalledWith(context, {
      status: "ready",
      activeTurnId: undefined,
    });
    expect(result).toEqual({
      threadId: "thread_1",
      cwd: null,
      turns: [],
    });
  });

  it("uses the exclusive native turn boundary when paginated Codex replaces rollback", async () => {
    const { manager, context, sendRequest } = createThreadControlHarness();
    sendRequest.mockImplementation(async (_context, method) => {
      if (method === "thread/rollback") throw new Error("unknown variant `thread/rollback`");
      if (method === "thread/read")
        return {
          thread: {
            id: "thread_1",
            turns: [
              { id: "kept", items: [] },
              { id: "edited", items: [] },
              { id: "removed", items: [] },
            ],
          },
        };
      if (method === "thread/revert") return { thread: { id: "thread_1", turns: [] } };
      throw new Error(`Unexpected request: ${method}`);
    });
    const result = await manager.rollbackThread(asThreadId("thread_1"), 2);
    expect(sendRequest).toHaveBeenCalledWith(context, "thread/revert", {
      threadId: "thread_1",
      beforeTurnId: "edited",
    });
    expect(result.turns.map((turn) => turn.id)).toEqual(["kept"]);
  });

  it("does not treat a failed native rollback as permission to discard history", async () => {
    const { manager, sendRequest } = createThreadControlHarness();
    sendRequest.mockRejectedValue(new Error("rollback failed: storage unavailable"));
    await expect(manager.rollbackThread(asThreadId("thread_1"), 1)).rejects.toThrow(
      "storage unavailable",
    );
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  it("cancels the exact gateway turn even when Codex omits MCP cancellation notifications", async () => {
    const { manager, context, sendRequest } = createThreadControlHarness();
    let settleCancellation: (() => void) | undefined;
    const cancelTurn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settleCancellation = resolve;
        }),
    );
    const release = vi.fn();
    context.session.status = "running";
    context.session.activeTurnId = "turn-with-live-browser-wait";
    Object.assign(context, {
      gatewaySessionLease: {
        connection: {
          url: "http://127.0.0.1:48123/mcp",
          bearerToken: "gateway-token",
        },
        cancelTurn,
        retireTurn: vi.fn(() => Promise.resolve()),
        release,
      },
    });
    sendRequest.mockResolvedValue({});

    let interruptSettled = false;
    const interrupt = manager.interruptTurn(asThreadId("thread_1")).then(() => {
      interruptSettled = true;
    });
    await vi.waitFor(() => expect(cancelTurn).toHaveBeenCalledOnce());
    await Promise.resolve();

    expect(interruptSettled).toBe(false);
    expect(cancelTurn).toHaveBeenCalledWith("turn-with-live-browser-wait");
    expect(release).toHaveBeenCalledOnce();
    expect(sendRequest).toHaveBeenCalledWith(context, "turn/interrupt", {
      threadId: "thread_1",
      turnId: "turn-with-live-browser-wait",
    });
    settleCancellation?.();
    await interrupt;
    expect(interruptSettled).toBe(true);
  });

  it("tombstones the parent gateway turn when stopping one collab child", async () => {
    const { manager, context, sendRequest } = createThreadControlHarness();
    const cancelTurn = vi.fn(() => Promise.resolve());
    const release = vi.fn();
    context.session.status = "running";
    context.session.activeTurnId = "turn-parent";
    Object.assign(context, {
      gatewaySessionLease: {
        connection: {
          url: "http://127.0.0.1:48123/mcp",
          bearerToken: "gateway-token",
        },
        cancelTurn,
        retireTurn: vi.fn(() => Promise.resolve()),
        release,
      },
    });
    sendRequest.mockResolvedValue({});

    await manager.interruptTurn(
      asThreadId("thread_1"),
      TurnId.makeUnsafe("turn-child"),
      "provider-child",
    );

    expect(cancelTurn).toHaveBeenCalledOnce();
    expect(cancelTurn).toHaveBeenCalledWith("turn-parent");
    expect(release).toHaveBeenCalledOnce();
    expect(sendRequest).toHaveBeenCalledWith(context, "turn/interrupt", {
      threadId: "provider-child",
      turnId: "turn-child",
    });
  });
});

describe("respondToRequest", () => {
  it("keeps acceptForSession active for later Codex turns", async () => {
    const { manager, context, requireSession, writeMessage, emitEvent, sendRequest } =
      createPendingApprovalHarness();

    await manager.respondToRequest(
      asThreadId("thread_1"),
      ApprovalRequestId.makeUnsafe("req-approval-1"),
      "acceptForSession",
    );

    expect(requireSession).toHaveBeenCalledWith("thread_1");
    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 42,
      result: {
        decision: "acceptForSession",
      },
    });
    expect(context.sessionApprovalOverride).toEqual(fullAccessTurnOverrides);
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "item/requestApproval/decision",
        lifecycleGeneration: "generation-request-a",
        requestKind: "command",
        payload: {
          requestId: "req-approval-1",
          requestKind: "command",
          decision: "acceptForSession",
        },
      }),
    );

    await manager.sendTurn({
      threadId: asThreadId("thread_1"),
      input: "Continue without asking again",
    });

    expect(sendRequest).toHaveBeenLastCalledWith(context, "turn/start", {
      threadId: "thread_1",
      ...fullAccessTurnOverrides,
      summary: "auto",
      input: [
        {
          type: "text",
          text: "Continue without asking again",
          text_elements: [],
        },
      ],
      model: "gpt-5.3-codex",
    });
  });

  it("auto-resolves later approval requests during an always-allowed Codex session", async () => {
    const { manager, context, writeMessage, emitEvent } = createPendingApprovalHarness();

    await manager.respondToRequest(
      asThreadId("thread_1"),
      ApprovalRequestId.makeUnsafe("req-approval-1"),
      "acceptForSession",
    );
    writeMessage.mockClear();
    emitEvent.mockClear();

    await (
      manager as unknown as {
        handleServerRequest: (context: unknown, request: Record<string, unknown>) => Promise<void>;
      }
    ).handleServerRequest(context, {
      jsonrpc: "2.0",
      id: 99,
      method: "item/fileChange/requestApproval",
      params: {
        turnId: "turn_2",
        itemId: "item_file_change",
        path: "apps/web/src/components/chat/ComposerPendingApprovalActions.tsx",
      },
    });

    expect(context.pendingApprovals.size).toBe(0);
    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 99,
      result: {
        decision: "acceptForSession",
      },
    });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "notification",
        method: "item/requestApproval/decision",
        turnId: "turn_2",
        itemId: "item_file_change",
        requestKind: "file-change",
        payload: expect.objectContaining({
          requestKind: "file-change",
          decision: "acceptForSession",
        }),
      }),
    );
    expect(
      emitEvent.mock.calls.some(([event]) => (event as { kind?: string }).kind === "request"),
    ).toBe(false);
  });

  it("keeps later permission-profile requests interactive during an always-allowed session", async () => {
    const { manager, context, writeMessage, emitEvent } = createPendingApprovalHarness();
    const permissions = {
      network: { enabled: true },
      fileSystem: { read: ["/tmp/example"] },
    };

    await manager.respondToRequest(
      asThreadId("thread_1"),
      ApprovalRequestId.makeUnsafe("req-approval-1"),
      "acceptForSession",
    );
    writeMessage.mockClear();
    emitEvent.mockClear();

    await handleServerRequestForTest(manager, context, {
      id: 100,
      method: "item/permissions/requestApproval",
      params: {
        turnId: "turn_2",
        itemId: "item_permissions",
        permissions,
      },
    });

    expect(context.pendingApprovals.size).toBe(1);
    expect(Array.from(context.pendingApprovals.values())[0]).toEqual(
      expect.objectContaining({
        method: "item/permissions/requestApproval",
        requestedPermissions: permissions,
      }),
    );
    expect(writeMessage).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "request",
        method: "item/permissions/requestApproval",
        requestKind: "permissions",
      }),
    );
  });

  it("does not sweep a pending permission-profile request into always allow", async () => {
    const { manager, context, writeMessage } = createPendingApprovalHarness();
    const permissions = {
      network: { enabled: true },
    };

    await handleServerRequestForTest(manager, context, {
      id: 101,
      method: "item/permissions/requestApproval",
      params: {
        turnId: "turn_1",
        itemId: "item_permissions",
        permissions,
      },
    });
    const permissionRequestId = Array.from(context.pendingApprovals.keys()).find(
      (requestId) => requestId !== "req-approval-1",
    );
    if (permissionRequestId === undefined) {
      throw new Error("Expected the permission-profile request to remain pending.");
    }

    await manager.respondToRequest(
      asThreadId("thread_1"),
      ApprovalRequestId.makeUnsafe("req-approval-1"),
      "acceptForSession",
    );

    expect(context.pendingApprovals.has(permissionRequestId)).toBe(true);
    expect(writeMessage).not.toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        id: 101,
      }),
    );
  });

  it("leaves pending MCP tool approvals alone when a command is accepted for the session", async () => {
    const { manager, context, writeMessage } = createPendingApprovalHarness();

    await handleServerRequestForTest(manager, context, {
      id: 100,
      method: "mcpServer/elicitation/request",
      params: {
        turnId: "turn_2",
        mode: "form",
        message: "Approve this tool call",
        _meta: {
          codex_approval_kind: "mcp_tool_call",
          persist: ["session"],
          tool_name: "computer_launch_app",
          tool_params_display: [{ name: "app", value: "kcalc" }],
        },
      },
    });

    const mcpRequest = [...context.pendingApprovals.values()].find(
      (request) => String(request.method) === "mcpServer/elicitation/request",
    );
    if (!mcpRequest) {
      throw new Error("Expected the MCP tool approval to remain pending.");
    }

    await manager.respondToRequest(
      asThreadId("thread_1"),
      ApprovalRequestId.makeUnsafe("req-approval-1"),
      "acceptForSession",
    );

    expect(context.pendingApprovals.has(mcpRequest.requestId)).toBe(true);
    expect(writeMessage).not.toHaveBeenCalledWith(context, expect.objectContaining({ id: 100 }));
  });
});

describe("MCP tool call elicitation approvals", () => {
  const approvalParams = (persist: ReadonlyArray<string> | string = ["session"]) => ({
    threadId: "provider_parent",
    turnId: "turn_mcp",
    serverName: "glade",
    mode: "form",
    message: "Allow Glade to launch the calculator?",
    requestedSchema: { type: "object", properties: {} },
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      persist,
      tool_name: "computer_launch_app",
      tool_params: { app: "kcalc" },
      tool_params_display: [{ name: "app", value: "kcalc", display_name: "app" }],
    },
  });

  function computerApprovalHarness() {
    const harness = createCollabNotificationHarness();
    const context = Object.assign(harness.context, {
      enableComputerControl: true,
      activeInteractionMode: "default",
      gatewaySessionLease: { release: vi.fn() } as { release: () => void } | undefined,
    });
    context.session.runtimeMode = "approval-required";
    context.session.activeTurnId = "turn_mcp";
    return { ...harness, context };
  }

  it("delegates exact active Glade Computer calls to gateway consent without persistent permission", async () => {
    const { manager, context, emitEvent, writeMessage } = computerApprovalHarness();
    for (const toolName of ["computer_click", "computer_type_text", "computer_read_clipboard"]) {
      const params = approvalParams();
      params._meta.tool_name = toolName;
      await handleServerRequestForTest(manager, context, {
        id: toolName,
        method: "mcpServer/elicitation/request",
        params,
      });
      expect(writeMessage).toHaveBeenCalledWith(context, {
        id: toolName,
        result: { action: "accept", content: null, _meta: null },
      });
    }
    expect(context.pendingApprovals.size).toBe(0);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it.each([
    "other-server",
    "disabled",
    "no-lease",
    "retired",
    "stopping",
    "inactive",
    "stale-turn",
    "child-thread",
    "plan",
  ])("preserves provider approval for %s requests", async (condition) => {
    const { manager, context, emitEvent, writeMessage } = computerApprovalHarness();
    const params = approvalParams();
    switch (condition) {
      case "other-server":
        params.serverName = "other";
        break;
      case "disabled":
        context.enableComputerControl = false;
        break;
      case "no-lease":
        context.gatewaySessionLease = undefined;
        break;
      case "retired":
        context.gatewayCredentialRetired = true;
        break;
      case "stopping":
        context.stopping = true;
        break;
      case "inactive":
        context.session.status = "ready";
        break;
      case "stale-turn":
        params.turnId = "turn_old";
        break;
      case "child-thread":
        params.threadId = "provider_child";
        break;
      case "plan":
        context.activeInteractionMode = "plan";
        break;
    }
    await handleServerRequestForTest(manager, context, {
      id: 74,
      method: "mcpServer/elicitation/request",
      params,
    });
    expect(context.pendingApprovals.size).toBe(1);
    expect(writeMessage).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "request", requestKind: "tool" }),
    );
  });

  it("tracks approval elicitations as tool requests and accepts them with the MCP response shape", async () => {
    const { manager, context, emitEvent, writeMessage } = createCollabNotificationHarness();

    await handleServerRequestForTest(manager, context, {
      id: 70,
      method: "mcpServer/elicitation/request",
      params: approvalParams(),
    });

    const pendingRequest = Array.from(context.pendingApprovals.values())[0];
    expect(pendingRequest).toEqual(
      expect.objectContaining({
        method: "mcpServer/elicitation/request",
        requestKind: "tool",
        mcpSessionPersistenceAdvertised: true,
      }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "request",
        requestKind: "tool",
        payload: expect.objectContaining({
          _meta: expect.objectContaining({
            tool_name: "computer_launch_app",
            tool_params_display: [{ name: "app", value: "kcalc", display_name: "app" }],
          }),
        }),
      }),
    );

    await manager.respondToRequest(asThreadId("thread_1"), pendingRequest.requestId, "accept");

    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 70,
      result: { action: "accept", content: null, _meta: null },
    });
  });

  it.each([
    ["acceptForSession", ["session"], { persist: "session" }],
    ["acceptForSession", ["always"], null],
    ["acceptForSession", "session", { persist: "session" }],
  ] as const)(
    "maps %s with persist=%j to the protocol response",
    async (decision, persist, meta) => {
      const { manager, context, writeMessage } = createCollabNotificationHarness();

      await handleServerRequestForTest(manager, context, {
        id: 71,
        method: "mcpServer/elicitation/request",
        params: approvalParams(persist),
      });
      const pendingRequest = Array.from(context.pendingApprovals.values())[0];
      await manager.respondToRequest(asThreadId("thread_1"), pendingRequest.requestId, decision);

      expect(writeMessage).toHaveBeenCalledWith(context, {
        id: 71,
        result: { action: "accept", content: null, _meta: meta },
      });
    },
  );
});

describe("collab child conversation routing", () => {
  it("tracks the current collabToolCall receiver shape", () => {
    const { manager, context } = createCollabNotificationHarness();

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "item/started",
      params: {
        item: {
          type: "collabToolCall",
          id: "call_collab_current",
          receiverThreadId: "child_provider_current",
        },
        threadId: "provider_parent",
        turnId: "turn_parent",
      },
    });

    expect(context.collabReceiverTurns.get("child_provider_current")).toBe("turn_parent");
    expect(context.collabReceiverParents.get("child_provider_current")).toBe("provider_parent");
  });

  it("preserves child notification turn ids and annotates the parent turn", () => {
    const { manager, context, emitEvent } = createCollabNotificationHarness();

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "item/completed",
      params: {
        item: {
          type: "collabAgentToolCall",
          id: "call_collab_1",
          receiverThreadIds: ["child_provider_1"],
        },
        threadId: "provider_parent",
        turnId: "turn_parent",
      },
    });

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "child_provider_1",
        turnId: "turn_child_1",
        itemId: "msg_child_1",
        delta: "working",
      },
    });

    expect(emitEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "item/agentMessage/delta",
        turnId: "turn_child_1",
        parentTurnId: "turn_parent",
        itemId: "msg_child_1",
        providerThreadId: "child_provider_1",
        providerParentThreadId: "provider_parent",
      }),
    );
  });

  it("preserves an inferred child approval route through the decision event", async () => {
    const { manager, context, emitEvent, writeMessage } = createCollabNotificationHarness();

    await handleServerRequestForTest(manager, context, {
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "child_provider_unmapped",
        turnId: "turn_child_unmapped",
        itemId: "call_child_unmapped",
        command: "bun install",
      },
    });

    const pendingRequest = Array.from(context.pendingApprovals.values())[0];
    expect(pendingRequest).toEqual(
      expect.objectContaining({
        providerThreadId: "child_provider_unmapped",
        providerParentThreadId: "provider_parent",
      }),
    );
    await manager.respondToRequest(asThreadId("thread_1"), pendingRequest.requestId, "accept");

    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 42,
      result: { decision: "accept" },
    });
    expect(emitEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "request",
        method: "item/commandExecution/requestApproval",
        turnId: "turn_child_unmapped",
        providerThreadId: "child_provider_unmapped",
        providerParentThreadId: "provider_parent",
      }),
    );
    expect(emitEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: "notification",
        method: "item/requestApproval/decision",
        turnId: "turn_child_unmapped",
        providerThreadId: "child_provider_unmapped",
        providerParentThreadId: "provider_parent",
      }),
    );
  });

  it("responds to permission-profile approvals with the requested native permissions", async () => {
    const { manager, context, emitEvent, writeMessage } = createCollabNotificationHarness();
    const permissions = {
      network: { enabled: true },
      fileSystem: { read: ["/tmp/example"] },
    };

    await handleServerRequestForTest(manager, context, {
      id: 45,
      method: "item/permissions/requestApproval",
      params: {
        threadId: "provider_parent",
        turnId: "turn_permissions",
        itemId: "call_permissions",
        reason: "Needs package metadata",
        permissions,
      },
    });

    const pendingRequest = Array.from(context.pendingApprovals.values())[0];
    expect(pendingRequest).toEqual(
      expect.objectContaining({
        method: "item/permissions/requestApproval",
        requestKind: "permissions",
        requestedPermissions: permissions,
      }),
    );
    await manager.respondToRequest(
      asThreadId("thread_1"),
      pendingRequest.requestId,
      "acceptForSession",
    );

    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 45,
      result: { permissions, scope: "session" },
    });
    expect(context.sessionApprovalOverride).toBeUndefined();
    expect(emitEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "item/requestApproval/decision",
        requestKind: "permissions",
      }),
    );
  });

  it("preserves an unmapped child user-input route through the answered event", async () => {
    const { manager, context, emitEvent, writeMessage } = createCollabNotificationHarness();

    await handleServerRequestForTest(manager, context, {
      id: 43,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "child_provider_unmapped",
        turnId: "turn_child_unmapped",
        itemId: "tool_child_unmapped",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which scope should this change target?",
            options: [{ label: "child", description: "Only the child thread" }],
          },
        ],
      },
    });

    const pendingRequest = Array.from(context.pendingUserInputs.values())[0];
    expect(pendingRequest).toEqual(
      expect.objectContaining({
        providerThreadId: "child_provider_unmapped",
        providerParentThreadId: "provider_parent",
      }),
    );
    await manager.respondToUserInput(asThreadId("thread_1"), pendingRequest.requestId, {
      scope: "child",
    });

    expect(writeMessage).toHaveBeenCalledWith(context, {
      id: 43,
      result: {
        answers: {
          scope: { answers: ["child"] },
        },
      },
    });
    expect(emitEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "request",
        method: "item/tool/requestUserInput",
        providerThreadId: "child_provider_unmapped",
        providerParentThreadId: "provider_parent",
      }),
    );
    expect(emitEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: "notification",
        method: "item/tool/requestUserInput/answered",
        providerThreadId: "child_provider_unmapped",
        providerParentThreadId: "provider_parent",
      }),
    );
  });

  it("preserves child approval requests and annotates the parent turn", async () => {
    const { manager, context, emitEvent } = createCollabNotificationHarness();

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "item/completed",
      params: {
        item: {
          type: "collabAgentToolCall",
          id: "call_collab_1",
          receiverThreadIds: ["child_provider_1"],
        },
        threadId: "provider_parent",
        turnId: "turn_parent",
      },
    });
    emitEvent.mockClear();

    await (
      manager as unknown as {
        handleServerRequest: (context: unknown, request: Record<string, unknown>) => Promise<void>;
      }
    ).handleServerRequest(context, {
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "child_provider_1",
        turnId: "turn_child_1",
        itemId: "call_child_1",
        command: "bun install",
      },
    });

    expect(Array.from(context.pendingApprovals.values())[0]).toEqual(
      expect.objectContaining({
        turnId: "turn_child_1",
        itemId: "call_child_1",
      }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "item/commandExecution/requestApproval",
        turnId: "turn_child_1",
        parentTurnId: "turn_parent",
        itemId: "call_child_1",
        providerThreadId: "child_provider_1",
        providerParentThreadId: "provider_parent",
      }),
    );
  });
});

describe("handleServerNotification error normalization", () => {
  it("recovers a missing turn/completed after legacy task_complete", () => {
    vi.useFakeTimers();
    try {
      const manager = new CodexAppServerManager(undefined, {
        taskCompleteFallbackGraceMs: 25,
      });
      const harness = createCollabNotificationHarness();
      const context = harness.context;
      const emitEvent = vi
        .spyOn(manager as unknown as { emitEvent: (...args: unknown[]) => void }, "emitEvent")
        .mockImplementation(() => {});
      const cancelTurn = vi.fn(() => Promise.resolve());
      const retireTurn = vi.fn(() => {
        expect(emitEvent).not.toHaveBeenCalled();
        return Promise.resolve();
      });
      Object.assign(context, {
        gatewaySessionLease: {
          connection: {
            url: "http://127.0.0.1:48123/mcp",
            bearerToken: "gateway-token",
          },
          cancelTurn,
          retireTurn,
          release: vi.fn(),
        },
      });
      const updateSession = vi
        .spyOn(
          manager as unknown as { updateSession: (...args: unknown[]) => void },
          "updateSession",
        )
        .mockImplementation(() => {});

      handleServerNotificationForTest(manager, context, {
        method: "codex/event/task_complete",
        params: {
          id: "turn_parent",
          msg: {
            type: "task_complete",
            turn_id: "turn_parent",
            last_agent_message: "Done.",
          },
        },
      });
      vi.advanceTimersByTime(25);

      expect(retireTurn).toHaveBeenCalledOnce();
      expect(retireTurn).toHaveBeenCalledWith("turn_parent");
      expect(cancelTurn).not.toHaveBeenCalled();
      expect(context.gatewayCredentialRetired).toBe(true);
      expect(updateSession).toHaveBeenCalledWith(context, {
        status: "ready",
        activeTurnId: undefined,
        lastError: undefined,
      });
      expect(emitEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          method: "turn/completed",
          turnId: "turn_parent",
          payload: expect.objectContaining({
            recoveredFrom: "codex/event/task_complete",
            [AGENT_GATEWAY_TURN_AUTHORITY_RETIRED]: true,
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("retires gateway authority before publishing every terminal parent-turn notification", () => {
    const terminalNotifications = [
      {
        expectedTurnId: "turn-completed",
        notification: {
          method: "turn/completed",
          params: {
            threadId: "provider_parent",
            turn: { id: "turn-completed", status: "completed" },
          },
        },
      },
      {
        expectedTurnId: "turn-aborted",
        notification: {
          method: "turn/aborted",
          params: {
            threadId: "provider_parent",
            turn: { id: "turn-aborted", status: "interrupted" },
          },
        },
      },
      {
        expectedTurnId: "turn-error",
        notification: {
          method: "error",
          params: {
            threadId: "provider_parent",
            turnId: "turn-error",
            error: { message: "terminal provider failure" },
            willRetry: false,
          },
        },
      },
    ];

    for (const { expectedTurnId, notification } of terminalNotifications) {
      const { manager, context, emitEvent } = createCollabNotificationHarness();
      const cancelTurn = vi.fn(() => Promise.resolve());
      const retireTurn = vi.fn(() => {
        expect(emitEvent).not.toHaveBeenCalled();
        return Promise.resolve();
      });
      Object.assign(context, {
        gatewaySessionLease: {
          connection: {
            url: "http://127.0.0.1:48123/mcp",
            bearerToken: "gateway-token",
          },
          cancelTurn,
          retireTurn,
          release: vi.fn(),
        },
      });

      handleServerNotificationForTest(manager, context, notification);

      expect(retireTurn).toHaveBeenCalledOnce();
      expect(retireTurn).toHaveBeenCalledWith(expectedTurnId);
      expect(cancelTurn).not.toHaveBeenCalled();
      expect(context.gatewayCredentialRetired).toBe(true);
      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            [AGENT_GATEWAY_TURN_AUTHORITY_RETIRED]: true,
          }),
        }),
      );
    }
  });

  it("keeps a proven-call runtime reusable after fencing a completed turn", () => {
    const { manager, context, emitEvent } = createCollabNotificationHarness();
    const registerNativeToolCall = vi.fn();
    const retireTurn = vi.fn(() => Promise.resolve());
    Object.assign(context, {
      gatewaySessionLease: {
        connection: { url: "http://localhost/mcp", bearerToken: "test" },
        registerNativeToolCall,
        retireTurn,
        cancelTurn: vi.fn(),
        release: vi.fn(),
      },
    });
    handleServerNotificationForTest(manager, context, {
      method: "item/started",
      params: {
        threadId: "provider_parent",
        turnId: "turn_parent",
        item: { id: "call-1", type: "mcpToolCall", server: "glade", tool: "write" },
      },
    });
    expect(registerNativeToolCall).toHaveBeenCalledWith({
      callId: "call-1",
      turnId: "turn_parent",
      toolName: "write",
    });
    handleServerNotificationForTest(manager, context, {
      method: "turn/completed",
      params: {
        threadId: "provider_parent",
        turn: { id: "turn_parent", status: "completed" },
      },
    });
    expect(retireTurn).toHaveBeenCalledWith("turn_parent");
    expect(context.gatewayCredentialRetired).not.toBe(true);
    expect(emitEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ [AGENT_GATEWAY_TURN_AUTHORITY_RETIRED]: true }),
      }),
    );
  });

  it("settles native review when review mode exits", () => {
    const { manager, context, updateSession, emitEvent } = createCollabNotificationHarness();
    context.reviewTurnIds.add("turn_parent");
    context.reviewTurnIds.add("turn_child");
    context.session.activeTurnId = "turn_child";

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "item/completed",
      params: {
        item: {
          type: "exitedReviewMode",
          id: "turn_parent",
          review: "The working tree is clean.",
        },
        threadId: "provider_parent",
      },
    });

    expect(updateSession).toHaveBeenCalledWith(context, {
      status: "ready",
      activeTurnId: undefined,
      lastError: undefined,
    });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "notification",
        method: "turn/completed",
        turnId: "turn_child",
        threadId: "thread_1",
        payload: {
          turn: {
            id: "turn_child",
            status: "completed",
          },
        },
      }),
    );
  });

  it("clears the running session turn when Codex aborts a turn", () => {
    const { manager, context, updateSession } = createCollabNotificationHarness();

    (
      manager as unknown as {
        handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void;
      }
    ).handleServerNotification(context, {
      method: "turn/aborted",
      params: {
        threadId: "provider_parent",
        turn: {
          id: "turn_parent",
          status: "interrupted",
        },
      },
    });

    expect(updateSession).toHaveBeenCalledWith(context, {
      status: "ready",
      activeTurnId: undefined,
      lastError: undefined,
    });
  });
});

describe("CodexAppServerManager process teardown", () => {
  it("preserves the first transport failure and its pending operation through teardown", async () => {
    const teardownProcessTree = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    const manager = new CodexAppServerManager(undefined, { teardownProcessTree });
    const threadId = asThreadId("thread-transport-root-cause");
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
      session: {
        provider: "codex",
        status: "connecting",
        threadId,
        runtimeMode: "full-access",
        createdAt: "2026-09-08T08:03:37.000Z",
        updatedAt: "2026-09-08T08:03:37.000Z",
      },
      account: { type: "unknown", planType: null, sparkEnabled: true },
      child: {
        pid: 42_426,
        exitCode: null,
        signalCode: null,
        once: vi.fn(),
        removeListener: vi.fn(),
      },
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
    const manager = new CodexAppServerManager(undefined, { teardownProcessTree });
    const threadId = asThreadId("thread-stop-proof");
    const closedEvents: string[] = [];
    manager.on("event", (event) => {
      if (event.method === "session/closed") {
        closedEvents.push(event.method);
      }
    });
    const context = {
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
      child: {
        pid: 42_424,
        exitCode: null,
        signalCode: null,
        once: vi.fn(),
        removeListener: vi.fn(),
      },
      pending: new Map(),
      pendingApprovals: new Map(),
      pendingUserInputs: new Map(),
      collabReceiverTurns: new Map(),
      collabReceiverParents: new Map(),
      reviewTurnIds: new Set(),
      nextRequestId: 1,
      stopping: false,
    };
    (
      manager as unknown as {
        sessions: Map<ThreadId, unknown>;
      }
    ).sessions.set(threadId, context);

    const firstStop = manager.stopSession(threadId);
    const concurrentStop = manager.stopSession(threadId);

    expect(teardownProcessTree).toHaveBeenCalledTimes(1);

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
    const manager = new CodexAppServerManager(undefined, { teardownProcessTree });
    const threadId = asThreadId("thread-stop-proof-retry");
    const closedEvents: string[] = [];
    manager.on("event", (event) => {
      if (event.method === "session/closed") {
        closedEvents.push(event.method);
      }
    });
    const context = {
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
      child: {
        pid: 42_425,
        exitCode: null,
        signalCode: null,
        once: vi.fn(),
        removeListener: vi.fn(),
      },
      pending: new Map(),
      pendingApprovals: new Map(),
      pendingUserInputs: new Map(),
      collabReceiverTurns: new Map(),
      collabReceiverParents: new Map(),
      reviewTurnIds: new Set(),
      nextRequestId: 1,
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

describe.skipIf(!process.env.CODEX_BINARY_PATH)("startSession live Codex resume", () => {
  it("keeps prior thread history when resuming with a changed runtime mode", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-live-resume-"));
    writeFileSync(path.join(workspaceDir, "README.md"), "hello\n", "utf8");

    const manager = new CodexAppServerManager();

    try {
      const firstSession = await manager.startSession({
        threadId: asThreadId("thread-live"),
        provider: "codex",
        cwd: workspaceDir,
        runtimeMode: "full-access",
        agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
        providerOptions: {
          codex: {
            ...(process.env.CODEX_BINARY_PATH ? { binaryPath: process.env.CODEX_BINARY_PATH } : {}),
            ...(process.env.CODEX_HOME_PATH ? { homePath: process.env.CODEX_HOME_PATH } : {}),
          },
        },
      });

      const firstTurn = await manager.sendTurn({
        threadId: firstSession.threadId,
        input: `Reply with exactly the word ALPHA ${randomUUID()}`,
      });

      expect(firstTurn.threadId).toBe(firstSession.threadId);

      await vi.waitFor(
        async () => {
          const snapshot = await manager.readThread(firstSession.threadId);
          expect(snapshot.turns.length).toBeGreaterThan(0);
        },
        { timeout: 120_000, interval: 1_000 },
      );

      const firstSnapshot = await manager.readThread(firstSession.threadId);
      const originalThreadId = firstSnapshot.threadId;
      const originalTurnCount = firstSnapshot.turns.length;

      await manager.stopSession(firstSession.threadId);

      const resumedSession = await manager.startSession({
        threadId: firstSession.threadId,
        provider: "codex",
        cwd: workspaceDir,
        runtimeMode: "approval-required",
        resumeCursor: firstSession.resumeCursor,
        agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
        providerOptions: {
          codex: {
            ...(process.env.CODEX_BINARY_PATH ? { binaryPath: process.env.CODEX_BINARY_PATH } : {}),
            ...(process.env.CODEX_HOME_PATH ? { homePath: process.env.CODEX_HOME_PATH } : {}),
          },
        },
      });

      expect(resumedSession.threadId).toBe(originalThreadId);

      const resumedSnapshotBeforeTurn = await manager.readThread(resumedSession.threadId);
      expect(resumedSnapshotBeforeTurn.threadId).toBe(originalThreadId);
      expect(resumedSnapshotBeforeTurn.turns.length).toBeGreaterThanOrEqual(originalTurnCount);

      await manager.sendTurn({
        threadId: resumedSession.threadId,
        input: `Reply with exactly the word BETA ${randomUUID()}`,
      });

      await vi.waitFor(
        async () => {
          const snapshot = await manager.readThread(resumedSession.threadId);
          expect(snapshot.turns.length).toBeGreaterThan(originalTurnCount);
        },
        { timeout: 120_000, interval: 1_000 },
      );
    } finally {
      await manager.stopAll();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 180_000);
});
