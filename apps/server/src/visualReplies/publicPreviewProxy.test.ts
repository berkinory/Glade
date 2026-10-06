import { connect, createServer, type Socket } from "node:net";
import { once } from "node:events";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { publicPreviewProxy } from "./publicPreviewProxy";

function receive(socket: Socket, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    const cleanup = () => {
      socket.off("data", read);
      socket.off("error", fail);
      socket.off("close", closed);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const closed = () => fail(new Error("Tunnel closed before its reply."));
    const read = (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
      if (data.length >= length) {
        cleanup();
        resolve(data);
      }
    };
    socket.on("data", read);
    socket.once("error", fail);
    socket.once("close", closed);
  });
}

function target(host: string, port: number) {
  const hostname = Buffer.from(host);
  const data = Buffer.alloc(7 + hostname.length);
  data.set([5, 1, 0, 3, hostname.length]);
  hostname.copy(data, 5);
  data.writeUInt16BE(port, data.length - 2);
  return data;
}

describe("preview public-network boundary", () => {
  it("rejects local addresses and DNS names before any private service receives a connection", async () => {
    let reached = 0;
    const privateService = createServer((socket) => {
      reached += 1;
      socket.destroy();
    });
    privateService.listen(0, "127.0.0.1");
    await once(privateService, "listening");
    const address = privateService.address();
    if (!address || typeof address === "string") throw new Error("Missing private service port.");
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const port = yield* publicPreviewProxy;
            yield* Effect.promise(async () => {
              for (const host of [
                "127.0.0.1",
                "localhost",
                "::1",
                "::ffff:127.0.0.1",
                "10.0.0.1",
                "169.254.169.254",
                "64:ff9b::7f00:1",
                "2002:7f00:1::",
              ]) {
                const socket = connect({ host: "127.0.0.1", port });
                try {
                  await once(socket, "connect");
                  const greeting = receive(socket, 2);
                  socket.write(Buffer.from([5, 1, 0]));
                  expect(await greeting).toEqual(Buffer.from([5, 0]));
                  const reply = receive(socket, 10);
                  const request = target(host, address.port);
                  socket.write(request.subarray(0, 4));
                  socket.write(request.subarray(4));
                  expect((await reply)[1]).toBe(2);
                } finally {
                  socket.destroy();
                }
              }
            });
          }),
        ),
      );
      expect(reached).toBe(0);
    } finally {
      await new Promise<void>((resolve) => privateService.close(() => resolve()));
    }
  });

  it("closes incomplete tunnels and its listener when the preview scope ends", async () => {
    let socket: Socket | undefined;
    let proxyPort = 0;
    let closed: Promise<unknown> | undefined;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          proxyPort = yield* publicPreviewProxy;
          yield* Effect.promise(async () => {
            socket = connect({ host: "127.0.0.1", port: proxyPort });
            await once(socket, "connect");
            closed = new Promise<void>((resolve) => socket!.once("close", () => resolve()));
            socket.on("error", () => undefined);
            socket.write(Buffer.from([5]));
          });
        }),
      ),
    );
    await closed;
    expect(socket?.destroyed).toBe(true);
    const reconnect = connect({ host: "127.0.0.1", port: proxyPort });
    const [error] = await once(reconnect, "error");
    expect(error.code).toBe("ECONNREFUSED");
    reconnect.destroy();
  });
});
