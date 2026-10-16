import type { McpConnector } from "@glade/contracts/transport/ws/mcpConnectorsRpc";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { RefreshCwIcon } from "~/lib/icons";
import { mcpServersQueryOptions } from "~/lib/providerDiscoveryReactQuery";
import { providerNames } from "~/lib/providerNames";
import { DEFAULT_PROVIDER_ORDER } from "~/providerOrdering";
import { Button } from "../../ui/button";
import { IconButton } from "../../ui/icon-button";
import { ProviderStack } from "../ProviderStack";
import { SettingsCard, SettingsEmptyState, SettingsSectionShell } from "../SettingsPanelPrimitives";
import { ConnectorIcon } from "./ConnectorIcon";
import { reloadAgentMcpServers } from "./useAgentServerRemoval";
import { type AgentServerRow, agentServerRows, connectorHost } from "./connectors.logic";

function rowSummary(row: AgentServerRow): { text: string; problem: boolean } {
  const trouble = row.sources.find(
    (source) => source.server.status === "needs-sign-in" || source.server.status === "failed",
  );
  if (trouble) {
    const agent = PROVIDER_DISPLAY_NAMES[trouble.provider];
    return trouble.server.status === "needs-sign-in"
      ? { text: `Needs sign-in in ${agent}.`, problem: true }
      : { text: trouble.server.detail ?? `Could not start in ${agent}.`, problem: true };
  }
  if (row.connector) {
    return { text: "Also connected in Glade, so agents load it twice.", problem: true };
  }
  const tools = row.sources.find((source) => source.server.toolCount !== null)?.server.toolCount;
  const where = row.origin ? connectorHost(row.origin) : "Local server";
  return { text: tools ? `${where} · ${tools} tools` : where, problem: false };
}

// Servers come from each agent's own settings. Glade removes one there only once the same service
// is connected in Glade, and only after the user confirms.
export function AgentMcpServersSection(props: {
  readonly connectors: ReadonlyArray<McpConnector>;
  readonly query: string;
  readonly removing: string | null;
  readonly onRemove: (row: AgentServerRow) => void;
  readonly onUseEverywhere: (row: AgentServerRow) => void;
}) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const results = useQueries({
    queries: DEFAULT_PROVIDER_ORDER.map((provider) => mcpServersQueryOptions(provider)),
  });
  const loading = results.some((result) => result.isPending);
  // Providers that cannot report their servers, or are turned off, answer with an empty source.
  const reporting = DEFAULT_PROVIDER_ORDER.filter((_, index) => {
    const source = results[index]?.data?.source;
    return source !== undefined && source !== "unsupported" && source !== "disabled";
  });
  const agentNames = reporting.length > 0 ? providerNames(reporting) : "Your agents";
  // Every agent failed to answer, as with a server too old to list them: say so rather than
  // presenting the silence as an empty list.
  const failed = !loading && results.every((result) => result.isError);
  const sources = DEFAULT_PROVIDER_ORDER.flatMap((provider, index) =>
    (results[index]?.data?.servers ?? []).map((server) => ({ provider, server })),
  );
  const rows = agentServerRows(sources, props.connectors).filter(
    (row) => !props.query || row.name.toLowerCase().includes(props.query),
  );

  const refresh = () => {
    setRefreshing(true);
    void reloadAgentMcpServers(queryClient).finally(() => setRefreshing(false));
  };

  return (
    <SettingsSectionShell
      title="In your agents"
      action={
        <IconButton
          variant="ghost"
          size="icon-xs"
          label="Check again"
          disabled={refreshing || loading}
          onClick={refresh}
        >
          <RefreshCwIcon className={refreshing ? "animate-spin" : undefined} />
        </IconButton>
      }
    >
      {loading ? (
        <SettingsEmptyState layout="status">Checking your agents…</SettingsEmptyState>
      ) : failed ? (
        <SettingsEmptyState layout="status" tone="destructive">
          Glade could not read your agents' MCP servers. Restart Glade and check again.
        </SettingsEmptyState>
      ) : rows.length === 0 ? (
        <SettingsEmptyState layout="status">
          {props.query
            ? "No agent server matches your search."
            : `${agentNames} have no MCP servers of their own.`}
        </SettingsEmptyState>
      ) : (
        <SettingsCard>
          {rows.map((row) => {
            const summary = rowSummary(row);
            return (
              <div key={row.name} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
                <ConnectorIcon
                  presetId={row.preset?.id ?? null}
                  name={row.name}
                  url={row.origin ?? ""}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium text-foreground">
                    {row.name}
                  </span>
                  <span
                    className={
                      summary.problem
                        ? "block truncate text-ui-sm text-warning"
                        : "block truncate text-ui-sm text-muted-foreground"
                    }
                  >
                    {summary.text}
                  </span>
                </span>
                <ProviderStack providers={row.sources.map((source) => source.provider)} />
                {row.connector ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={props.removing !== null}
                    onClick={() => props.onRemove(row)}
                  >
                    {props.removing === row.name ? "Removing…" : "Remove from agents"}
                  </Button>
                ) : row.preset ? (
                  <Button size="sm" variant="outline" onClick={() => props.onUseEverywhere(row)}>
                    Use everywhere
                  </Button>
                ) : null}
              </div>
            );
          })}
        </SettingsCard>
      )}
      <p className="px-2 text-ui-xs text-muted-foreground">
        Read from each agent's own settings. Use everywhere connects the service once for every
        agent and then offers to remove the agents' own copies.
      </p>
    </SettingsSectionShell>
  );
}
