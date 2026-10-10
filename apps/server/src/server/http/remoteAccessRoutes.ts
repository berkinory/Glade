import {
  RemoteAccessPairing,
  RemoteAccessStatus,
  RemoteAccessUpdateInput,
} from "@glade/contracts/transport/ws/remoteAccessRpc";
import { Effect, Layer, Option, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { RemoteAccess, RemoteAccessError } from "../../remoteAccess/Services/RemoteAccess";
import { ServerConfig } from "../config";
import { readEffectJson } from "./httpBody";
import { isLegacyTokenAuthorized } from "./requestAuthorization";

const REMOTE_ACCESS_CLI_PATH = "/api/remote-access";

const encodeStatus = Schema.encodeEffect(RemoteAccessStatus);
const encodePairing = Schema.encodeEffect(RemoteAccessPairing);
const decodeUpdate = Schema.decodeUnknownEffect(RemoteAccessUpdateInput);

// For the `glade` command on the same machine. Only a loopback-bound server's own token opens these:
// requests from other devices never reach them (they are not on the remote path allowlist) and see a
// wildcard bind, which the token check refuses.
const ownerOnly = <A, E, R>(handle: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    const config = yield* ServerConfig;
    if (!url || !config.authToken || !isLegacyTokenAuthorized({ config, url })) {
      return HttpServerResponse.jsonUnsafe({ error: "Not authorized." }, { status: 401 });
    }
    return yield* handle;
  });

const respond = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map((body) => HttpServerResponse.jsonUnsafe(body)),
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 400 },
        ),
      ),
    ),
  );

const status = Effect.gen(function* () {
  const current = yield* Stream.runHead((yield* RemoteAccess).streamStatus);
  if (Option.isNone(current))
    return yield* new RemoteAccessError({ message: "Remote access is not ready." });
  return yield* encodeStatus(current.value);
});

const update = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const input = yield* decodeUpdate(
    yield* readEffectJson(request, "Invalid remote access update."),
  );
  return yield* encodeStatus(yield* (yield* RemoteAccess).update(input));
});

const pairing = Effect.gen(function* () {
  return yield* encodePairing(yield* (yield* RemoteAccess).createPairing);
});

// Only the outstanding pairing ids: `glade pair` watches its code leave the list once a device used it.
const pendingPairings = Effect.gen(function* () {
  const devices = yield* Stream.runHead((yield* RemoteAccess).streamDevices);
  return { pendingPairingIds: Option.isSome(devices) ? devices.value.pendingPairingIds : [] };
});

export const remoteAccessCliRouteLayer = Layer.mergeAll(
  HttpRouter.add("GET", REMOTE_ACCESS_CLI_PATH, ownerOnly(respond(status))),
  HttpRouter.add("POST", REMOTE_ACCESS_CLI_PATH, ownerOnly(respond(update))),
  HttpRouter.add("POST", `${REMOTE_ACCESS_CLI_PATH}/pairing`, ownerOnly(respond(pairing))),
  HttpRouter.add("GET", `${REMOTE_ACCESS_CLI_PATH}/devices`, ownerOnly(respond(pendingPairings))),
);
