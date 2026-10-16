import type { McpConnector } from "@glade/contracts/transport/ws/mcpConnectorsRpc";
import type { McpConnectorPreset } from "@glade/shared/mcpConnectors/catalog";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ProviderIcon } from "~/components/ProviderIcon";
import { RefreshCwIcon } from "~/lib/icons";
import { mcpServersQueryOptions } from "~/lib/providerDiscoveryReactQuery";
import { DEFAULT_PROVIDER_ORDER } from "~/providerOrdering";
import { Button } from "../../ui/button";
import { IconButton } from "../../ui/icon-button";
import { SettingsCard, SettingsEmptyState, SettingsSectionShell } from "../SettingsPanelPrimitives";
import { providerDisplayName } from "../skillsSettingsModel";
import { ConnectorIcon } from "./ConnectorIcon";
import { type AgentServerRow, agentServerRows, connectorHost } from "./connectors.logic";

function rowSummary(row: AgentServerRow): { text: string; problem: boolean } {
  const trouble = row.sources.find(
    (source) => source.server.status === "needs-sign-in" || source.server.status === "failed",
  );
  if (trouble) {
    const agent = providerDisplayName(trouble.provider);
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

function AgentStack(props: { readonly row: AgentServerRow }) {
  const label = props.row.sources.map((source) => providerDisplayName(source.provider)).join(", ");
  return (
    <span className="inline-flex shrink-0 items-center -space-x-1" title={`Set up in ${label}`}>
      {props.row.sources.map((source) => (
        <span
          key={source.provider}
          className="inline-flex size-5 items-center justify-center rounded-full border border-background bg-background"
        >
          <ProviderIcon provider={source.provider} className="size-3.5" />
        </span>
      ))}
    </span>
  );
}

// Read-only: servers come from each agent's own settings, which stay the place to change them.
export function AgentMcpServersSection(props: {
  readonly connectors: ReadonlyArray<McpConnector>;
  readonly query: string;
  readonly onUseInGlade: (preset: McpConnectorPreset) => void;
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
  const agentNames = reporting.map(providerDisplayName).join(" and ") || "Your agents";
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
    void Promise.all(
      DEFAULT_PROVIDER_ORDER.map((provider) =>
        queryClient.fetchQuery({ ...mcpServersQueryOptions(provider, true), staleTime: 0 }),
      ),
    ).finally(() => setRefreshing(false));
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
                <AgentStack row={row} />
                {row.preset && !row.connector ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => row.preset && props.onUseInGlade(row.preset)}
                  >
                    Use in Glade
                  </Button>
                ) : null}
              </div>
            );
          })}
        </SettingsCard>
      )}
      <p className="px-2 text-ui-xs text-muted-foreground">
        Read from each agent's own settings; change them there. Connecting a service in Glade
        instead makes it available to every agent with one sign-in.
      </p>
    </SettingsSectionShell>
  );
}
