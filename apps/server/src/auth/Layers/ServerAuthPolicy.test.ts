import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ServerConfig, type ServerConfigShape } from "../../server/config";
import { ServerAuthPolicy } from "../Services/ServerAuthPolicy";
import { ServerAuthPolicyLive } from "./ServerAuthPolicy";

const makeLayer = (overrides: Partial<ServerConfigShape>) =>
  ServerAuthPolicyLive.pipe(
    Layer.provide(
      Layer.effect(
        ServerConfig,
        Effect.gen(function* () {
          const config = yield* ServerConfig;
          return { ...config, ...overrides } satisfies ServerConfigShape;
        }),
      ).pipe(
        Layer.provide(
          ServerConfig.layerTest(process.cwd(), {
            prefix: "glade-auth-policy-test-",
          }),
        ),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );

const getDescriptor = Effect.gen(function* () {
  const policy = yield* ServerAuthPolicy;
  return yield* policy.getDescriptor();
});

describe("ServerAuthPolicyLive", () => {
  it.each([
    {
      overrides: { mode: "desktop", host: "127.0.0.1", port: 3773 },
      policy: "desktop-managed-local",
      bootstrapMethods: ["desktop-bootstrap"],
      sessionCookieName: "glade_session_3773",
    },
    {
      overrides: { mode: "desktop", host: "0.0.0.0" },
      policy: "remote-reachable",
      bootstrapMethods: ["desktop-bootstrap", "one-time-token"],
    },
    {
      overrides: { mode: "web", host: "localhost" },
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionCookieName: "glade_session",
    },
    {
      overrides: { mode: "web", host: "192.168.1.50" },
      policy: "remote-reachable",
      bootstrapMethods: ["one-time-token"],
    },
  ] satisfies ReadonlyArray<{
    readonly overrides: Partial<ServerConfigShape>;
    readonly policy: string;
    readonly bootstrapMethods: ReadonlyArray<string>;
    readonly sessionCookieName?: string;
  }>)(
    "uses $policy for $overrides.mode mode on $overrides.host",
    async ({ overrides, policy, bootstrapMethods, sessionCookieName }) => {
      const descriptor = await getDescriptor.pipe(
        Effect.provide(makeLayer(overrides)),
        Effect.scoped,
        Effect.runPromise,
      );

      expect(descriptor.policy).toBe(policy);
      expect(descriptor.bootstrapMethods).toEqual(bootstrapMethods);
      if (sessionCookieName) expect(descriptor.sessionCookieName).toBe(sessionCookieName);
    },
  );
});
