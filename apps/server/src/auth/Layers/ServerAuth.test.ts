import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ServerConfig } from "../../server/config";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite";
import { AuthControlPlaneLive } from "./AuthControlPlane";
import { BootstrapCredentialServiceLive } from "./BootstrapCredentialService";
import { ServerAuthLive } from "./ServerAuth";
import { ServerAuthPolicyLive } from "./ServerAuthPolicy";
import { ServerSecretStoreLive } from "./ServerSecretStore";
import { SessionCredentialServiceLive } from "./SessionCredentialService";
import {
  AuthError,
  ServerAuth,
  type AuthRequest,
  type ServerAuthShape,
} from "../Services/ServerAuth";

const sessionCredentialLayer = SessionCredentialServiceLive.pipe(
  Layer.provide(ServerSecretStoreLive),
);
const authControlPlaneLayer = AuthControlPlaneLive.pipe(
  Layer.provide(BootstrapCredentialServiceLive),
  Layer.provide(sessionCredentialLayer),
);
const testLayer = ServerAuthLive.pipe(
  Layer.provide(ServerAuthPolicyLive),
  Layer.provide(BootstrapCredentialServiceLive),
  Layer.provide(sessionCredentialLayer),
  Layer.provide(authControlPlaneLayer),
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(ServerSecretStoreLive),
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "glade-auth-server-test-",
    }),
  ),
  Layer.provide(NodeServices.layer),
);

const requestMetadata = {
  deviceType: "desktop" as const,
  os: "macOS",
  browser: "Chrome",
  ipAddress: "192.168.1.23",
};

function makeCookieRequest(sessionToken: string): AuthRequest {
  return {
    headers: {},
    cookies: {
      glade_session: sessionToken,
    },
  };
}

const exchangeStartupOwner = (serverAuth: ServerAuthShape, baseUrl = "http://127.0.0.1:3773") =>
  Effect.gen(function* () {
    const pairingUrl = yield* serverAuth.issueStartupPairingUrl(baseUrl);
    const token = new URLSearchParams(new URL(pairingUrl).hash.slice(1)).get("token") ?? "";
    const exchanged = yield* serverAuth.exchangeBootstrapCredential(token, requestMetadata);
    const session = yield* serverAuth.authenticateHttpRequest(
      makeCookieRequest(exchanged.sessionToken),
    );
    return { sessionToken: exchanged.sessionToken, session };
  });

const runServerAuthTest = (effect: Effect.Effect<void, AuthError, ServerAuth>) =>
  effect.pipe(Effect.provide(testLayer), Effect.scoped, Effect.runPromise);

