import { Effect, Layer, Schema, SchemaIssue } from "effect";
import {
  ProviderManagementContext,
  ProviderManageMcpServerInput,
  ProviderManagePluginInput,
} from "@glade/contracts/provider/providerManagement";
import {
  ProviderManagement,
  type ProviderManagementShape,
} from "../Services/ProviderManagement.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderValidationError } from "../core/Errors.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";

const invalid = (operation: string, issue: string) =>
  new ProviderValidationError({ operation, issue });
const decode = <S extends Schema.Top>(schema: S, value: unknown, operation: string) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => invalid(operation, SchemaIssue.makeFormatterDefault()(cause.issue))),
  );

export const ProviderManagementLive = Layer.effect(
  ProviderManagement,
  Effect.gen(function* () {
    const registry = yield* ProviderAdapterRegistry;
    const settings = yield* ServerSettingsService;
    const adapterFor = Effect.fn("ProviderManagement.adapterFor")(function* (
      context: ProviderManagementContext,
    ) {
      const configured = yield* settings.getSettings.pipe(
        Effect.mapError(() => invalid("ProviderManagement", "Provider settings are unavailable.")),
      );
      if (!configured.providers[context.provider].enabled)
        return yield* invalid("ProviderManagement", "This provider is disabled in Glade settings.");
      return yield* registry.getByProvider(context.provider);
    });

    const listMcpServers: ProviderManagementShape["listMcpServers"] = (input) =>
      Effect.gen(function* () {
        const parsed = yield* decode(ProviderManagementContext, input, "listMcpServers");
        const adapter = yield* adapterFor(parsed);
        if (!adapter.listMcpServers)
          return {
            servers: [],
            source: "unsupported",
            canAdd: false,
            error: "MCP management is unavailable for this provider.",
          };
        const result = yield* adapter.listMcpServers(parsed);
        return {
          ...result,
          servers: result.servers.map((server) =>
            server.name.toLowerCase() === "glade"
              ? { ...server, managed: true, actions: [] }
              : server,
          ),
        };
      });

    const manageMcpServer: ProviderManagementShape["manageMcpServer"] = (input) =>
      Effect.gen(function* () {
        const parsed = yield* decode(ProviderManageMcpServerInput, input, "manageMcpServer");
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(parsed.name))
          return yield* invalid(
            "manageMcpServer",
            "Use an MCP server name containing letters, numbers, hyphens or underscores.",
          );
        if (parsed.name.toLowerCase() === "glade")
          return yield* invalid(
            "manageMcpServer",
            "The Glade gateway is managed by Glade and cannot be changed here.",
          );
        if (parsed.action === "add") {
          if (!parsed.configuration || !parsed.scope)
            return yield* invalid(
              "manageMcpServer",
              "Adding a server requires a configuration and an explicit scope.",
            );
          if (parsed.configuration.transport === "http") {
            const url = yield* Effect.try({
              try: () =>
                new URL(
                  parsed.configuration!.transport === "http" ? parsed.configuration!.url : "",
                ),
              catch: () => invalid("manageMcpServer", "Enter a valid HTTP or HTTPS server URL."),
            });
            if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
              return yield* invalid(
                "manageMcpServer",
                "Use an HTTP or HTTPS URL without embedded credentials.",
              );
          }
        } else if (parsed.configuration)
          return yield* invalid(
            "manageMcpServer",
            "Only an add operation accepts server configuration.",
          );
        if (
          parsed.provider === "codex" &&
          ["add", "remove", "enable", "disable"].includes(parsed.action) &&
          !parsed.expectedVersion
        )
          return yield* invalid(
            "manageMcpServer",
            "Refresh the native configuration before changing this server.",
          );
        const adapter = yield* adapterFor(parsed);
        if (!adapter.manageMcpServer)
          return yield* invalid(
            "manageMcpServer",
            "This provider does not support MCP management.",
          );
        return yield* adapter.manageMcpServer(parsed);
      });

    const pluginInventory: ProviderManagementShape["pluginInventory"] = (input) =>
      Effect.gen(function* () {
        const parsed = yield* decode(ProviderManagementContext, input, "pluginInventory");
        const adapter = yield* adapterFor(parsed);
        if (!adapter.pluginInventory)
          return {
            plugins: [],
            source: "unsupported",
            canInstall: false,
            error: "Plugin management is unavailable for this provider.",
          };
        return yield* adapter.pluginInventory(parsed);
      });

    const managePlugin: ProviderManagementShape["managePlugin"] = (input) =>
      Effect.gen(function* () {
        const parsed = yield* decode(ProviderManagePluginInput, input, "managePlugin");
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._@/-]{0,255}$/.test(parsed.id) || parsed.id.includes(".."))
          return yield* invalid("managePlugin", "Enter a valid native plugin identifier.");
        if (parsed.id === "glade-shared-skills" || parsed.id.startsWith("glade-shared-skills@"))
          return yield* invalid("managePlugin", "The shared skills bridge is managed by Glade.");
        const adapter = yield* adapterFor(parsed);
        if (!adapter.managePlugin)
          return yield* invalid(
            "managePlugin",
            "This provider does not support plugin management.",
          );
        return yield* adapter.managePlugin(parsed);
      });

    return {
      listMcpServers,
      manageMcpServer,
      pluginInventory,
      managePlugin,
    } satisfies ProviderManagementShape;
  }),
);
