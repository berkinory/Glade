import { join } from "node:path";
import type {
  ProviderMcpServer,
  ProviderInstalledPlugin,
  ProviderManagementScope,
} from "@glade/contracts/provider/providerManagement";
import type { ConfigReadResponse } from "./protocol/generated/types/v2/ConfigReadResponse";
import type { McpServerStatus } from "./protocol/generated/types/v2/McpServerStatus";
import type { PluginSummary } from "./protocol/generated/types/v2/PluginSummary";
import { GLADE_MCP_SERVER_NAME } from "../../agentGateway/mcpInjection.ts";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function codexConfigTarget(
  response: ConfigReadResponse,
  scope: ProviderManagementScope,
): { version: string; filePath?: string } | undefined {
  if (scope === "local") return undefined;
  const layer = response.layers?.find((entry) =>
    scope === "user"
      ? entry.name.type === "user" && entry.name.profile === null
      : entry.name.type === "project",
  );
  if (!layer?.version) return undefined;
  if (layer.name.type === "user") {
    return { version: layer.version, filePath: layer.name.file };
  }
  if (layer.name.type === "project") {
    return { version: layer.version, filePath: join(layer.name.dotCodexFolder, "config.toml") };
  }
  return undefined;
}

function configuredServer(
  response: ConfigReadResponse,
  name: string,
): { transport: ProviderMcpServer["transport"]; scope?: string; version?: string } {
  for (const layer of response.layers ?? []) {
    const server = record(record(record(layer.config)?.mcp_servers)?.[name]);
    if (!server) continue;
    return {
      transport:
        typeof server.url === "string"
          ? "http"
          : typeof server.command === "string"
            ? "stdio"
            : "unknown",
      scope: layer.name.type,
      ...(layer.name.type === "project" ||
      (layer.name.type === "user" && layer.name.profile === null)
        ? { version: layer.version }
        : {}),
    };
  }
  return { transport: "unknown" };
}

export function codexMcpServer(
  native: McpServerStatus,
  config: ConfigReadResponse,
): ProviderMcpServer {
  const managed = native.name === GLADE_MCP_SERVER_NAME;
  const configured = configuredServer(config, native.name);
  const configVersion = configured.version;
  const status: ProviderMcpServer["status"] =
    native.runtimeStatus === "notStarted"
      ? "pending"
      : native.runtimeStatus === "connected"
        ? "ready"
        : native.runtimeStatus === "authenticationRequired"
          ? "needs-auth"
          : (native.runtimeStatus ?? "unknown");
  return {
    id: native.name,
    name: native.name,
    provider: "codex",
    ...(configured.scope ? { scope: configured.scope } : {}),
    transport: native.httpOrigin ? "http" : configured.transport,
    status,
    toolCount: Object.keys(native.tools ?? {}).length,
    managed,
    actions: managed
      ? []
      : [
          ...(native.authStatus === "notLoggedIn" ? ["authenticate" as const] : []),
          "reconnect" as const,
          ...(configVersion
            ? [
                status === "disabled" ? ("enable" as const) : ("disable" as const),
                "remove" as const,
              ]
            : []),
        ],
    ...(configVersion ? { configVersion } : {}),
  };
}

export function codexInstalledPlugin(plugin: PluginSummary): ProviderInstalledPlugin {
  return {
    id: plugin.id,
    name: plugin.name,
    provider: "codex",
    ...(plugin.localVersion || plugin.version
      ? { version: plugin.localVersion ?? plugin.version! }
      : {}),
    installed: plugin.installed,
    enabled: plugin.enabled,
    actions: plugin.installed
      ? [plugin.enabled ? "disable" : "enable", "remove", "reload"]
      : ["install"],
  };
}
