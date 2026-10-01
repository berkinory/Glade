import { Effect } from "effect";
import { resolveExecutable } from "@glade/shared/platform/executable";
import type {
  ProviderListMcpServersResult,
  ProviderPluginInventoryResult,
} from "@glade/contracts/provider/providerManagement";
import type { ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import type { ClaudeSessionRegistryShape } from "../../Services/ClaudeSessionRegistry.ts";
import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "../../core/Errors.ts";
import type { ServerConfigShape } from "../../../server/config.ts";
import { buildClaudeProcessEnv } from "../claudeProcessEnv.ts";
import { execProcessFileAsync } from "../../../platform/processRunner.ts";
import { GLADE_MCP_SERVER_NAME } from "../../../agentGateway/mcpInjection.ts";
import { PROVIDER } from "./sessionTypes.ts";
import { toRequestError } from "./streamErrors.ts";

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*(?:@[a-zA-Z0-9_.-]+)?$/u;
const SAFE_ENV_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/u;

function pluginEntries(value: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(value))
    return value.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry),
    );
  if (typeof value === "object" && value !== null && "plugins" in value) {
    return pluginEntries(value.plugins);
  }
  return [];
}

export function makeClaudeManagement(input: {
  readonly sessions: ClaudeSessionRegistryShape;
  readonly serverConfig: ServerConfigShape;
}): Pick<
  ClaudeAdapterShape,
  "listMcpServers" | "manageMcpServer" | "pluginInventory" | "managePlugin"
