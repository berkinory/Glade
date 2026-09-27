/**
 * CliConfig - CLI/runtime bootstrap service definitions.
 *
 * Defines startup-only service contracts used while resolving process config
 * and constructing server runtime layers.
 *
 * @module CliConfig
 */
import OS from "node:os";
import {
  Config,
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  ServiceMap,
  Stream,
} from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { NetService } from "@glade/shared/Net";
import {
  MIGRATION_DIVERGENCE_CONSENT_ENV,
  MIGRATION_RUNTIME_SOURCE_DIGEST_ENV,
} from "@glade/shared/migrationRecovery";
import {
  optionalBooleanEnvironmentConfig,
  optionalBooleanFlag,
  resolveBooleanConfig,
  type BooleanFlagInput,
} from "@glade/shared/cli";
import {
  DEFAULT_PORT,
  deriveServerPaths,
  normalizeHttpsPublicOrigin,
  preparePrivateServerPaths,
  remoteAccessPolicyError,
  resolveCanonicalWorkspaceRoots,
  resolveStaticDir,
  ServerConfig,
  type RuntimeMode,
  type ServerConfigShape,
} from "./config";

import { fixPath, resolveBaseDir } from "./os-jank";
import { Open } from "./open";
import { ServerAuth } from "./auth/Services/ServerAuth";
import * as SqlitePersistence from "./persistence/Layers/Sqlite";
import { ProviderRuntimeEventRepositoryLive } from "./persistence/Layers/ProviderRuntimeEvents";
import { makeServerApplicationLayers } from "./serverLayers";
import { startServerMemoryDiagnostics } from "./memoryDiagnostics";
import { createClaudeCredentialKeepaliveController } from "./provider/claudeCredentialKeepalive";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { ProviderSessionReaperLive } from "./provider/Layers/ProviderSessionReaper";
import { ProviderRuntimeReconcilerLive } from "./provider/Layers/ProviderRuntimeReconciler";
import { Server } from "./effectServer";
import { ServerLoggerLive } from "./serverLogger";
import { ServerSettingsService } from "./serverSettings";
import { formatHostForUrl, isLoopbackHost, isWildcardHost } from "./startupAccess";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { startThreadRetentionJob } from "./threadRetention";
import {
  discoverServerRuntime,
  resolveServerHome,
  verifyServerRuntime,
} from "./serverRuntimeDiscovery";
import { fetchGladeServerStatus, formatGladeServerStatus } from "./serverStatusCli";
import {
  embeddedMigrationRuntimeSourceDigest,
  verifyMigrationRuntimeIdentity,
} from "./migrationBundleIdentity";

export class StartupError extends Data.TaggedError("StartupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const DESKTOP_SHUTDOWN_TOKEN_ENV_KEY = "GLADE_DESKTOP_SHUTDOWN_TOKEN";

function consumeProcessEnvironmentValue(environmentKey: string): string | undefined {
  const matchingKeys =
    process.platform === "win32"
      ? Object.keys(process.env).filter((key) => key.toUpperCase() === environmentKey)
      : [environmentKey];
  let value: string | undefined;

  for (const key of matchingKeys) {
    value ??= process.env[key];
    delete process.env[key];
  }

  return value;
}

interface CliInput {
  readonly mode: Option.Option<RuntimeMode>;
  readonly port: Option.Option<number>;
  readonly host: Option.Option<string>;
  readonly gladeHome: Option.Option<string>;
  readonly devUrl: Option.Option<URL>;
  readonly publicUrl: Option.Option<URL>;
  readonly allowInsecureRemote: BooleanFlagInput;
  readonly noBrowser: BooleanFlagInput;
  readonly authToken: Option.Option<string>;
  readonly autoBootstrapProjectFromCwd: BooleanFlagInput;
  readonly logProviderEvents: BooleanFlagInput;
  readonly logWebSocketEvents: BooleanFlagInput;
}

/**
 * CliConfigShape - Startup helpers required while building server layers.
 */
export interface CliConfigShape {
  /**
   * Current process working directory.
   */
  readonly cwd: string;

  /**
   * Apply OS-specific PATH normalization.
   */
  readonly fixPath: Effect.Effect<void>;

  /**
   * Resolve static web asset directory for server mode.
   */
  readonly resolveStaticDir: Effect.Effect<string | undefined>;
}

/**
 * CliConfig - Service tag for startup CLI/runtime helpers.
 */
export class CliConfig extends ServiceMap.Service<CliConfig, CliConfigShape>()(
  "glade/main/CliConfig",
) {
  static readonly layer = Layer.effect(
    CliConfig,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return {
        cwd: process.cwd(),
        fixPath: Effect.sync(fixPath),
        resolveStaticDir: resolveStaticDir().pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      } satisfies CliConfigShape;
    }),
  );
}

