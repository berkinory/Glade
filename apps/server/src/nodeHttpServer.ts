import http from "node:http";
import type { ListenOptions, Socket } from "node:net";

import { WS_FEATURE_PATH } from "@glade/contracts";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Effect, Scope } from "effect";
import * as HttpServer from "effect/unstable/http/HttpServer";
import { ServeError } from "effect/unstable/http/HttpServerError";
import { WebSocketServer } from "ws";

export const MAX_WEBSOCKET_MESSAGE_BYTES = 2 * 1024 * 1024;

// The Effect upgrade handler then runs the route (including authentication) before
// `ws.handleUpgrade()` installs its own listener. A peer reset during that gap otherwise becomes an
// unhandled `error` event and terminates the whole backend process.
function handleClientSocketError(this: Socket): void {
  this.destroy();
}

function protectClientSocket(socket: Socket): void {
  socket.on("error", handleClientSocketError);
}

// Compression is post-auth only: each deflate connection retains substantial zlib and
// partial-message memory. Context takeover makes small repetitive RPC frames useful; ws ignores
// threshold with takeover enabled. maxPayload still limits decompressed size across fragments.
const PER_MESSAGE_DEFLATE_OPTIONS = true;

const COMPRESSED_UPGRADE_PATH = WS_FEATURE_PATH;

function normalizeUpgradePath(requestUrl: string | undefined): string {
  const target = requestUrl ?? "";

  const afterAuthority = /^[a-z][a-z0-9+.-]*:\/\//i.test(target)
    ? target.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "") || "/"
    : target;
  const pathOnly = afterAuthority.split("#")[0]?.split("?")[0] ?? "";
  let decoded = pathOnly;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {}
  const withoutParams = decoded
    .split("/")
    .map((segment) => segment.split(";")[0] ?? "")
    .join("/");
  const collapsed = withoutParams.replace(/\/{2,}/g, "/").toLowerCase();
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

function upgradePathAllowsCompression(requestUrl: string | undefined): boolean {
  return normalizeUpgradePath(requestUrl) === COMPRESSED_UPGRADE_PATH;
}

export const makeBoundedNodeHttpServer = Effect.fnUntraced(function* (
  evaluate: () => http.Server,
  options: ListenOptions,
) {
  const scope = yield* Effect.scope;
  const server = evaluate();

  server.on("connection", protectClientSocket);

  yield* Scope.addFinalizer(
    scope,
    Effect.callback<void>((resume) => {
      server.off("connection", protectClientSocket);
      if (!server.listening) {
        resume(Effect.void);
        return;
      }
      server.close((error) => {
        if (error) resume(Effect.die(error));
        else resume(Effect.void);
      });
    }),
  );

  yield* Effect.callback<void, ServeError>((resume) => {
    const onError = (cause: Error) => resume(Effect.fail(new ServeError({ cause })));
    server.on("error", onError);
    server.listen(options, () => {
      server.off("error", onError);
      resume(Effect.void);
    });
  });

  const address = server.address()!;
  const makeBoundedWebSocketServer = (perMessageDeflate: boolean) =>
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new WebSocketServer({
            noServer: true,
            maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES,
            perMessageDeflate: perMessageDeflate ? PER_MESSAGE_DEFLATE_OPTIONS : false,
          }),
      ),
      (server) =>
        Effect.callback<void>((resume) => {
          for (const client of server.clients) client.terminate();
          server.close(() => resume(Effect.void));
        }),
    ).pipe(Scope.provide(scope));

  const featureWebSocketServer = yield* makeBoundedWebSocketServer(true);
  const bootstrapWebSocketServer = yield* makeBoundedWebSocketServer(false);

  return HttpServer.make({
    address:
      typeof address === "string"
        ? { _tag: "UnixAddress", path: address }
        : {
            _tag: "TcpAddress",
            hostname: address.address === "::" ? "0.0.0.0" : address.address,
            port: address.port,
          },
    // HttpServer.make erases HTTP failures to unknown; Node handles the original causes as responses.
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off
    serve: Effect.fnUntraced(function* (httpApp, middleware) {
      const serveScope = yield* Effect.scope;
      // Preserve the SDK's opaque HTTP failure channel at the transport boundary.
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off
      const handler = yield* NodeHttpServer.makeHandler(httpApp, {
        middleware,
        scope: serveScope,
      });
      const featureUpgradeHandler = yield* NodeHttpServer.makeUpgradeHandler(
        Effect.succeed(featureWebSocketServer),
        // Node consumes opaque HTTP failures; wrapping them would change response handling.
        // @effect-diagnostics-next-line anyUnknownInErrorContext:off
        httpApp,
        {
          middleware,
          scope: serveScope,
        },
      );
      const bootstrapUpgradeHandler = yield* NodeHttpServer.makeUpgradeHandler(
        Effect.succeed(bootstrapWebSocketServer),
        // Node consumes opaque HTTP failures; wrapping them would change response handling.
        // @effect-diagnostics-next-line anyUnknownInErrorContext:off
        httpApp,
        {
          middleware,
          scope: serveScope,
        },
      );
      const upgradeHandler = (
        nodeRequest: http.IncomingMessage,
        socket: Parameters<typeof featureUpgradeHandler>[1],
        head: Parameters<typeof featureUpgradeHandler>[2],
      ) => {
        const dispatch = upgradePathAllowsCompression(nodeRequest.url)
          ? featureUpgradeHandler
          : bootstrapUpgradeHandler;
        dispatch(nodeRequest, socket, head);
      };

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          server.off("request", handler);
          server.off("upgrade", upgradeHandler);
        }),
      );
      server.on("request", handler);
      server.on("upgrade", upgradeHandler);
    }),
  });
});
