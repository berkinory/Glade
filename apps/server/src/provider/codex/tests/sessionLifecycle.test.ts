import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { CodexAppServerManager } from "../codexAppServerManager";
import { AGENT_GATEWAY_NO_CAPABILITIES } from "../../../agentGateway/sessionLease.ts";
import {
  createSyntheticCodexAppServer,
  createSyntheticCodexManager,
} from "./syntheticCodex.testSupport";

describe("startSession", () => {
  it("resumes a synthetic large-history thread across restart without replay or payload exposure", async () => {
    const fake = createSyntheticCodexAppServer();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "glade-codex-large-resume-"));
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
      const firstSession = await first.manager.startSession({
        threadId: ThreadId.makeUnsafe("thread-synthetic-restart"),
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
        threadId: ThreadId.makeUnsafe("thread-synthetic-restart"),
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
      expect(eventMessages.join("\n")).not.toContain(fake.historySentinel);
      expect(JSON.stringify(fake.requests)).not.toContain(fake.historySentinel);
      expect(first.teardownProcessTree).toHaveBeenCalledTimes(1);
    } finally {
      await first.manager.stopAll();
      await second.manager.stopAll();
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
          threadId: ThreadId.makeUnsafe("thread-synthetic-root-cause"),
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
      expect(manager.hasSession(ThreadId.makeUnsafe("thread-synthetic-root-cause"))).toBe(false);

      fake.children[0]?.emit("exit", 1, null);
      await manager.stopSession(ThreadId.makeUnsafe("thread-synthetic-root-cause"));
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
    const threadId = ThreadId.makeUnsafe("thread-synthetic-fork-cleanup");
    teardownProcessTree
      .mockRejectedValueOnce(new Error("rootExited=false; surviving fork process remains"))
      .mockResolvedValueOnce({
        escalated: true,
        signalErrors: [],
      });

    try {
      const error = await manager
        .forkThread({
          sourceThreadId: ThreadId.makeUnsafe("thread-synthetic-fork-source"),
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

  it.each(["thread/start", "thread/resume", "thread/fork"] as const)(
    "publishes ready and started only after %s succeeds",
    async (method) => {
      const fake = createSyntheticCodexAppServer();
      const { manager } = createSyntheticCodexManager(fake);
      const cwd = mkdtempSync(path.join(os.tmpdir(), "glade-codex-thread-open-"));
      const methods: string[] = [];
      manager.on("event", (event) => methods.push(event.method));

      try {
        const session = await manager.startSession({
          threadId: ThreadId.makeUnsafe("thread-open"),
          provider: "codex",
          runtimeMode: "full-access",
          cwd,
          agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
          ...(method === "thread/resume" ? { resumeCursor: { threadId: "native-thread" } } : {}),
          ...(method === "thread/fork"
            ? { forkSourceResumeCursor: { threadId: "native-thread" } }
            : {}),
        });
        const openRequests = fake.requests.filter((request) => request.method === method);
        expect(openRequests).toHaveLength(1);
        expect(openRequests[0]?.params).toMatchObject(
          method === "thread/start" ? { experimentalRawEvents: false } : { excludeTurns: true },
        );
        expect(
          methods.filter((value) =>
            ["session/threadOpenResolved", "session/ready", "session/started"].includes(value),
          ),
        ).toEqual(["session/threadOpenResolved", "session/ready", "session/started"]);
        expect(session.status).toBe("ready");
        expect(session.resumeCursor).toEqual({
          threadId:
            method === "thread/start"
              ? "fresh-provider-thread"
              : method === "thread/fork"
                ? "native-thread-forked"
                : "native-thread",
        });
      } finally {
        await manager.stopAll();
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

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
          threadId: ThreadId.makeUnsafe("thread-missing-cwd"),
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
      ).rejects.toThrow(
        `Project working directory no longer exists: ${missingCwd}. Relocate or reconnect the project in Glade.`,
      );
      expect(events).toEqual([
        {
          method: "session/startFailed",
          kind: "error",
          message: `Project working directory no longer exists: ${missingCwd}. Relocate or reconnect the project in Glade.`,
        },
      ]);
      expect(events[0]?.message).not.toMatch(/not installed|not executable/i);
    } finally {
      await manager.stopAll();
    }
  });

  it("checks the Codex protocol baseline before spawning a resumed session", async () => {
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
          }) => void;
        },
        "assertSupportedCodexCliVersion",
      )
      .mockImplementation((input) => {
        expect(input.binaryPath).toBe("codex");
        throw new Error("Codex excludeTurns version gate");
      });

    try {
      await expect(
        manager.startSession({
          threadId: ThreadId.makeUnsafe("thread-resume-version"),
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

describe.skipIf(!process.env.CODEX_BINARY_PATH)("startSession live Codex resume", () => {
  it("keeps prior thread history when resuming with a changed runtime mode", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-live-resume-"));
    writeFileSync(path.join(workspaceDir, "README.md"), "hello\n", "utf8");

    const manager = new CodexAppServerManager();

    try {
      const firstSession = await manager.startSession({
        threadId: ThreadId.makeUnsafe("thread-live"),
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
