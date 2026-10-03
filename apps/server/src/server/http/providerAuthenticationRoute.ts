import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import {
  ProviderAuthenticationRequest,
  PROVIDER_AUTHENTICATION_PATH,
} from "@glade/contracts/provider/providerAuthentication";
import {
  ProviderAuthentication,
  ProviderAuthenticationError,
} from "../../provider/Services/ProviderAuthentication";
import { ProviderAuthenticationLive } from "../../provider/Layers/ProviderAuthentication";
import { makeRuntimePtyAdapterLayer } from "../../terminal/runtimeLayer";
import { ServerConfig } from "../config";
import {
  requireAuthenticatedMutationRequest,
  trustedMutationCorsHeaders,
  isLegacyTokenAuthorized,
} from "./requestAuthorization";
import { authErrorResponse } from "../../auth/effectHttp";
import { readEffectJson } from "./httpBody";

const handler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  if (!url) return HttpServerResponse.empty({ status: 400 });
  const config = yield* ServerConfig;
  const cors = trustedMutationCorsHeaders({ request, url, config });
  if (!cors) return HttpServerResponse.empty({ status: 403 });
  const headers = { ...cors, "Cache-Control": "no-store" };
  if (request.method === "OPTIONS") return HttpServerResponse.empty({ status: 204, headers });
  if (!isLegacyTokenAuthorized({ config, url })) yield* requireAuthenticatedMutationRequest;
  return yield* Effect.gen(function* () {
    const payload = yield* readEffectJson(request, "Invalid sign-in request.");
    const input = yield* Schema.decodeUnknownEffect(ProviderAuthenticationRequest)(payload);
    const service = yield* ProviderAuthentication;
    const status = yield* service.request(input);
    return HttpServerResponse.jsonUnsafe(status, { headers });
  }).pipe(
    Effect.catch((error) =>
      HttpServerResponse.json(
        {
          error: Schema.is(ProviderAuthenticationError)(error)
            ? error.message
            : "Invalid sign-in request.",
        },
        { status: 400, headers },
      ),
    ),
  );
}).pipe(
  Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error))),
  Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 403 }))),
);

export const providerAuthenticationRouteLayer = Layer.mergeAll(
  HttpRouter.add("POST", PROVIDER_AUTHENTICATION_PATH, handler),
  HttpRouter.add("OPTIONS", PROVIDER_AUTHENTICATION_PATH, handler),
).pipe(Layer.provide(ProviderAuthenticationLive.pipe(Layer.provide(makeRuntimePtyAdapterLayer()))));
