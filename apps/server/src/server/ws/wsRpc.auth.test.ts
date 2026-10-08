import { assert, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { vi } from "vitest";

import { AuthError } from "../../auth/Services/ServerAuth";
import { authenticateRpcWebSocketUpgrade } from "./wsRpc";

it.effect.each([
  {
    name: "a non-loopback bind ignores a matching legacy query token",
    config: { host: "192.168.1.50", authToken: "secret", publicUrl: undefined },
    delegates: true,
  },
  {
    name: "a loopback desktop bind accepts the legacy query token",
    config: { host: "127.0.0.1", authToken: "secret", publicUrl: undefined },
    delegates: false,
  },
  {
    name: "an HTTPS public origin disables the loopback legacy query token",
    config: {
      host: "127.0.0.1",
      authToken: "secret",
      publicUrl: new URL("https://glade.example.test/"),
    },
    delegates: true,
  },
])("websocket upgrade auth: $name", ({ config, delegates }) =>
  Effect.gen(function* () {
    const authenticateWebSocketUpgrade = vi.fn(() =>
      Effect.fail(new AuthError({ message: "Authentication required.", status: 401 })),
    );

    const exit = yield* authenticateRpcWebSocketUpgrade({
      config,
      legacyToken: "secret",
      request: {
        headers: {},
        cookies: {},
        url: new URL(`http://${config.host}:3773/ws?token=secret`),
      },
      serverAuth: { authenticateWebSocketUpgrade },
    }).pipe(Effect.exit);

    assert.equal(authenticateWebSocketUpgrade.mock.calls.length, delegates ? 1 : 0);
    assert.isTrue(delegates ? Exit.isFailure(exit) : Exit.isSuccess(exit) && exit.value === null);
  }),
);
