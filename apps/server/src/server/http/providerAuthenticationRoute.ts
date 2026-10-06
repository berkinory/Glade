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
import { AuthError } from "../../auth/Services/ServerAuth";
import { makeRuntimePtyAdapterLayer } from "../../terminal/runtimeLayer";
import { ServerConfig } from "../config";
import {
  requireAuthenticatedMutationRequest,
  trustedMutationCorsHeaders,
  isLegacyTokenAuthorized,
} from "./requestAuthorization";
import { readEffectJson } from "./httpBody";

export const providerAuthenticationRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    // Request handlers run after layer construction, so retain the scoped sign-in service here.
    const service = yield* ProviderAuthentication;
    const handler = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = HttpServerRequest.toURL(request);
      if (!url) return HttpServerResponse.empty({ status: 400 });
      const config = yield* ServerConfig;
      const cors = trustedMutationCorsHeaders({ request, url, config });
      if (!cors) return HttpServerResponse.empty({ status: 403 });
      const headers = { ...cors, "Cache-Control": "no-store" };
      if (request.method === "OPTIONS") return HttpServerResponse.empty({ status: 204, headers });
      return yield* Effect.gen(function* () {
        if (!isLegacyTokenAuthorized({ config, url })) yield* requireAuthenticatedMutationRequest;
        const payload = yield* readEffectJson(request, "Invalid sign-in request.");
        const input = yield* Schema.decodeUnknownEffect(ProviderAuthenticationRequest)(payload);
        const status = yield* service.request(input);
        return HttpServerResponse.jsonUnsafe(status, { headers });
      }).pipe(
        Effect.catch((error) =>
          HttpServerResponse.json(
            {
              error:
                error instanceof AuthError || Schema.is(ProviderAuthenticationError)(error)
                  ? error.message
                  : "Invalid sign-in request.",
            },
            { status: error instanceof AuthError ? (error.status ?? 500) : 400, headers },
          ),
        ),
      );
    }).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 403 }))));

    return Layer.mergeAll(
      HttpRouter.add("POST", PROVIDER_AUTHENTICATION_PATH, handler),
      HttpRouter.add("OPTIONS", PROVIDER_AUTHENTICATION_PATH, handler),
    );
  }),
).pipe(Layer.provide(ProviderAuthenticationLive.pipe(Layer.provide(makeRuntimePtyAdapterLayer()))));
