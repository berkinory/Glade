import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderMcpServer } from "@glade/contracts/provider/providerDiscovery";
import type { McpConnector } from "@glade/contracts/transport/ws/mcpConnectorsRpc";
import {
  findMcpConnectorPreset,
  MCP_CONNECTOR_CATEGORIES,
  MCP_CONNECTOR_PRESETS,
  type McpConnectorPreset,
} from "@glade/shared/mcpConnectors/catalog";

// What the connect dialog is for: a catalog preset, or a server the user names by URL. An empty
// custom URL means a new custom server.
export type ConnectorTarget =
  | { readonly kind: "preset"; readonly preset: McpConnectorPreset }
  | { readonly kind: "custom"; readonly url: string; readonly name: string };

export function connectorHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function connectorPreset(connector: McpConnector): McpConnectorPreset | undefined {
  return connector.presetId ? findMcpConnectorPreset(connector.presetId) : undefined;
}

export function targetForConnector(connector: McpConnector): ConnectorTarget {
  const preset = connectorPreset(connector);
  return preset
    ? { kind: "preset", preset }
    : { kind: "custom", url: connector.url, name: connector.name };
}

export function targetName(target: ConnectorTarget): string {
  return target.kind === "preset" ? target.preset.name : target.name || "Custom server";
}

// The site whose favicon stands for the target.
export function targetIconUrl(target: ConnectorTarget): string {
  return target.kind === "preset" ? target.preset.homepage : target.url;
}

export function connectorIconUrl(connector: McpConnector): string {
  return connectorPreset(connector)?.homepage ?? connector.url;
}

function matches(query: string, fields: ReadonlyArray<string>): boolean {
  return query.length === 0 || fields.some((field) => field.toLowerCase().includes(query));
}

export function filterConnected(
  connectors: ReadonlyArray<McpConnector>,
  query: string,
): ReadonlyArray<McpConnector> {
  return connectors
    .filter((connector) =>
      matches(query, [
        connector.name,
        connectorHost(connector.url),
        connectorPreset(connector)?.description ?? "",
      ]),
    )
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

export interface CatalogShelf {
  readonly id: string;
  readonly label: string;
  readonly presets: ReadonlyArray<McpConnectorPreset>;
}

// Connected presets leave the catalog: they are listed, with their actions, above it.
export function catalogShelves(
  query: string,
  connectedPresetIds: ReadonlySet<string>,
): ReadonlyArray<CatalogShelf> {
  return MCP_CONNECTOR_CATEGORIES.flatMap((category) => {
    const presets = MCP_CONNECTOR_PRESETS.filter(
      (preset) =>
        preset.category === category.id &&
        !connectedPresetIds.has(preset.id) &&
        matches(query, [preset.name, preset.description, category.label]),
    );
    return presets.length > 0 ? [{ id: category.id, label: category.label, presets }] : [];
  });
}

export interface AgentServerSource {
  readonly provider: ProviderKind;
  readonly server: ProviderMcpServer;
}

// One MCP server as the agents configure it, merged across agents by name.
export interface AgentServerRow {
  readonly name: string;
  readonly origin: string | null;
  readonly sources: ReadonlyArray<AgentServerSource>;
  // The catalog entry for the same service, when Glade offers it as a connector.
  readonly preset: McpConnectorPreset | undefined;
  // Set when the same service is also connected in Glade, so agents load it twice.
  readonly connector: McpConnector | undefined;
}

const normalizedName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/gu, "");

function presetFor(name: string, origin: string | null): McpConnectorPreset | undefined {
  const byOrigin = origin
    ? MCP_CONNECTOR_PRESETS.find((preset) => new URL(preset.url).origin === origin)
    : undefined;
  if (byOrigin) return byOrigin;
  const key = normalizedName(name);
  return MCP_CONNECTOR_PRESETS.find(
    (preset) => normalizedName(preset.id) === key || normalizedName(preset.name) === key,
  );
}

export function agentServerRows(
  sources: ReadonlyArray<AgentServerSource>,
  connectors: ReadonlyArray<McpConnector>,
): ReadonlyArray<AgentServerRow> {
  const byName = new Map<string, AgentServerSource[]>();
  for (const source of sources) {
    const key = normalizedName(source.server.name);
    byName.set(key, [...(byName.get(key) ?? []), source]);
  }
  return [...byName.values()]
    .flatMap((group): AgentServerRow[] => {
      const [first] = group;
      if (!first) return [];
      const name = first.server.name;
      const origin = group.find((entry) => entry.server.origin)?.server.origin ?? null;
      const preset = presetFor(name, origin);
      const connector = connectors.find(
        (entry) =>
          (preset !== undefined && entry.presetId === preset.id) ||
          (origin !== null && connectorOrigin(entry.url) === origin),
      );
      return [{ name, origin, sources: group, preset, connector }];
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function connectorOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