> {
  const { sessions, serverConfig } = input;
  const sessionFor = (threadId: string | undefined) =>
    threadId
      ? [...sessions.list()].find(
          (session) => session.session.threadId === threadId && !session.stopped,
        )
      : undefined;
  const runCli = async (threadId: string | undefined, cwd: string | undefined, args: string[]) => {
    const session = sessionFor(threadId);
    const env = buildClaudeProcessEnv({ homeDir: serverConfig.homeDir });
    const selected = session?.startInput.providerOptions?.claudeAgent?.binaryPath ?? "claude";
    const workingDirectory = cwd ?? session?.startInput.cwd ?? serverConfig.cwd;
    const binary = resolveExecutable(selected, { env, cwd: workingDirectory });
    if (!binary) throw new Error("Claude CLI is unavailable.");
    const result = await execProcessFileAsync(binary, args, {
      cwd: workingDirectory,
      env,
      requireExecutable: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    return result.stdout;
  };
  const validateName = (name: string, operation: string) =>
    SAFE_NAME.test(name)
      ? Effect.void
      : Effect.fail(
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation,
            issue:
              "The name must contain only letters, numbers, dots, underscores, hyphens and an optional marketplace suffix.",
          }),
        );

  const listMcpServers: NonNullable<ClaudeAdapterShape["listMcpServers"]> = (context) =>
    Effect.gen(function* () {
      const session = sessionFor(context.threadId);
      if (!session) {
        return {
          servers: [],
          source: "no-active-session",
          canAdd: true,
          error: "Start a Claude session to inspect live MCP status.",
        } satisfies ProviderListMcpServersResult;
      }
      const statuses = yield* Effect.tryPromise({
        try: () => session.query.mcpServerStatus(),
        catch: (cause) => toRequestError(session.session.threadId, "mcpServerStatus", cause),
      });
      return {
        servers: statuses.map((status) => {
          const scope = status.scope;
          const managed = status.name === GLADE_MCP_SERVER_NAME;
          const editable =
            !managed && (scope === "user" || scope === "project" || scope === "local");
          const transport =
            status.config?.type === "http"
              ? ("http" as const)
              : status.config?.type === "stdio" || (status.config && "command" in status.config)
                ? ("stdio" as const)
                : ("unknown" as const);
          return {
            id: `${scope ?? "unknown"}:${status.name}`,
            name: status.name,
            provider: PROVIDER,
            ...(scope ? { scope } : {}),
            transport,
            status: status.status === "connected" ? ("ready" as const) : status.status,
            ...(status.tools ? { toolCount: status.tools.length } : {}),
            ...(status.error
              ? {
                  error:
                    "Claude reported an MCP server error. Open Claude's /mcp command for details.",
                }
              : {}),
            managed: managed || !editable,
            actions: managed
              ? []
              : [
                  ...(status.status === "needs-auth" ? ["authenticate" as const] : []),
                  "reconnect" as const,
                  status.status === "disabled" ? ("enable" as const) : ("disable" as const),
                  ...(editable ? ["remove" as const] : []),
                ],
          };
        }),
        source: "claude-sdk",
        canAdd: true,
      } satisfies ProviderListMcpServersResult;
    });

  const manageMcpServer: NonNullable<ClaudeAdapterShape["manageMcpServer"]> = (request) =>
    Effect.gen(function* () {
      yield* validateName(request.name, "manageMcpServer");
      if (request.name === GLADE_MCP_SERVER_NAME)
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "manageMcpServer",
          issue: "The Glade gateway is managed by Glade.",
        });
      const session = sessionFor(request.threadId);
      if (request.action === "authenticate") {
        return {
          applied: false,
          affects: "session",
          message: "Open Claude's native /mcp command to authenticate this server.",
        };
      }
      if (
        request.action === "reconnect" ||
        request.action === "enable" ||
        request.action === "disable"
      ) {
        if (!session)
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "manageMcpServer",
            issue: "This action needs an active Claude session.",
          });
        yield* Effect.tryPromise({
          try: () =>
            request.action === "reconnect"
              ? session.query.reconnectMcpServer(request.name)
              : session.query.toggleMcpServer(request.name, request.action === "enable"),
          catch: (cause) => toRequestError(session.session.threadId, "manageMcpServer", cause),
        });
        return { applied: true, affects: "session" };
      }
      if (!request.scope)
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "manageMcpServer",
          issue: "Choose a user, project or local scope.",
        });
      const args = ["mcp"];
      if (request.action === "remove") {
        args.push("remove", "--scope", request.scope, request.name);
      } else {
        const config = request.configuration;
        if (!config)
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "manageMcpServer",
            issue: "A server configuration is required.",
          });
        args.push("add", "--scope", request.scope, "--transport", config.transport, request.name);
        if (config.transport === "stdio") {
          for (const [key, value] of Object.entries(config.env ?? {})) {
            if (!SAFE_ENV_NAME.test(key))
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "manageMcpServer",
                issue: `Invalid environment variable name: ${key}.`,
              });
            args.push("--env", `${key}=${value}`);
          }
          args.push("--", config.command, ...config.args);
        } else {
          const url = URL.parse(config.url);
          if (!url || !["https:", "http:"].includes(url.protocol))
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "manageMcpServer",
              issue: "HTTP MCP servers require an http or https URL.",
            });
          for (const [key, value] of Object.entries(config.headers ?? {})) {
            if (!/^[A-Za-z0-9-]+$/u.test(key))
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "manageMcpServer",
                issue: `Invalid HTTP header name: ${key}.`,
              });
            args.push("--header", `${key}: ${value}`);
          }
          args.push(config.url);
        }
      }
      yield* Effect.tryPromise({
        try: () => runCli(request.threadId, request.cwd, args),
        catch: () =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "manageMcpServer",
            detail: "Claude CLI could not update this MCP server.",
          }),
      });
      return { applied: true, affects: "next-session" };
    });

  const pluginInventory: NonNullable<ClaudeAdapterShape["pluginInventory"]> = (context) =>
    Effect.gen(function* () {
      const output = yield* Effect.tryPromise({
        try: () => runCli(context.threadId, context.cwd, ["plugin", "list", "--json"]),
        catch: () =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "pluginInventory",
            detail: "Claude CLI could not list installed plugins.",
          }),
      });
      const parsed = yield* Effect.try({
        try: () => JSON.parse(output) as unknown,
        catch: () =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "pluginInventory",
            detail: "Claude CLI returned invalid plugin inventory JSON.",
          }),
      });
      const session = sessionFor(context.threadId);
      const loaded = session?.loadedPluginNames;
      return {
        plugins: pluginEntries(parsed).flatMap((entry) => {
          const id =
            typeof entry.id === "string"
              ? entry.id
              : typeof entry.name === "string"
                ? entry.name
                : undefined;
          if (!id) return [];
          const name = typeof entry.name === "string" ? entry.name : id.split("@")[0]!;
          const scope = typeof entry.scope === "string" ? entry.scope : undefined;
          const version = typeof entry.version === "string" ? entry.version : undefined;
          const enabled = typeof entry.enabled === "boolean" ? entry.enabled : undefined;
          return [
            {
              id,
              name,
              provider: PROVIDER,
              installed: true,
              ...(scope ? { scope } : {}),
              ...(version ? { version } : {}),
              ...(enabled !== undefined ? { enabled } : {}),
              ...(loaded ? { loaded: loaded.has(id) || loaded.has(name) } : {}),
              actions: [
                "remove" as const,
                enabled === false ? ("enable" as const) : ("disable" as const),
                "reload" as const,
              ],
            },
          ];
        }),
        source: "claude-cli",
        canInstall: true,
      } satisfies ProviderPluginInventoryResult;
    });

  const managePlugin: NonNullable<ClaudeAdapterShape["managePlugin"]> = (request) =>
    Effect.gen(function* () {
      yield* validateName(request.id, "managePlugin");
      const session = sessionFor(request.threadId);
      if (request.action === "reload") {
        if (!session)
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "managePlugin",
            issue: "Reload needs an active Claude session.",
          });
        const refreshed = yield* Effect.tryPromise({
          try: () => session.query.reloadPlugins(),
          catch: (cause) => toRequestError(session.session.threadId, "reloadPlugins", cause),
        });
        session.loadedPluginNames = new Set(refreshed.plugins.map((plugin) => plugin.name));
        return { applied: true, affects: "session" };
      }
      if (request.action === "install" && request.marketplacePath) {
        const marketplacePath = request.marketplacePath;
        if (!request.remoteMarketplaceName)
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "managePlugin",
            issue: "A marketplace name is required with a marketplace source.",
          });
        yield* validateName(request.remoteMarketplaceName, "managePlugin");
        yield* Effect.tryPromise({
          try: () =>
            runCli(request.threadId, request.cwd, [
              "plugin",
              "marketplace",
              "add",
              "--scope",
              request.scope ?? "user",
              marketplacePath,
            ]),
          catch: () =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "managePlugin",
              detail: "Claude CLI could not register this marketplace.",
            }),
        });
      }
      const pluginId =
        request.action === "install" && request.remoteMarketplaceName && !request.id.includes("@")
          ? `${request.id}@${request.remoteMarketplaceName}`
          : request.id;
      yield* validateName(pluginId, "managePlugin");
      const args = [
        "plugin",
        request.action === "remove" ? "uninstall" : request.action,
        pluginId,
        "--json",
      ];
      if (request.scope) args.push("--scope", request.scope);
      yield* Effect.tryPromise({
        try: () => runCli(request.threadId, request.cwd, args),
        catch: () =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "managePlugin",
            detail: "Claude CLI could not change this plugin.",
          }),
      });
      return { applied: true, affects: "next-session" };
    });

  return { listMcpServers, manageMcpServer, pluginInventory, managePlugin };
}