const CliEnvConfig = Config.all({
  mode: Config.string("GLADE_MODE").pipe(
    Config.option,
    Config.map(
      Option.match<RuntimeMode, string>({
        onNone: () => "web",
        onSome: (value) => (value === "desktop" ? "desktop" : "web"),
      }),
    ),
  ),
  port: Config.port("GLADE_PORT").pipe(Config.option, Config.map(Option.getOrUndefined)),
  host: Config.string("GLADE_HOST").pipe(Config.option, Config.map(Option.getOrUndefined)),
  gladeHome: Config.string("GLADE_HOME").pipe(Config.option, Config.map(Option.getOrUndefined)),
  devUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option, Config.map(Option.getOrUndefined)),
  publicUrl: Config.url("GLADE_PUBLIC_URL").pipe(Config.option, Config.map(Option.getOrUndefined)),
  allowInsecureRemote: optionalBooleanEnvironmentConfig("GLADE_ALLOW_INSECURE_REMOTE"),
  noBrowser: optionalBooleanEnvironmentConfig("GLADE_NO_BROWSER"),
  authToken: Config.string("GLADE_AUTH_TOKEN").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  desktopShutdownToken: Config.string("GLADE_DESKTOP_SHUTDOWN_TOKEN").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  migrationDivergenceConsent: Config.string(MIGRATION_DIVERGENCE_CONSENT_ENV).pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  migrationRuntimeSourceDigest: Config.string(MIGRATION_RUNTIME_SOURCE_DIGEST_ENV).pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  autoBootstrapProjectFromCwd: optionalBooleanEnvironmentConfig(
    "GLADE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
  ),
  logProviderEvents: optionalBooleanEnvironmentConfig("GLADE_LOG_PROVIDER_EVENTS"),
  logWebSocketEvents: optionalBooleanEnvironmentConfig("GLADE_LOG_WS_EVENTS"),
});

