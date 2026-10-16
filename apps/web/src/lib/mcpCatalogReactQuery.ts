import { queryOptions } from "@tanstack/react-query";

import type { EnvironmentKey } from "~/environments/environmentKey";
import { ensureEnvironmentNativeApi } from "~/nativeApi";

// Each machine answers with its own catalog: the presets it can connect.
export function mcpCatalogQueryOptions(environment: EnvironmentKey) {
  return queryOptions({
    queryKey: ["mcpCatalog", environment],
    queryFn: () => ensureEnvironmentNativeApi(environment).mcpConnectors.getCatalog(),
    // The server refreshes its catalog at most once a day.
    staleTime: 60 * 60_000,
    retry: false,
  });
}
