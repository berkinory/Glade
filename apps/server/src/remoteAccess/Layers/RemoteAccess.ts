import { promises as fs } from "node:fs";
import type http from "node:http";
import net from "node:net";
import path from "node:path";

import type {
  RemoteAccessRoute,
  RemoteAccessStatus,
  RemoteAccessTailscale,
} from "@glade/contracts/transport/ws/remoteAccessRpc";
import {
  Effect,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";

import { AuthControlPlane } from "../../auth/Services/AuthControlPlane";
import { BootstrapCredentialService } from "../../auth/Services/BootstrapCredentialService";
import { ServerAuth } from "../../auth/Services/ServerAuth";
import { SessionCredentialService } from "../../auth/Services/SessionCredentialService";
import { ServerEnvironment } from "../../environment/Services/ServerEnvironment";
import { writeFileStringAtomically } from "../../platform/filesystem/atomicWrite";
import { ServerConfig } from "../../server/config";
import { isLoopbackAddress, isPrivateNetworkAddress, listDirectRoutes } from "../networkAddresses";
import { markRemoteSocket } from "../remoteRequests";
import { RemoteAccess, RemoteAccessError, type RemoteAccessShape } from "../Services/RemoteAccess";
import {
  localProxyTarget,
  readTailscaleNode,
  resolveTailscaleCli,
  serveHttps,
  stopServingHttps,
  type TailscaleNode,
} from "../tailscale";

const SETTINGS_FILE = "remote-access.json";
const DEFAULT_PORT = 3773;
const PORT_ATTEMPTS = 10;
// Addresses change when the machine joins another network; Tailscale can stop or sign out.
const REFRESH_INTERVAL = "30 seconds";

const RemoteAccessSettings = Schema.Struct({
  enabled: Schema.Boolean,
  allowPlainHttp: Schema.Boolean,
  tailscaleHttps: Schema.Boolean,
  port: Schema.Int,
});
type RemoteAccessSettings = typeof RemoteAccessSettings.Type;

const DEFAULT_SETTINGS: RemoteAccessSettings = {
  enabled: false,
  allowPlainHttp: false,
  tailscaleHttps: false,
  port: DEFAULT_PORT,
};

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(RemoteAccessSettings));

const readSettings = (filePath: string) =>
  Effect.promise(() => fs.readFile(filePath, "utf8").catch(() => "")).pipe(
    Effect.map((raw) => Option.getOrElse(decodeSettings(raw), () => DEFAULT_SETTINGS)),
  );

interface ActiveListener {
  readonly servers: ReadonlyArray<net.Server>;
  readonly port: number;
  readonly sockets: Set<net.Socket>;
}

// The settings row shows this as is, so it names the fix rather than the system error.
function listenerFailureMessage(
  preferredPort: number,
  error: NodeJS.ErrnoException | null,
): string {
  const lastPort = preferredPort + PORT_ATTEMPTS - 1;
  switch (error?.code) {
    case "EADDRINUSE":
      return `Other apps are using ports ${preferredPort} to ${lastPort}. Quit one of them, then turn remote access off and on again.`;
    case "EACCES":
    case "EPERM":
      return `This system does not let Glade listen on port ${preferredPort}. Check your firewall or security software.`;
    default:
      return `Glade could not open a port for other devices${error?.code ? ` (${error.code})` : ""}. Turn remote access off and on again.`;
  }
}

function listenOnce(
  server: net.Server,
  options: net.ListenOptions,
): Effect.Effect<void, NodeJS.ErrnoException> {
  return Effect.callback<void, NodeJS.ErrnoException>((resume) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      resume(Effect.fail(error));
    };
    const onListening = () => {
      server.off("error", onError);
      resume(Effect.void);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options);
  });
}

