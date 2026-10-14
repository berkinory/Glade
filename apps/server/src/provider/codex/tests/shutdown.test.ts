import { describe, expect, it, vi } from "vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { AGENT_GATEWAY_NO_CAPABILITIES } from "../../../agentGateway/sessionLease";
import {
  createSyntheticCodexAppServer,
  createSyntheticCodexManager,
} from "./syntheticCodex.testSupport";

describe("Codex session shutdown", () => {
  it("reconciles a lost interrupt response and cleans background commands without stopping another chat", async () => {
    vi.useFakeTimers();
    let cleaned = false;
    const fake = createSyntheticCodexAppServer({
      onRequest: (request, respond) => {
        if (request.method === "turn/interrupt") return true;
        if (request.method === "thread/backgroundTerminals/clean") cleaned = true;
        if (request.method === "thread/backgroundTerminals/list") {
          respond({
            data: cleaned
              ? []
              : [
                  {
                    processId: "still-running",
                    itemId: "command",
                    command: "sleep 60",
                    cwd: "/tmp",
                  },
                ],
            nextCursor: null,
          });
          return true;
        }
        return false;
      },
    });
    const { manager, teardownProcessTree } = createSyntheticCodexManager(fake);
    try {
      const start = (id: string) =>
        manager.startSession({
          threadId: ThreadId.makeUnsafe(id),
          provider: "codex",
          cwd: process.cwd(),
          runtimeMode: "full-access",
          agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
        });
      const first = await start("stopping");
      const other = await start("working");
      await manager.sendTurn({ threadId: first.threadId, input: "run" });
      const stopped = manager.stopSession(first.threadId);
      await vi.advanceTimersByTimeAsync(5_001);
      await stopped;
      expect(cleaned).toBe(true);
      expect(teardownProcessTree).not.toHaveBeenCalled();
      expect(manager.hasSession(other.threadId)).toBe(true);
      await manager.sendTurn({ threadId: other.threadId, input: "continue" });
    } finally {
      const stopping = manager.stopAll();
      await vi.runAllTimersAsync();
      await stopping;
      vi.useRealTimers();
    }
  });
  it("limits an unconfirmed shutdown to its process group", async () => {
    const fake = createSyntheticCodexAppServer({
      onRequest: (request, respond) => {
        if (
          request.method === "thread/backgroundTerminals/list" &&
          request.params?.threadId === "fresh-provider-thread"
        ) {
          respond({
            data: [
              { processId: "unstoppable", itemId: "command", command: "sleep 60", cwd: "/tmp" },
            ],
            nextCursor: null,
          });
          return true;
        }
        return false;
      },
    });
    const { manager, teardownProcessTree } = createSyntheticCodexManager(fake);
    try {
      const sessions = [];
      for (const id of ["first", "second", "third"]) {
        sessions.push(
          await manager.startSession({
            threadId: ThreadId.makeUnsafe(id),
            provider: "codex",
            cwd: process.cwd(),
            runtimeMode: "full-access",
            agentGatewayCapabilityInput: AGENT_GATEWAY_NO_CAPABILITIES,
          }),
        );
      }
      expect(fake.children).toHaveLength(2);
      await manager.stopSession(sessions[0]!.threadId);
      expect(manager.hasSession(sessions[1]!.threadId)).toBe(false);
      expect(manager.hasSession(sessions[2]!.threadId)).toBe(true);
      expect(teardownProcessTree).toHaveBeenCalledOnce();
      expect(teardownProcessTree).toHaveBeenCalledWith(
        expect.objectContaining({ rootPid: fake.children[0]!.pid }),
      );
      await manager.sendTurn({ threadId: sessions[2]!.threadId, input: "still working" });
    } finally {
      await manager.stopAll();
    }
  });
});