describe("ServerAuthLive", () => {
  it("issues client pairing credentials by default and rejects their reuse", async () => {
    await runServerAuthTest(
      Effect.gen(function* () {
        const serverAuth = yield* ServerAuth;

        const pairingCredential = yield* serverAuth.issuePairingCredential();
        const exchanged = yield* serverAuth.exchangeBootstrapCredential(
          pairingCredential.credential,
          requestMetadata,
        );
        const verified = yield* serverAuth.authenticateHttpRequest(
          makeCookieRequest(exchanged.sessionToken),
        );

        expect(verified.sessionId.length).toBeGreaterThan(0);
        expect(verified.role).toBe("client");
        expect(verified.subject).toBe("one-time-token");

        const reused = yield* Effect.flip(
          serverAuth.exchangeBootstrapCredential(pairingCredential.credential, requestMetadata),
        ).pipe(Effect.orDie);
        expect(reused.status).toBe(401);
        expect(reused.message).toBe("Invalid bootstrap credential.");
      }),
    );
  });

  it("issues startup pairing URLs that bootstrap owner sessions", async () => {
    await runServerAuthTest(
      Effect.gen(function* () {
        const serverAuth = yield* ServerAuth;

        const listedPairingLinks = yield* serverAuth.listPairingLinks();
        expect(
          listedPairingLinks.some((pairingLink) => pairingLink.subject === "owner-bootstrap"),
        ).toBe(false);

        const { session } = yield* exchangeStartupOwner(serverAuth);

        expect(session.role).toBe("owner");
        expect(session.subject).toBe("owner-bootstrap");
      }),
    );
  });

  it("lists client sessions with the current owner marked", async () => {
    await runServerAuthTest(
      Effect.gen(function* () {
        const serverAuth = yield* ServerAuth;

        const { session: ownerSession } = yield* exchangeStartupOwner(serverAuth);

        const pairingCredential = yield* serverAuth.issuePairingCredential({ label: "CI phone" });
        const clientExchange = yield* serverAuth.exchangeBootstrapCredential(
          pairingCredential.credential,
          {
            ...requestMetadata,
            deviceType: "mobile",
            os: "iOS",
            browser: "Safari",
          },
        );
        const clientSession = yield* serverAuth.authenticateHttpRequest(
          makeCookieRequest(clientExchange.sessionToken),
        );
        const clients = yield* serverAuth.listClientSessions(ownerSession.sessionId);

        expect(clients).toHaveLength(2);
        expect(clients.find((entry) => entry.sessionId === ownerSession.sessionId)?.current).toBe(
          true,
        );
        expect(clients.find((entry) => entry.sessionId === clientSession.sessionId)?.current).toBe(
          false,
        );
        expect(
          clients.find((entry) => entry.sessionId === clientSession.sessionId)?.client.label,
        ).toBe("CI phone");
      }),
    );
  });

  it("authenticates websocket upgrade tokens issued for a session", async () => {
    await runServerAuthTest(
      Effect.gen(function* () {
        const serverAuth = yield* ServerAuth;

        const { session } = yield* exchangeStartupOwner(serverAuth);
        const websocketToken = yield* serverAuth.issueWebSocketToken(session);
        const upgraded = yield* serverAuth.authenticateWebSocketUpgrade({
          headers: {},
          cookies: {},
          url: new URL(`ws://127.0.0.1:3773/?wsToken=${websocketToken.token}`),
        });

        expect(upgraded.sessionId).toBe(session.sessionId);
        expect(upgraded.role).toBe("owner");
      }),
    );
  });

  it("prefers an explicit bearer credential and reports its request provenance", async () => {
    await runServerAuthTest(
      Effect.gen(function* () {
        const serverAuth = yield* ServerAuth;
        const cookieCredential = yield* serverAuth.issuePairingCredential();
        const cookieSession = yield* serverAuth.exchangeBootstrapCredential(
          cookieCredential.credential,
          requestMetadata,
        );
        const bearerCredential = yield* serverAuth.issuePairingCredential();
        const bearerSession = yield* serverAuth.exchangeBootstrapCredentialForBearerSession(
          bearerCredential.credential,
          requestMetadata,
        );

        const authenticated = yield* serverAuth.authenticateHttpRequest({
          headers: { authorization: `Bearer ${bearerSession.sessionToken}` },
          cookies: { glade_session: cookieSession.sessionToken },
        });

        expect(authenticated.credentialSource).toBe("bearer");
        expect(authenticated.sessionId).not.toBe(
          (yield* serverAuth.authenticateHttpRequest(makeCookieRequest(cookieSession.sessionToken)))
            .sessionId,
        );
      }),
    );
  });

  it("logs out the current session, invalidates its websocket ticket, and preserves others", async () => {
    await runServerAuthTest(
      Effect.gen(function* () {
        const serverAuth = yield* ServerAuth;
        const currentCredential = yield* serverAuth.issuePairingCredential();
        const currentExchange = yield* serverAuth.exchangeBootstrapCredential(
          currentCredential.credential,
          requestMetadata,
        );
        const currentSession = yield* serverAuth.authenticateHttpRequest(
          makeCookieRequest(currentExchange.sessionToken),
        );
        const websocketToken = yield* serverAuth.issueWebSocketToken(currentSession);

        const otherCredential = yield* serverAuth.issuePairingCredential();
        const otherExchange = yield* serverAuth.exchangeBootstrapCredential(
          otherCredential.credential,
          requestMetadata,
        );

        expect(yield* serverAuth.logoutSession(currentSession.sessionId)).toBe(true);
        expect(
          (yield* Effect.flip(
            serverAuth.authenticateHttpRequest(makeCookieRequest(currentExchange.sessionToken)),
          ).pipe(Effect.orDie)).status,
        ).toBe(401);
        expect(
          (yield* Effect.flip(
            serverAuth.authenticateWebSocketUpgrade({
              headers: {},
              cookies: {},
              url: new URL(`ws://127.0.0.1:3773/?wsToken=${websocketToken.token}`),
            }),
          ).pipe(Effect.orDie)).status,
        ).toBe(401);
        expect(
          (yield* serverAuth.authenticateHttpRequest(makeCookieRequest(otherExchange.sessionToken)))
            .credentialSource,
        ).toBe("cookie");
      }),
    );
  });

  it("authenticates cookie websocket upgrades and ignores the legacy query token", async () => {
    await runServerAuthTest(
      Effect.gen(function* () {
        const serverAuth = yield* ServerAuth;
        const legacyUrl = new URL("ws://192.168.1.50:3773/ws?token=remote-startup-secret");

        const legacyError = yield* Effect.flip(
          serverAuth.authenticateWebSocketUpgrade({ headers: {}, cookies: {}, url: legacyUrl }),
        ).pipe(Effect.orDie);
        expect(legacyError.status).toBe(401);

        const { sessionToken } = yield* exchangeStartupOwner(
          serverAuth,
          "http://192.168.1.50:3773",
        );
        const upgraded = yield* serverAuth.authenticateWebSocketUpgrade({
          ...makeCookieRequest(sessionToken),
          url: legacyUrl,
        });

        expect(upgraded.role).toBe("owner");
        expect(upgraded.subject).toBe("owner-bootstrap");
      }),
    );
  });
});
