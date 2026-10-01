import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderEvent } from "@glade/contracts/provider/provider";
import { AGENT_GATEWAY_NO_CAPABILITIES } from "../../../agentGateway/sessionLease";
import {
  createSyntheticCodexAppServer,
  createSyntheticCodexManager,
} from "./syntheticCodex.testSupport";

describe("shared Codex process", () => {
  it("isolates thread credentials and notifications, retaining other threads through stop and credential rotation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "glade-codex-shared-"));
    const fake = createSyntheticCodexAppServer();
    let credential = 0;
    const releases = new Map<ThreadId, ReturnType<typeof vi.fn>>();
    const { manager, teardownProcessTree } = createSyntheticCodexManager(fake, {
      endpointUrl: () => "http://127.0.0.1:48123/mcp",
      acquireSessionLease: (threadId) => {
        const release = vi.fn();
        releases.set(threadId, release);
        return {
          connection: { url: "http://127.0.0.1:48123/mcp", bearerToken: `private-${++credential}` },
          cancelTurn: async () => {},
          retireTurn: async () => {},
          release,
        };
      },
    });
    const events: ProviderEvent[] = [];
    manager.on("event", (event) => events.push(event));
    const start = (id: string, resumeCursor?: unknown) =>
      manager.startSession({
        threadId: ThreadId.makeUnsafe(id),
        provider: "codex",
        cwd,
        runtimeMode: "full-access",
        agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
        ...(resumeCursor ? { resumeCursor } : {}),
      });
    const delta = (threadId: string, text: string) =>
      fake.children[0]!.stdout.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            method: "item/agentMessage/delta",
            params: { threadId, turnId: "turn", itemId: "message", delta: text },
          }) + "\n",
        ),
      );
    try {
      const [first, second] = await Promise.all([start("first"), start("second")]);
      expect(fake.children).toHaveLength(1);
      expect(fake.requests.filter((request) => request.method === "initialize")).toHaveLength(1);
      const starts = fake.requests.filter((request) => request.method === "thread/start");
      expect(starts.map((request) => request.params?.config)).toEqual(
        expect.arrayContaining([
          {
            "mcp_servers.glade": {
              url: "http://127.0.0.1:48123/mcp",
              http_headers: { Authorization: "Bearer private-1" },
            },
          },
          {
            "mcp_servers.glade": {
              url: "http://127.0.0.1:48123/mcp",
              http_headers: { Authorization: "Bearer private-2" },
            },
          },
        ]),
      );
      expect(JSON.stringify(fake.launches)).not.toContain("private-");
      const firstNative = (first.resumeCursor as { threadId: string }).threadId;
      const secondNative = (second.resumeCursor as { threadId: string }).threadId;
      delta(firstNative, "first-only");
      delta(secondNative, "second-only");
      expect(
        events
          .filter((event) => event.method === "item/agentMessage/delta")
          .map((event) => event.threadId),
      ).toEqual([first.threadId, second.threadId]);
      fake.children[0]!.stdout.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            id: 10001,
            method: "item/commandExecution/requestApproval",
            params: {
              startedAtMs: 1700000000000,
              threadId: secondNative,
              turnId: "turn",
              itemId: "command",
              command: "echo scoped",
              approvalId: null,
              reason: null,
              cwd,
              commandActions: [],
              proposedExecpolicyAmendment: null,
              proposedNetworkPolicyAmendments: null,
              availableDecisions: null,
              additionalPermissions: null,
            },
          }) + "\n",
        ),
      );
      await vi.waitFor(() => expect(events.some((event) => event.kind === "request")).toBe(true));
      const approval = events.find((event) => event.kind === "request")!;
      expect(approval.threadId).toBe(second.threadId);
      await expect(
        manager.respondToRequest(first.threadId, approval.requestId!, "accept"),
      ).rejects.toThrow();
      await manager.respondToRequest(second.threadId, approval.requestId!, "accept");
      expect(fake.responses).toEqual([{ id: 10001, result: { decision: "accept" } }]);
      await manager.stopSession(first.threadId);
      expect(teardownProcessTree).not.toHaveBeenCalled();
      expect(releases.get(first.threadId)).toHaveBeenCalledOnce();
      expect(manager.hasSession(second.threadId)).toBe(true);
      const resumed = await start("first", first.resumeCursor);
      expect(resumed.resumeCursor).toEqual(first.resumeCursor);
      expect(fake.children).toHaveLength(1);
      expect(
        fake.requests.find((request) => request.method === "thread/resume")?.params?.config,
      ).toMatchObject({
        "mcp_servers.glade": { http_headers: { Authorization: "Bearer private-3" } },
      });
      await expect(start("foreign-owner", first.resumeCursor)).rejects.toThrow("already attached");
      expect(manager.hasSession(second.threadId)).toBe(true);
      expect(manager.hasSession(first.threadId)).toBe(true);
      const ids = fake.requests.flatMap((request) =>
        request.id === undefined ? [] : [request.id],
      );
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      await manager.stopAll();
      rmSync(cwd, { recursive: true, force: true });
    }
    expect(teardownProcessTree).toHaveBeenCalledOnce();
  });

  it("disconnects every affected thread on crash and resumes their native identities after backoff", async () => {
    const fake = createSyntheticCodexAppServer();
    const { manager, teardownProcessTree } = createSyntheticCodexManager(fake);
    const cwd = mkdtempSync(join(tmpdir(), "glade-codex-crash-"));
    const start = (id: string, resumeCursor?: unknown) =>
      manager.startSession({
        threadId: ThreadId.makeUnsafe(id),
        provider: "codex",
        cwd,
        runtimeMode: "full-access",
        agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
        ...(resumeCursor ? { resumeCursor } : {}),
      });
    try {
      const sessions = await Promise.all([start("first"), start("second")]);
      const crashedAt = Date.now();
      Object.defineProperty(fake.children[0]!, "exitCode", { value: 1 });
      fake.children[0]!.emit("exit", 1, null);
      expect(sessions.every((session) => !manager.hasSession(session.threadId))).toBe(true);
      await vi.waitFor(() => expect(teardownProcessTree).toHaveBeenCalledOnce());
      const cancelled = new AbortController();
      const pendingStart = manager.startSession(
        {
          threadId: ThreadId.makeUnsafe("cancelled"),
          provider: "codex",
          cwd,
          runtimeMode: "full-access",
          agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
        },
        cancelled.signal,
      );
      cancelled.abort();
      await expect(pendingStart).rejects.toThrow();
      expect(fake.children).toHaveLength(1);
      const resumed = await Promise.all(
        sessions.map((session) => start(session.threadId, session.resumeCursor)),
      );
      expect(Date.now() - crashedAt).toBeGreaterThanOrEqual(240);
      expect(fake.children).toHaveLength(2);
      expect(resumed.map((session) => session.resumeCursor)).toEqual(
        sessions.map((session) => session.resumeCursor),
      );
      await Promise.all(
        resumed.map((session) =>
          manager.sendTurn({ threadId: session.threadId, input: "continue" }),
        ),
      );
      expect(fake.requests.filter((request) => request.method === "turn/start")).toHaveLength(2);
    } finally {
      await manager.stopAll();
      rmSync(cwd, { recursive: true, force: true });
    }
    expect(teardownProcessTree).toHaveBeenCalledTimes(2);
  });
});
