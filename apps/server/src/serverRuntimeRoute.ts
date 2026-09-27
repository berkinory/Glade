import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import {
  computeServerRuntimeProof,
  SERVER_RUNTIME_CHALLENGE_HEADER,
  serverRuntimeSecret,
} from "./serverRuntimeProof";

/** Proves that a discovered endpoint owns the private local runtime-state secret. */
export const serverRuntimeRouteLayer = HttpRouter.add(
  "POST",
  "/api/server/runtime-challenge",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const nonce = request.headers[SERVER_RUNTIME_CHALLENGE_HEADER];
    if (typeof nonce !== "string" || nonce.length < 24 || nonce.length > 128) {
      return HttpServerResponse.jsonUnsafe(
        { message: "Invalid runtime challenge." },
        { status: 400 },
      );
    }
    return HttpServerResponse.jsonUnsafe({
      proof: computeServerRuntimeProof(serverRuntimeSecret, nonce),
    });
  }),
);