const ServerConfigLive = (input: CliInput) =>
  Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const cliConfig = yield* CliConfig;
      const { findAvailablePort } = yield* NetService;
      const env = yield* CliEnvConfig.asEffect().pipe(
        Effect.mapError(
          (cause) =>
            new StartupError({ message: "Failed to read environment configuration", cause }),
        ),
      );
      const liveProcessDesktopShutdownToken = yield* Effect.sync(() =>
        consumeProcessEnvironmentValue(DESKTOP_SHUTDOWN_TOKEN_ENV_KEY),
      );
      const liveProcessMigrationConsent = yield* Effect.sync(() =>
        consumeProcessEnvironmentValue(MIGRATION_DIVERGENCE_CONSENT_ENV),
      );
      const liveProcessMigrationSourceDigest = yield* Effect.sync(() =>
        consumeProcessEnvironmentValue(MIGRATION_RUNTIME_SOURCE_DIGEST_ENV),
      );

      const launcherMigrationSourceDigest =
        env.migrationRuntimeSourceDigest ?? liveProcessMigrationSourceDigest;
      yield* Effect.try({
        try: () =>
          verifyMigrationRuntimeIdentity({
            cwd: cliConfig.cwd,
            embeddedDigest: embeddedMigrationRuntimeSourceDigest(),
            launcherDigest: launcherMigrationSourceDigest,
          }),
        catch: (cause) =>
          new StartupError({
            message:
              cause instanceof Error
                ? `${cause.name}: ${cause.message}`
                : "Migration bundle check failed",
            cause,
          }),
      });

      const mode = Option.getOrElse(input.mode, () => env.mode);

      const port = yield* Option.match(input.port, {
        onSome: (value) => Effect.succeed(value),
        onNone: () => {
          if (env.port) {
            return Effect.succeed(env.port);
          }
          if (mode === "desktop") {
            return Effect.succeed(DEFAULT_PORT);
          }
          return findAvailablePort(DEFAULT_PORT);
        },
      });

      const devUrl = Option.getOrElse(input.devUrl, () => env.devUrl);
      const configuredPublicUrl = Option.getOrUndefined(input.publicUrl) ?? env.publicUrl;
      const publicUrl = configuredPublicUrl
        ? (normalizeHttpsPublicOrigin(configuredPublicUrl) ?? undefined)
        : undefined;
      if (configuredPublicUrl && publicUrl === undefined) {
        return yield* new StartupError({
          message:
            "GLADE_PUBLIC_URL/--public-url must be an HTTPS root origin without credentials, path, query, or fragment (for example https://glade.example.com).",
        });
      }
      const allowInsecureRemote = resolveBooleanConfig(
        input.allowInsecureRemote,
        env.allowInsecureRemote,
        false,
      );
      const configuredHome = Option.getOrUndefined(input.gladeHome) ?? env.gladeHome;
      const baseDir = yield* resolveBaseDir(configuredHome);
      const userHomeDir = OS.homedir();
      const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
      yield* Effect.try({
        try: () => preparePrivateServerPaths(derivedPaths),
        catch: (cause) =>
          new StartupError({ message: "Failed to secure Glade's local state directory", cause }),
      });
      const noBrowser = resolveBooleanConfig(input.noBrowser, env.noBrowser, mode === "desktop");
      const authToken = Option.getOrUndefined(input.authToken) ?? env.authToken;
      const desktopShutdownToken = env.desktopShutdownToken ?? liveProcessDesktopShutdownToken;
      const migrationDivergenceConsent =
        env.migrationDivergenceConsent ?? liveProcessMigrationConsent;
      const autoBootstrapProjectFromCwd = resolveBooleanConfig(
        input.autoBootstrapProjectFromCwd,
        env.autoBootstrapProjectFromCwd,
        mode === "web",
      );
      // Provider event NDJSON logging is helpful for debugging, but it is too
      // expensive to keep enabled on the streaming hot path by default.
      const logProviderEvents = resolveBooleanConfig(
        input.logProviderEvents,
        env.logProviderEvents,
        false,
      );
      // Keep websocket payload logging opt-in in dev. Terminal/TUI traffic is
      // high-volume enough that automatic logging adds noticeable CPU and I/O.
      const logWebSocketEvents = resolveBooleanConfig(
        input.logWebSocketEvents,
        env.logWebSocketEvents,
        false,
      );
      const staticDir = devUrl ? undefined : yield* cliConfig.resolveStaticDir;
      // Omitting Node's host listens on an unspecified address, which exposes
      // the server beyond the local machine on common platforms. Keep every
      // mode loopback-only unless remote access is explicit and authenticated.
      const host = Option.getOrUndefined(input.host) ?? env.host ?? "127.0.0.1";
      const remotePolicyError = remoteAccessPolicyError({
        host,
        authToken,
        devUrl,
        publicUrl,
        allowInsecureRemote,
      });
      if (remotePolicyError) {
        return yield* new StartupError({
          message: remotePolicyError,
        });
      }

      const { homeDir, chatWorkspaceRoot, studioWorkspaceRoot } =
        yield* resolveCanonicalWorkspaceRoots({ homeDir: userHomeDir });

      const config: ServerConfigShape = {
        mode,
        port,
        cwd: cliConfig.cwd,
        homeDir,
        chatWorkspaceRoot,
        studioWorkspaceRoot,
        host,
        baseDir,
        ...derivedPaths,
        staticDir,
        devUrl,
        publicUrl,
        allowInsecureRemote,
        noBrowser,
        authToken,
        desktopShutdownToken,
        migrationDivergenceConsent,
        autoBootstrapProjectFromCwd,
        logProviderEvents,
        logWebSocketEvents,
      } satisfies ServerConfigShape;

      return config;
    }),
  );

