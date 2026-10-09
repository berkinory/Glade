import { Schema, DateTime, Effect } from "effect";
import {
  AuthBootstrapInput,
  AuthCreatePairingCredentialInput,
  AuthRevokePairingLinkInput,
  AuthRevokeClientSessionInput,
} from "@glade/contracts/transport/auth/auth";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { ServerConfig } from "../config";
import { ServerAuth } from "../../auth/Services/ServerAuth";
import { SessionCredentialService } from "../../auth/Services/SessionCredentialService";
import { makeEffectAuthRequest } from "../../auth/effectHttp";
import { roleHasScope } from "../../auth/sessionScopes";
import { authDescriptorFor } from "../../remoteAccess/remoteRequests";
import { deriveAuthClientMetadata } from "../../auth/utils";
import { readEffectJson, mapPayloadError } from "./httpBody";
import { requireAuthenticatedMutationRequest } from "./requestAuthorization";

const decodeBootstrapInput = Schema.decodeUnknownEffect(AuthBootstrapInput);

const decodeCreatePairingCredentialInput = Schema.decodeUnknownEffect(
  AuthCreatePairingCredentialInput,
);

const decodeRevokePairingLinkInput = Schema.decodeUnknownEffect(AuthRevokePairingLinkInput);

const decodeRevokeClientSessionInput = Schema.decodeUnknownEffect(AuthRevokeClientSessionInput);

function encodeCookie(input: {
  readonly name: string;
  readonly value: string;
  readonly expiresAt: DateTime.DateTime;
  readonly secure: boolean;
}) {
  return `${encodeURIComponent(input.name)}=${encodeURIComponent(input.value)}; Expires=${DateTime.toDate(input.expiresAt).toUTCString()}; HttpOnly; Path=/; SameSite=Lax${input.secure ? "; Secure" : ""}`;
}

function encodeExpiredCookie(input: { readonly name: string; readonly secure: boolean }) {
  return `${encodeURIComponent(input.name)}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Path=/; SameSite=Lax${input.secure ? "; Secure" : ""}`;
}

