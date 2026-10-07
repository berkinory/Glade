import { encodeFrame, FrameDecoder } from "@glade/shared/desktopHost/frameCodec";
import * as Net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startDesktopHostRpcServer, type DesktopHostRpcServer } from "./desktopHostRpcServer";

const TOKEN = "a".repeat(43);

function exchange(path: string, frames: readonly unknown[]): Promise<unknown[] | "closed"> {
  return new Promise((resolve) => {
    const socket = Net.createConnection(path);
    const decoder = new FrameDecoder();
    const received: unknown[] = [];
    socket.on("data", (chunk: Buffer) => {
      received.push(...decoder.push(chunk));
      if (received.length === frames.length) {
        socket.end();
        resolve(received);
      }
    });
    socket.on("close", () => resolve("closed"));
    socket.on("error", () => resolve("closed"));
    for (const frame of frames) socket.write(encodeFrame(frame));
  });
}

const auth = (token: string) => ({ jsonrpc: "2.0", id: 1, method: "auth", params: { token } });
const ping = { jsonrpc: "2.0", id: 2, method: "browser.tabs", params: {} };

describe("desktop host RPC server", () => {
  let server: DesktopHostRpcServer;
  beforeAll(async () => {
    server = await startDesktopHostRpcServer({
      token: TOKEN,
      dispatch: async (method) => ({ method }),
    });
  });
  afterAll(() => server.close());

  it("serves methods only after an auth frame with the exact capability token", async () => {
    const cases = [
      { name: "missing token", frames: [ping], expected: "closed" },
      { name: "wrong token", frames: [auth(`${TOKEN}x`), ping], expected: "closed" },
      {
        name: "correct token",
        frames: [auth(TOKEN), ping],
        expected: [
          { jsonrpc: "2.0", id: 1, result: {} },
          { jsonrpc: "2.0", id: 2, result: { method: "browser.tabs" } },
        ],
      },
    ];
    for (const testCase of cases) {
      expect(await exchange(server.path, testCase.frames), testCase.name).toEqual(
        testCase.expected,
      );
    }
  });
});
