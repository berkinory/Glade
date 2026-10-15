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