function tailscaleStatus(input: {
  readonly node: TailscaleNode;
  readonly requested: boolean;
  readonly serving: boolean;
  readonly setupUrl: string | null;
  readonly error: string | null;
}): RemoteAccessTailscale {
  return {
    state: input.node.state,
    httpsRequested: input.requested,
    httpsUrl: input.serving && input.node.dnsName ? `https://${input.node.dnsName}` : null,
    setupUrl: input.setupUrl,
    error: input.error,
  };
}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const serverAuth = yield* ServerAuth;
  const controlPlane = yield* AuthControlPlane;
  const sessions = yield* SessionCredentialService;
  const bootstrapCredentials = yield* BootstrapCredentialService;
  const environment = yield* ServerEnvironment;

  const settingsPath = path.join(config.stateDir, SETTINGS_FILE);
  const settingsRef = yield* Ref.make(yield* readSettings(settingsPath));
  const httpServerRef = yield* Ref.make<http.Server | null>(null);
  const listenerRef = yield* Ref.make<ActiveListener | null>(null);
  const lock = yield* Semaphore.make(1);
  const tailscaleCli = resolveTailscaleCli();
  const initial = yield* Ref.get(settingsRef);
  const status = yield* SubscriptionRef.make<RemoteAccessStatus>({
    enabled: initial.enabled,
    allowPlainHttp: initial.allowPlainHttp,
    port: initial.port,
    listener: "off",
    error: null,
    tailscale: tailscaleStatus({
      node: { state: "not-installed", dnsName: null, httpsProxy: null },
      requested: initial.tailscaleHttps,
      serving: false,
      setupUrl: null,
      error: null,
    }),
    routes: [],
  });
  // Read synchronously by the accept handler, so a change of policy applies to the next connection
  // without reopening the listener.
  let acceptPlainHttp = initial.allowPlainHttp;

  const saveSettings = (next: RemoteAccessSettings) =>
    Ref.set(settingsRef, next).pipe(
      Effect.andThen(
        writeFileStringAtomically({
          filePath: settingsPath,
          contents: `${JSON.stringify(next, null, 2)}\n`,
        }).pipe(Effect.orDie),
      ),
    );

  const closeServers = (servers: ReadonlyArray<net.Server>) =>
    Effect.forEach(
      servers,
      (server) => Effect.callback<void>((resume) => void server.close(() => resume(Effect.void))),
      { discard: true },
    );

  const openListener = (httpServer: http.Server, preferredPort: number) =>
    Effect.gen(function* () {
      let lastError: NodeJS.ErrnoException | null = null;
      for (let offset = 0; offset < PORT_ATTEMPTS; offset += 1) {
        const port = preferredPort + offset;
        const sockets = new Set<net.Socket>();
        const accept = (socket: net.Socket) => {
          const local = socket.localAddress ?? "";
          const allowed = acceptPlainHttp
            ? isPrivateNetworkAddress(local)
            : isLoopbackAddress(local);
          if (!allowed) {
            socket.destroy();
            return;
          }
          sockets.add(socket);
          socket.once("close", () => sockets.delete(socket));
          markRemoteSocket(socket);
          httpServer.emit("connection", socket);
        };
        // IPv4 and IPv6 get separate sockets: macOS grants a dual-stack bind while another app
        // holds the IPv4 port, and every IPv4 device would then reach that app instead.
        const ipv4 = net.createServer(accept);
        const ipv6 = net.createServer(accept);
        const ipv4Error = yield* listenOnce(ipv4, { host: "0.0.0.0", port }).pipe(
          Effect.as(null),
          Effect.catch((error) => Effect.succeed(error)),
        );
        if (ipv4Error) {
          lastError = ipv4Error;
          if (ipv4Error.code === "EADDRINUSE") continue;
          break;
        }
        const ipv6Error = yield* listenOnce(ipv6, { host: "::", port, ipv6Only: true }).pipe(
          Effect.as(null),
          Effect.catch((error) => Effect.succeed(error)),
        );
        if (ipv6Error?.code === "EADDRINUSE") {
          lastError = ipv6Error;
          yield* closeServers([ipv4]);
          continue;
        }
        // Hosts without IPv6 serve IPv4 only.
        const servers = ipv6Error ? [ipv4] : [ipv4, ipv6];
        return { servers, port, sockets } satisfies ActiveListener;
      }
      return yield* new RemoteAccessError({
        message: listenerFailureMessage(preferredPort, lastError),
        cause: lastError,
      });
    });

  const closeListener = (listener: ActiveListener) =>
    Effect.sync(() => {
      for (const socket of listener.sockets) socket.destroy();
    }).pipe(Effect.andThen(closeServers(listener.servers)));

  const routesFor = (
    settings: RemoteAccessSettings,
    port: number,
    httpsUrl: string | null,
  ): ReadonlyArray<RemoteAccessRoute> => [
    ...(httpsUrl ? [{ kind: "tailnet-https" as const, url: httpsUrl }] : []),
    ...(config.publicUrl ? [{ kind: "public-url" as const, url: config.publicUrl.origin }] : []),
    ...(settings.allowPlainHttp ? listDirectRoutes(port) : []),
  ];

  // Brings the listener and the Tailscale mapping in line with the saved settings, then publishes
  // what is actually live. Serialized so a toggle and the periodic refresh never interleave.
  const reconcile = lock.withPermit(
    Effect.gen(function* () {
      const httpServer = yield* Ref.get(httpServerRef);
      if (!httpServer) return yield* SubscriptionRef.get(status);
      let settings = yield* Ref.get(settingsRef);
      acceptPlainHttp = settings.allowPlainHttp;

      let listener = yield* Ref.get(listenerRef);
      let listenerError: string | null = null;
      if (settings.enabled && !listener) {
        const opened = yield* openListener(httpServer, settings.port).pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
        );
        if (opened.ok) {
          listener = opened.value;
          yield* Ref.set(listenerRef, listener);
          if (listener.port !== settings.port) {
            settings = { ...settings, port: listener.port };
            yield* saveSettings(settings);
          }
        } else {
          listenerError = opened.error.message;
        }
      } else if (!settings.enabled && listener) {
        yield* closeListener(listener);
        yield* Ref.set(listenerRef, null);
        listener = null;
      }

      const node = yield* Effect.promise(() => readTailscaleNode(tailscaleCli));
      const ownTarget = localProxyTarget(settings.port);
      let serving = node.httpsProxy === ownTarget;
      let setupUrl: string | null = null;
      let tailscaleError: string | null = null;
      const wantHttps = Boolean(listener) && settings.tailscaleHttps && node.state === "running";
      if (wantHttps && !serving && tailscaleCli) {
        if (node.httpsProxy !== null) {
          tailscaleError = "Tailscale HTTPS on this machine already serves another app.";
        } else {
          const result = yield* Effect.promise(() => serveHttps(tailscaleCli, settings.port));
          if (result.kind === "serving") serving = true;
          else if (result.kind === "needs-setup") setupUrl = result.setupUrl;
          else tailscaleError = result.message;
        }
      } else if (!wantHttps && serving && tailscaleCli && node.state === "running") {
        // Only a mapping to this listener is Glade's to remove.
        yield* Effect.promise(() => stopServingHttps(tailscaleCli));
        serving = false;
      }

      const httpsUrl = serving && node.dnsName ? `https://${node.dnsName}` : null;
      const next: RemoteAccessStatus = {
        enabled: settings.enabled,
        allowPlainHttp: settings.allowPlainHttp,
        port: settings.port,
        listener: listener ? "on" : settings.enabled ? "failed" : "off",
        error: listenerError,
        tailscale: tailscaleStatus({
          node,
          requested: settings.tailscaleHttps,
          serving,
          setupUrl,
          error: tailscaleError,
        }),
        routes: listener ? routesFor(settings, settings.port, httpsUrl) : [],
      };
      yield* SubscriptionRef.set(status, next);
      return next;
    }),
  );

  const attach: RemoteAccessShape["attach"] = (httpServer) =>
    Effect.gen(function* () {
      yield* Ref.set(httpServerRef, httpServer);
      yield* Effect.addFinalizer(() =>
        Ref.getAndSet(listenerRef, null).pipe(
          Effect.flatMap((listener) => (listener ? closeListener(listener) : Effect.void)),
        ),
      );
      yield* reconcile.pipe(
        Effect.andThen(
          Effect.gen(function* () {
            if ((yield* Ref.get(settingsRef)).enabled) yield* reconcile;
          }).pipe(Effect.repeat(Schedule.spaced(REFRESH_INTERVAL))),
        ),
        Effect.forkScoped,
      );
    });

  const update: RemoteAccessShape["update"] = (input) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(settingsRef);
      yield* saveSettings({
        ...current,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.allowPlainHttp === undefined ? {} : { allowPlainHttp: input.allowPlainHttp }),
        ...(input.tailscaleHttps === undefined ? {} : { tailscaleHttps: input.tailscaleHttps }),
      });
      return yield* reconcile;
    });

  const createPairing: RemoteAccessShape["createPairing"] = Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(status);
    if (!current.enabled || current.listener !== "on") {
      return yield* new RemoteAccessError({ message: "Turn on remote access first." });
    }
    if (current.routes.length === 0) {
      return yield* new RemoteAccessError({
        message:
          "No address another device can reach yet. Turn on Tailscale HTTPS or allow your local network.",
      });
    }
    const issued = yield* serverAuth
      .issuePairingCredential()
      .pipe(
        Effect.mapError(
          (cause) => new RemoteAccessError({ message: "Could not create a pairing link.", cause }),
        ),
      );
    const { environmentId } = yield* environment.getDescriptor;
    const fragment = new URLSearchParams({
      token: issued.credential,
      env: environmentId,
      routes: Buffer.from(JSON.stringify(current.routes), "utf8").toString("base64url"),
    });
    return {
      id: issued.id,
      url: `${current.routes[0]!.url}/pair#${fragment.toString()}`,
      expiresAt: issued.expiresAt,
    };
  });

  const devicesSnapshot = Effect.gen(function* () {
    const devices = yield* controlPlane.listSessions();
    const links = yield* controlPlane.listPairingLinks({ role: "client" });
    return { devices, pendingPairingIds: links.map((link) => link.id) };
  }).pipe(
    Effect.mapError(
      (cause) => new RemoteAccessError({ message: "Could not load paired devices.", cause }),
    ),
  );

  const streamDevices: RemoteAccessShape["streamDevices"] = Stream.concat(
    Stream.fromEffect(devicesSnapshot),
    Stream.merge(sessions.streamChanges, bootstrapCredentials.streamChanges).pipe(
      Stream.mapEffect(() => devicesSnapshot),
    ),
  );

  const revokeDevice: RemoteAccessShape["revokeDevice"] = (sessionId) =>
    controlPlane.revokeSession(sessionId).pipe(
      Effect.asVoid,
      Effect.mapError(
        (cause) => new RemoteAccessError({ message: "Could not remove the device.", cause }),
      ),
    );

  const revokePairing: RemoteAccessShape["revokePairing"] = (id) =>
    serverAuth.revokePairingLink(id).pipe(
      Effect.asVoid,
      Effect.mapError(
        (cause) => new RemoteAccessError({ message: "Could not end the pairing code.", cause }),
      ),
    );

  return {
    attach,
    streamStatus: SubscriptionRef.changes(status),
    update,
    createPairing,
    streamDevices,
    revokeDevice,
    revokePairing,
  } satisfies RemoteAccessShape;
});

export const RemoteAccessLive = Layer.effect(RemoteAccess, make);
