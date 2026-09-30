import { Effect } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { ServerAuth } from "../../auth/Services/ServerAuth";
import { makeEffectAuthRequest } from "../../auth/effectHttp";
import { ServerConfig, type ServerConfigShape } from "../config";
import {
  shouldRejectAuthMutationOrigin,
  normalizeCorsOrigin,
  isTrustedAppOrigin,
} from "./trustedOrigins";
import { isLoopbackHost } from "./startupAccess";

export const requireAuthenticatedRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  yield* serverAuth.authenticateHttpRequest(makeEffectAuthRequest(request));
});

export const requireAuthenticatedMutationRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  if (!url) return yield* Effect.fail({ message: "Bad Request", status: 400 as const });
  const config = yield* ServerConfig;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(makeEffectAuthRequest(request));
  if (
    shouldRejectAuthMutationOrigin({
      rawOrigin: request.headers.origin,
      requestOrigin: url.origin,
      config,
      credentialSource: session.credentialSource,
    })
  ) {
    return yield* Effect.fail({
      message: "Trusted request origin required.",
      status: 403 as const,
    });
  }
  return session;
});

export function trustedMutationCorsHeaders(input: {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly url: URL;
  readonly config: ServerConfigShape;
}): Record<string, string> | null {
  const origin = normalizeCorsOrigin(input.request.headers.origin);
  if (!origin) return {};
  if (!isTrustedAppOrigin({ origin, requestOrigin: input.url.origin, config: input.config })) {
    return null;
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export function isLegacyTokenAuthorized(input: {
  readonly config: ServerConfigShape;
  readonly url: URL;
}): boolean {
  if (!isLoopbackHost(input.config.host) || input.config.publicUrl) {
    return false;
  }
  const legacyToken = input.url.searchParams.get("token");
  return !input.config.authToken || legacyToken === input.config.authToken;
}