const LayerLive = (input: CliInput) => {
  const { runtimeServicesLayer, providerLayer } = makeServerApplicationLayers();
  const providerSessionReaperLayer = ProviderSessionReaperLive.pipe(
    // The reaper coordinates orchestration state with live provider sessions,
    // so it belongs at the top level where both layers are available.
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(providerLayer),
  );
  const providerRuntimeReconcilerLayer = ProviderRuntimeReconcilerLive.pipe(
    Layer.provide(ProviderRuntimeEventRepositoryLive),
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(providerLayer),
  );
  return Layer.empty.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(providerLayer),
    Layer.provideMerge(providerSessionReaperLayer),
    Layer.provideMerge(providerRuntimeReconcilerLayer),
    Layer.provideMerge(SqlitePersistence.layerConfig),
    Layer.provideMerge(ServerLoggerLive),
    Layer.provideMerge(ServerConfigLive(input)),
  );
};

export function makeServerStartupLogData(config: ServerConfigShape): Record<string, unknown> {
  const safeConfig: Record<string, unknown> = { ...config };
  delete safeConfig.authToken;
  delete safeConfig.desktopShutdownToken;
  delete safeConfig.migrationDivergenceConsent;
  delete safeConfig.devUrl;

  return {
    ...safeConfig,
    devUrl: config.devUrl?.toString(),
    authEnabled: Boolean(config.authToken),
  };
}

