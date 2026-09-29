import {
  DEVICE_FRAME_RESYNC_MESSAGE,
  DEVICE_FRAME_WS_PATH,
  DEVICE_FRAME_WS_UDID_PARAM,
} from "@glade/shared/deviceFrame";
import { decodeFrameResyncRequest, makeFrameSink } from "@glade/shared/frameTransport";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { DeviceService } from "./Services/DeviceService.ts";
import type { DeviceFrameSink } from "./deviceFrameTransport.ts";

const MAX_CLIENT_MESSAGE_BYTES = 1_024;

function decodeResyncRequest(message: string | Uint8Array): "resync" | null {
  return decodeFrameResyncRequest(message, DEVICE_FRAME_RESYNC_MESSAGE, MAX_CLIENT_MESSAGE_BYTES);
}

function makeDeviceFrameSink(options: {
  readonly send: (bytes: Uint8Array) => Promise<void> | void;
  readonly isOpen: () => boolean;
}): DeviceFrameSink {
  return makeFrameSink(options);
}

export function makeDeviceFrameRouteLayer<R = never>(options: {
  readonly authorizeUpgrade: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<boolean, never, R>;
}) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      yield* router.add(
        "GET",
        DEVICE_FRAME_WS_PATH,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const deviceService = yield* Effect.serviceOption(DeviceService);
          if (deviceService._tag === "None" || !deviceService.value.supported) {
            return HttpServerResponse.text("Device streaming is unavailable", { status: 404 });
          }
          const url = HttpServerRequest.toURL(request);
          const udid = url?.searchParams.get(DEVICE_FRAME_WS_UDID_PARAM)?.trim();
          if (!udid) {
            return HttpServerResponse.text("Missing udid", { status: 400 });
          }
          if (!(yield* options.authorizeUpgrade(request))) {
            return HttpServerResponse.text("Forbidden", { status: 403 });
          }

          const socket = yield* request.upgrade;
          const writer = yield* socket.writer;
          let open = true;
          const sink = makeDeviceFrameSink({
            send: (bytes) => Effect.runPromise(writer(bytes)).catch(() => undefined),
            isOpen: () => open,
          });
          const unsubscribe = deviceService.value.manager.subscribeFrames(udid, sink);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              open = false;
              unsubscribe();
            }),
          );
          // Handled here rather than as an RPC because it is a property of this stream, and because a frozen
          // canvas should not depend on a second socket being healthy. Anything unrecognized is ignored: a
          // stray message must not kill a stream.
          yield* socket.run((message) => {
            if (decodeResyncRequest(message) === null) return;
            Effect.runFork(
              Effect.promise(() =>
                deviceService.value.manager.requestKeyframe(udid).catch(() => undefined),
              ),
            );
          });
          return HttpServerResponse.empty();
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.as(
              Effect.logDebug("device frame socket closed", { cause: String(cause) }),
              HttpServerResponse.empty(),
            ),
          ),
        ),
      );
    }),
  );
}
