import { type CuaReply } from "@glade/shared/computer/cuaDriverProtocol";
import { createConnection } from "node:net";
import { describe, expect, it } from "vitest";
import { capability, cuaRequest, fixture } from "./cuaHostFixture";
describe("activation shield host method", () => {
  const task = { threadId: "thread", turnId: "turn" };
  const engageArgs = {
    action: "engage",
    shield_id: "shield-abc123",
    frame: { x: 100, y: 50, width: 400, height: 300 },
    window_id: 4242,
    pid: 777,
    label: "Glade activating Calculator",
  };
  const recordingShield = () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    return {
      calls,
      engage: async (request: unknown, shieldTask?: unknown) => {
        calls.push({ method: "engage", args: [request, shieldTask] });
      },
      release: async (shieldId: string) => {
        calls.push({ method: "release", args: [shieldId] });
      },
      releaseAll: async () => {
        calls.push({ method: "releaseAll", args: [] });
        return calls.filter((call) => call.method === "engage").length;
      },
      endTask: async (ended: unknown) => {
        calls.push({ method: "endTask", args: [ended] });
      },
      stop: async () => {
        calls.push({ method: "stop", args: [] });
      },
      dispose: async () => {
        calls.push({ method: "dispose", args: [] });
      },
    };
  };

  it("release_all is the forced-release path and reports the live count", async () => {
    const shield = recordingShield();
    const f = await fixture(capability, { shield });
    await cuaRequest<CuaReply>(f.endpoint, {
      method: "shield",
      task,
      args: engageArgs,
    });
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "shield",
      args: { action: "release_all" },
    });
    expect(reply.ok).toBe(true);
    expect(reply.result).toMatchObject({ released: 1 });
    expect(shield.calls.map((call) => call.method)).toEqual(["engage", "releaseAll"]);
  });

  it("stop and dispose release the whole shield surface", async () => {
    const shield = recordingShield();
    const f = await fixture(capability, { shield });
    await f.host.stop();
    expect(shield.calls.map((call) => call.method)).toContain("stop");
  });

  it("shield requests still require host authority", async () => {
    const f = await fixture();
    const socket = createConnection(f.endpoint);
    const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.once("connect", () => {
        socket.write(
          JSON.stringify({
            method: "shield",
            args: { action: "release_all" },
          }) + "\n",
        );
      });
      socket.once("data", (chunk) => {
        try {
          resolve(JSON.parse(chunk.toString()));
        } catch (error) {
          reject(error);
        }
      });
      socket.once("error", reject);
    });
    socket.destroy();
    expect(reply.ok).toBe(false);
    expect(String(reply.error)).toContain("authority");
  });
});
