import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { mcpServersQueryOptions } from "~/lib/providerDiscoveryReactQuery";
import { providerNames } from "~/lib/providerNames";
import { ensureNativeApi } from "~/nativeApi";
import { DEFAULT_PROVIDER_ORDER } from "~/providerOrdering";
import { toastManager } from "../../ui/toast";
import type { AgentServerRow } from "./connectors.logic";

export function reloadAgentMcpServers(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(
    DEFAULT_PROVIDER_ORDER.map((provider) =>
      queryClient.fetchQuery({ ...mcpServersQueryOptions(provider, true), staleTime: 0 }),
    ),
  );
}

// Removes a server from the agents' own settings once Glade connects the same service, after the
// user confirms.
export function useAgentServerRemoval() {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);

  const remove = async (row: AgentServerRow) => {
    const api = ensureNativeApi();
    const agents = providerNames(row.sources.map((source) => source.provider));
    const service = row.connector?.name ?? row.preset?.name ?? row.name;
    const confirmed = await api.dialogs.confirm(
      `Remove ${row.name} from ${agents}?\n${service} is connected in Glade, which gives every agent its tools. Outside Glade, ${agents} will no longer load it.`,
    );
    if (!confirmed) return;
    setRemoving(row.name);
    try {
      const results = await Promise.allSettled(
        row.sources.map((source) =>
          api.provider.removeMcpServer({ provider: source.provider, name: source.server.name }),
        ),
      );
      const failed = row.sources.filter((_, index) => results[index]?.status === "rejected");
      const reasons = results.flatMap((result) =>
        result.status === "rejected" && result.reason instanceof Error
          ? [result.reason.message]
          : [],
      );
      if (failed.length > 0) {
        toastManager.add({
          type: "error",
          title: "Could not remove server",
          description: `Could not remove ${row.name} from ${providerNames(failed.map((source) => source.provider))}. ${reasons.join("\n") || "Try again."}`,
        });
      }
      await reloadAgentMcpServers(queryClient);
    } finally {
      setRemoving(null);
    }
  };

  return { removing, remove };
}