const makeServerProgram = (input: CliInput) =>
  Effect.gen(function* () {
    const cliConfig = yield* CliConfig;
    const { start, stopSignal } = yield* Server;
    const openDeps = yield* Open;
    const serverAuth = yield* ServerAuth;
    const serverSettings = yield* ServerSettingsService;
    yield* cliConfig.fixPath;

    const config = yield* ServerConfig;
    yield* Effect.sync(() => startServerMemoryDiagnostics({ mode: config.mode }));

    if (!config.devUrl && !config.staticDir) {
      yield* Effect.logWarning(
        "web bundle missing and no VITE_DEV_SERVER_URL; web UI unavailable",
        {
          hint: "Run `bun run --cwd apps/web build` or set VITE_DEV_SERVER_URL for dev mode.",
        },
      );
    }

    yield* start;

    const localUrl = `http://localhost:${config.port}`;
    const bindUrl =
      config.host && !isWildcardHost(config.host)
        ? `http://${formatHostForUrl(config.host)}:${config.port}`
        : localUrl;
    const pairingBaseUrl = config.publicUrl?.origin ?? bindUrl;
    const startupPairingUrl =
      config.publicUrl || !isLoopbackHost(config.host)
        ? yield* serverAuth.issueStartupPairingUrl(pairingBaseUrl).pipe(
            Effect.mapError(
              (cause) =>
                new StartupError({
                  message: "Failed to create the remote-access startup pairing link.",
                  cause,
                }),
            ),
          )
        : undefined;

    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    // Start the retention loop after the server is live so startup can serve
    // existing history first, then hide inactive threads from the app in the background.
    yield* startThreadRetentionJob(orchestrationEngine, projectionSnapshotQuery);
    // Optional Claude OAuth keepalive. Disabled by default because it touches
    // Claude Code auth data in the background; users can opt in with
    // GLADE_CLAUDE_KEEPALIVE=1.
    const claudeKeepalive = createClaudeCredentialKeepaliveController({
      homeDir: config.homeDir,
      log: (message) => Effect.runFork(Effect.logInfo(message)),
    });
    const reconcileClaudeKeepalive = (settings: {
      readonly providers: {
        readonly claudeAgent: { readonly enabled: boolean; readonly binaryPath?: string };
      };
    }) =>
      Effect.promise(() =>
        claudeKeepalive.reconcile({
          enabled: settings.providers.claudeAgent.enabled,
          ...(settings.providers.claudeAgent.binaryPath !== undefined
            ? { binaryPath: settings.providers.claudeAgent.binaryPath }
            : {}),
        }),
      );
    // Attach before reading the initial snapshot. The settings PubSub does not
    // replay, so reading first could miss a disable/path update in the small
    // window before the stream consumer subscribes.
    const claudeKeepaliveSettingsChanges = yield* serverSettings.streamChanges.pipe(
      Stream.toQueue({ capacity: "unbounded" }),
    );
    yield* reconcileClaudeKeepalive(yield* serverSettings.getSettings);
    yield* Stream.fromQueue(claudeKeepaliveSettingsChanges).pipe(
      Stream.runForEach(reconcileClaudeKeepalive),
      Effect.ensuring(Effect.promise(() => claudeKeepalive.stop())),
      Effect.forkChild,
    );

    yield* Effect.logInfo("Glade running", makeServerStartupLogData(config));
    if (startupPairingUrl) {
      if (config.allowInsecureRemote && !config.publicUrl) {
        yield* Effect.logWarning(
          "INSECURE REMOTE ACCESS ENABLED: credentials and session traffic are unencrypted",
          {
            pairingUrl: startupPairingUrl,
            hint: "Use only on a trusted LAN. Configure GLADE_PUBLIC_URL behind HTTPS for protected remote access.",
          },
        );
      }
      yield* Effect.logInfo(
        config.publicUrl
          ? "Remote access requires an authenticated owner session"
          : "Insecure remote pairing link created",
        {
          pairingUrl: startupPairingUrl,
          hint:
            isWildcardHost(config.host) && !config.publicUrl
              ? "Replace localhost in this one-time URL with the server's reachable hostname or IP."
              : "Open this one-time URL to establish the first owner session.",
        },
      );
    }

    if (!config.noBrowser) {
      const target = startupPairingUrl ?? config.devUrl?.toString() ?? bindUrl;
      yield* openDeps.openBrowser(target).pipe(
        Effect.catch(() =>
          Effect.logInfo("browser auto-open unavailable", {
            hint: `Open ${target} in your browser.`,
          }),
        ),
      );
    }

    return yield* stopSignal;
  }).pipe(Effect.scoped, Effect.provide(LayerLive(input)));

/**
 * These flags mirrors the environment variables and the config shape.
 */

const modeFlag = Flag.choice("mode", ["web", "desktop"]).pipe(
  Flag.withDescription("Runtime mode. `desktop` keeps loopback defaults unless overridden."),
  Flag.optional,
);
const portFlag = Flag.integer("port").pipe(
  Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
const hostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host/interface to bind (for example 127.0.0.1, 0.0.0.0, or a Tailnet IP)."),
  Flag.optional,
);
const gladeHomeFlag = Flag.string("home-dir").pipe(
  Flag.withDescription("Base directory for all Glade data (equivalent to GLADE_HOME)."),
  Flag.optional,
);
const devUrlFlag = Flag.string("dev-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription("Dev web URL to proxy/redirect to (equivalent to VITE_DEV_SERVER_URL)."),
  Flag.optional,
);
const publicUrlFlag = Flag.string("public-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription(
    "HTTPS public root origin provided by a TLS-terminating reverse proxy (equivalent to GLADE_PUBLIC_URL).",
  ),
  Flag.optional,
);
const allowInsecureRemoteFlag = optionalBooleanFlag("allow-insecure-remote", {
  description:
    "Explicitly allow unencrypted authenticated remote access on a trusted LAN (equivalent to GLADE_ALLOW_INSECURE_REMOTE).",
});
const noBrowserFlag = optionalBooleanFlag("no-browser", {
  description: "Disable automatic browser opening.",
  negativeName: "browser",
  negativeDescription: "Enable automatic browser opening.",
});
const authTokenFlag = Flag.string("auth-token").pipe(
  Flag.withDescription("Auth token required for WebSocket connections."),
  Flag.withAlias("token"),
  Flag.optional,
);
const autoBootstrapProjectFromCwdFlag = optionalBooleanFlag("auto-bootstrap-project-from-cwd", {
  description: "Create a project for the current working directory on startup when missing.",
});
const logProviderEventsFlag = optionalBooleanFlag("log-provider-events", {
  description:
    "Emit native/canonical provider NDJSON logs for debugging (equivalent to GLADE_LOG_PROVIDER_EVENTS).",
});
const logWebSocketEventsFlag = optionalBooleanFlag("log-websocket-events", {
  description:
    "Emit server-side logs for outbound WebSocket push traffic (equivalent to GLADE_LOG_WS_EVENTS).",
  aliases: ["log-ws-events"],
});

