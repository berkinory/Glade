import {
  DESKTOP_HOST_RPC_PATH_ENV,
  DESKTOP_HOST_RPC_TOKEN_FD_ENV,
} from "@glade/contracts/desktopHost/desktopHostRpc";
import { Effect, Layer, PubSub, Schedule, Stream } from "effect";
import * as FS from "node:fs";

import {
  connectDesktopHost,
  DesktopHostRpcFailure,
  type DesktopHostConnection,
} from "../desktopHostRpcClient.ts";
import {
  DesktopHostClient,
  DesktopHostError,
  type DesktopHostClientShape,
  type DesktopHostNotification,
} from "../Services/DesktopHostClient.ts";

const MIN_TOKEN_LENGTH = 32;
const NOTIFICATION_BACKLOG = 64;
// Reconnects quickly after a desktop-side hiccup, then settles to one attempt every few seconds.
const RECONNECT = Schedule.exponential("100 millis").pipe(
  Schedule.either(Schedule.spaced("5 seconds")),
);

// The desktop passes the socket path in the environment and the capability token over a private
// stdio pipe. Both are consumed here so provider processes the server spawns never inherit them.
function consumeDesktopHostConfig(env: NodeJS.ProcessEnv): { path: string; token: string } | null {
  const path = env[DESKTOP_HOST_RPC_PATH_ENV]?.trim();
  const fdText = env[DESKTOP_HOST_RPC_TOKEN_FD_ENV]?.trim();
  delete env[DESKTOP_HOST_RPC_PATH_ENV];
  delete env[DESKTOP_HOST_RPC_TOKEN_FD_ENV];
  if (!path || !fdText || !/^\d+$/u.test(fdText)) return null;
  const fd = Number(fdText);
  let token: string;
  try {
    token = FS.readFileSync(fd, "utf8").trim();
    FS.closeSync(fd);
  } catch {
    // A stale variable without the inherited pipe (EBADF) means no desktop host, not a crash.
    return null;
  }
  return token.length >= MIN_TOKEN_LENGTH ? { path, token } : null;
}

const toDesktopHostError = (error: unknown) =>
  error instanceof DesktopHostRpcFailure
    ? new DesktopHostError({ code: error.code, message: error.message })
    : new DesktopHostError({ code: "protocol", message: String(error) });

const unavailable = (message: string) => new DesktopHostError({ code: "unavailable", message });

export const DesktopHostClientLive = Layer.effect(
  DesktopHostClient,
  Effect.gen(function* () {
    const config = yield* Effect.sync(() => consumeDesktopHostConfig(process.env));
    if (!config) {
      return {
        configured: false,
        request: () =>
          Effect.fail(unavailable("Glade's browser is only available in the Glade desktop app.")),
        notifications: Stream.empty,
      } satisfies DesktopHostClientShape;
    }

    const notifications = yield* PubSub.sliding<DesktopHostNotification>(NOTIFICATION_BACKLOG);
    let connection: DesktopHostConnection | null = null;

    const session = Effect.gen(function* () {
      const opened = yield* Effect.tryPromise({
        try: () =>
          connectDesktopHost({
            ...config,
            onNotification: (method, params) => {
              PubSub.publishUnsafe(notifications, { method, params });
            },
          }),
        catch: toDesktopHostError,
      });
      connection = opened;
      yield* Effect.promise(() => opened.closed);
      connection = null;
      return yield* unavailable("The desktop host connection closed.");
    });
    yield* session.pipe(
      Effect.tapError((error) =>
        Effect.logDebug("desktop host disconnected", { error: error.message }),
      ),
      Effect.retry(RECONNECT),
      Effect.forkScoped,
    );
    yield* Effect.addFinalizer(() => Effect.sync(() => connection?.close()));

    return {
      configured: true,
      request: (method, params, timeoutMs) =>
        Effect.suspend(() => {
          const current = connection;
          if (!current) {
            return Effect.fail(
              unavailable("Glade's browser host is not connected yet. Retry in a few seconds."),
            );
          }
          return Effect.tryPromise({
            try: (signal) => current.request(method, params, signal),
            catch: toDesktopHostError,
          }).pipe(
            Effect.timeoutOrElse({
              duration: timeoutMs,
              onTimeout: () =>
                Effect.fail(
                  new DesktopHostError({
                    code: "timeout",
                    message: `${method} did not finish within ${Math.round(timeoutMs / 1000)}s.`,
                  }),
                ),
            }),
          );
        }),
      notifications: Stream.fromPubSub(notifications),
    } satisfies DesktopHostClientShape;
  }),
);
