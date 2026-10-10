import { Effect, Layer, Stream } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import { RemoteAccess, type RemoteAccessShape } from "../../remoteAccess/Services/RemoteAccess";
import { ServerConfig, type ServerConfigShape } from "../config";
import { remoteAccessCliRouteLayer } from "./remoteAccessRoutes";

const TOKEN = "owner-token";

const status = {
  enabled: false,
  allowPlainHttp: false,
  port: 3773,
  listener: "off",
  routes: [],
  error: null,
  tailscale: {
    state: "not-installed",
    httpsRequested: false,
    httpsUrl: null,
    setupUrl: null,
    error: null,
  },
};

function handlerFor(host: string) {
  const remoteAccess = {
    streamStatus: Stream.make(status),
    update: () => Effect.succeed(status),
  } as unknown as RemoteAccessShape;
  // A minimal config: these routes read only the bind address, public URL and token.
  const config = { host, authToken: TOKEN, publicUrl: undefined } as unknown as ServerConfigShape;
  return HttpRouter.toWebHandler(
    Layer.mergeAll(
      remoteAccessCliRouteLayer,
      Layer.succeed(RemoteAccess, remoteAccess),
      Layer.succeed(ServerConfig, config),
    ),
    { disableLogger: true },
  );
}

describe("remote access CLI routes", () => {
  it.each([
    { name: "loopback with the server's token", host: "127.0.0.1", token: TOKEN, expected: 200 },
    { name: "loopback without a token", host: "127.0.0.1", token: null, expected: 401 },
    { name: "loopback with another token", host: "127.0.0.1", token: "guess", expected: 401 },
    // Requests from other devices are served as a wildcard bind, so the token never opens them.
    { name: "another device with the token", host: "::", token: TOKEN, expected: 401 },
  ])("answers $name with $expected", async ({ host, token, expected }) => {
    const { handler, dispose } = handlerFor(host);
    try {
      const url = `http://127.0.0.1/api/remote-access${token ? `?token=${token}` : ""}`;
      const response = await handler(new Request(url));
      expect(response.status).toBe(expected);
    } finally {
      await dispose();
    }
  });
});