export const authEffectRouteLayer = HttpRouter.add(
  "*",
  "/api/auth/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const serverAuth = yield* ServerAuth;
    const sessions = yield* SessionCredentialService;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });
    const authRequest = makeEffectAuthRequest(request);

    if (request.method === "GET" && url.pathname === "/api/auth/session") {
      const state = yield* serverAuth.getSessionState(authRequest);
      return HttpServerResponse.jsonUnsafe({
        ...state,
        auth: authDescriptorFor(request, state.auth),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/bootstrap") {
      const payload = yield* readEffectJson(request, "Invalid bootstrap payload.").pipe(
        Effect.flatMap(decodeBootstrapInput),
        Effect.mapError((cause) => mapPayloadError("Invalid bootstrap payload.", cause)),
      );
      const result = yield* serverAuth.exchangeBootstrapCredential(payload.credential, {
        ...deriveAuthClientMetadata({
          headers: request.headers,
          remoteAddress: request.remoteAddress ?? null,
        }),
      });
      return HttpServerResponse.jsonUnsafe(result.response, {
        headers: {
          "Set-Cookie": encodeCookie({
            name: sessions.cookieName,
            value: result.sessionToken,
            expiresAt: result.response.expiresAt,
            secure: config.publicUrl !== undefined,
          }),
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/bootstrap/bearer") {
      const payload = yield* readEffectJson(request, "Invalid bootstrap payload.").pipe(
        Effect.flatMap(decodeBootstrapInput),
        Effect.mapError((cause) => mapPayloadError("Invalid bootstrap payload.", cause)),
      );
      return HttpServerResponse.jsonUnsafe(
        yield* serverAuth.exchangeBootstrapCredentialForBearerSession(payload.credential, {
          ...deriveAuthClientMetadata({
            headers: request.headers,
            remoteAddress: request.remoteAddress ?? null,
          }),
        }),
      );
    }

    const authenticatedMutationSession = requireAuthenticatedMutationRequest;

    if (request.method === "POST" && url.pathname === "/api/auth/ws-token") {
      const session = yield* authenticatedMutationSession;
      return HttpServerResponse.jsonUnsafe(yield* serverAuth.issueWebSocketToken(session));
    }

    if (request.method === "POST" && url.pathname === "/api/auth/pairing-token") {
      const session = yield* authenticatedMutationSession;
      if (!roleHasScope(session.role, "access:write"))
        return HttpServerResponse.jsonUnsafe(
          { error: "Only the machine's owner can pair devices." },
          { status: 403 },
        );
      const payload =
        Number(request.headers["content-length"] ?? "0") > 0
          ? yield* readEffectJson(request, "Invalid pairing credential payload.").pipe(
              Effect.flatMap(decodeCreatePairingCredentialInput),
              Effect.mapError((cause) =>
                mapPayloadError("Invalid pairing credential payload.", cause),
              ),
            )
          : {};
      return HttpServerResponse.jsonUnsafe(yield* serverAuth.issuePairingCredential(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const session = yield* authenticatedMutationSession;
      return HttpServerResponse.jsonUnsafe(
        { revoked: yield* serverAuth.logoutSession(session.sessionId) },
        {
          headers: {
            "Set-Cookie": encodeExpiredCookie({
              name: sessions.cookieName,
              secure: config.publicUrl !== undefined,
            }),
          },
        },
      );
    }

    const requireAccessManagement = <A extends { readonly role: "owner" | "client" }, E, R>(
      authenticate: Effect.Effect<A, E, R>,
    ) =>
      Effect.flatMap(authenticate, (session) =>
        roleHasScope(session.role, "access:write")
          ? Effect.succeed(session)
          : Effect.fail({
              message: "Only the machine's owner can manage devices.",
              status: 403 as const,
            }),
      );
    const ownerSession = requireAccessManagement(serverAuth.authenticateHttpRequest(authRequest));
    const ownerMutationSession = requireAccessManagement(authenticatedMutationSession);

    if (request.method === "GET" && url.pathname === "/api/auth/pairing-links") {
      yield* ownerSession;
      return HttpServerResponse.jsonUnsafe(yield* serverAuth.listPairingLinks());
    }

    if (request.method === "POST" && url.pathname === "/api/auth/pairing-links/revoke") {
      yield* ownerMutationSession;
      const payload = yield* readEffectJson(request, "Invalid revoke pairing link payload.").pipe(
        Effect.flatMap(decodeRevokePairingLinkInput),
        Effect.mapError((cause) => mapPayloadError("Invalid revoke pairing link payload.", cause)),
      );
      return HttpServerResponse.jsonUnsafe({
        revoked: yield* serverAuth.revokePairingLink(payload.id),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/auth/clients") {
      const session = yield* ownerSession;
      return HttpServerResponse.jsonUnsafe(yield* serverAuth.listClientSessions(session.sessionId));
    }

    if (request.method === "POST" && url.pathname === "/api/auth/clients/revoke") {
      const session = yield* ownerMutationSession;
      const payload = yield* readEffectJson(request, "Invalid revoke client payload.").pipe(
        Effect.flatMap(decodeRevokeClientSessionInput),
        Effect.mapError((cause) => mapPayloadError("Invalid revoke client payload.", cause)),
      );
      return HttpServerResponse.jsonUnsafe({
        revoked: yield* serverAuth.revokeClientSession(session.sessionId, payload.sessionId),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/clients/revoke-others") {
      const session = yield* ownerMutationSession;
      return HttpServerResponse.jsonUnsafe({
        revokedCount: yield* serverAuth.revokeOtherClientSessions(session.sessionId),
      });
    }

    return HttpServerResponse.text("Not Found", { status: 404 });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          {
            error:
              error instanceof Error
                ? error.message
                : String((error as { message?: unknown }).message ?? error),
          },
          {
            status:
              typeof (error as { status?: unknown }).status === "number"
                ? (error as { status: number }).status
                : 500,
          },
        ),
      ),
    ),
  ),
);