// Base `glade` command defined before the MCP subcommands so they can yield
// its parsed input (notably `--home-dir` / `gladeHome`) via Effect's command
// context. This avoids a duplicate `--home-dir` flag between the root command
// and its MCP subcommands, which the Effect CLI assigns to the parent and
// leaves the subcommand flag unset.
const baseServerCommand = Command.make("glade", {
  mode: modeFlag,
  port: portFlag,
  host: hostFlag,
  gladeHome: gladeHomeFlag,
  devUrl: devUrlFlag,
  publicUrl: publicUrlFlag,
  allowInsecureRemote: allowInsecureRemoteFlag,
  noBrowser: noBrowserFlag,
  authToken: authTokenFlag,
  autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
  logProviderEvents: logProviderEventsFlag,
  logWebSocketEvents: logWebSocketEventsFlag,
}).pipe(Command.withDescription("Run the Glade server."));

const serverStatusCommand = Command.make(
  "status",
  {
    url: Flag.string("url").pipe(
      Flag.withDescription("Glade server base URL to probe."),
      Flag.optional,
    ),
    json: Flag.boolean("json").pipe(
      Flag.withDescription("Print machine-readable JSON."),
      Flag.withDefault(false),
    ),
  },
  ({ url, json }) =>
    Effect.gen(function* () {
      const parent = yield* baseServerCommand;
      const discovered = Option.isSome(url)
        ? { url: url.value }
        : (() => {
            const baseDir = resolveServerHome(Option.getOrUndefined(parent.gladeHome));
            try {
              const runtime = discoverServerRuntime(baseDir);
              return { url: runtime.state.origin, runtime };
            } catch (cause) {
              return {
                error:
                  cause instanceof Error
                    ? cause.message
                    : "Failed to discover a running Glade server.",
              };
            }
          })();
      const result =
        "error" in discovered
          ? {
              reachable: false as const,
              ready: false as const,
              url: "[undiscovered]",
              error: discovered.error,
            }
          : yield* Effect.promise(async () => {
              try {
                if ("runtime" in discovered) {
                  await verifyServerRuntime(discovered.runtime, globalThis.fetch);
                }
                return await fetchGladeServerStatus({ url: discovered.url });
              } catch (cause) {
                return {
                  reachable: false as const,
                  ready: false as const,
                  url: discovered.url,
                  error:
                    cause instanceof Error
                      ? cause.message
                      : "Failed to verify the discovered Glade server.",
                };
              }
            });
      process.stdout.write(
        json ? `${JSON.stringify(result, null, 2)}\n` : `${formatGladeServerStatus(result)}\n`,
      );
      if (!result.ready) {
        process.exitCode = 1;
      }
    }),
).pipe(Command.withDescription("Check whether a Glade server is reachable and ready."));

const serverToolsCommand = Command.make("server").pipe(
  Command.withDescription("Inspect and manage a running Glade server."),
  Command.withSubcommands([serverStatusCommand]),
);

const serverCommand = baseServerCommand.pipe(
  Command.withHandler((input) => makeServerProgram(input)),
  Command.withSubcommands([serverToolsCommand]),
);

export const gladeCli = serverCommand;
