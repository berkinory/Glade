import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderMcpServer } from "@glade/contracts/provider/providerDiscovery";
import type { McpCatalog, McpConnectorPreset } from "@glade/contracts/server/mcpCatalog";
import type { McpConnector } from "@glade/contracts/transport/ws/mcpConnectorsRpc";

type Presets = ReadonlyArray<McpConnectorPreset>;

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

export function connectorPreset(
  connector: McpConnector,
  presets: Presets,
): McpConnectorPreset | undefined {
  return connector.presetId
    ? presets.find((preset) => preset.id === connector.presetId)
    : undefined;
}

export function targetForConnector(connector: McpConnector, presets: Presets): ConnectorTarget {
  const preset = connectorPreset(connector, presets);
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

export function connectorIconUrl(connector: McpConnector, presets: Presets): string {
  return connectorPreset(connector, presets)?.homepage ?? connector.url;
}

function matches(query: string, fields: ReadonlyArray<string>): boolean {
  return query.length === 0 || fields.some((field) => field.toLowerCase().includes(query));
}

export function filterConnected(
  connectors: ReadonlyArray<McpConnector>,
  presets: Presets,
  query: string,
): ReadonlyArray<McpConnector> {
  return connectors
    .filter((connector) =>
      matches(query, [
        connector.name,
        connectorHost(connector.url),
        connectorPreset(connector, presets)?.description ?? "",
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
  catalog: McpCatalog,
  query: string,
  connectedPresetIds: ReadonlySet<string>,
): ReadonlyArray<CatalogShelf> {
  return catalog.categories.flatMap((category) => {
    const presets = catalog.presets.filter(
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

function presetFor(
  name: string,
  origin: string | null,
  presets: Presets,
): McpConnectorPreset | undefined {
  const byOrigin = origin
    ? presets.find((preset) => connectorOrigin(preset.url) === origin)
    : undefined;
  if (byOrigin) return byOrigin;
  const key = normalizedName(name);
  return presets.find(
    (preset) => normalizedName(preset.id) === key || normalizedName(preset.name) === key,
  );
}

export function agentServerRows(
  sources: ReadonlyArray<AgentServerSource>,
  connectors: ReadonlyArray<McpConnector>,
  presets: Presets,
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
      const preset = presetFor(name, origin, presets);
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
