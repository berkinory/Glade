import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { useQuery } from "@tanstack/react-query";

import { getCustomBinaryPathForProvider, useAppSettings } from "../appSettings";
import { normalizeProviderStatusForLocalConfig } from "../lib/providerAvailability";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "../environments/environmentKey";
import { environmentServerConfigQueryOptions } from "../lib/serverReactQuery";

const EMPTY_PROVIDER_STATUSES: ServerProviderStatus[] = [];

// Provider statuses of one machine's server, with this app's provider settings applied. Custom binary
// paths name files on this machine, so they only apply to the local server.
export function useProviderStatusesForLocalConfig(
  environmentKey: EnvironmentKey,
): readonly ServerProviderStatus[] {
  const { settings } = useAppSettings();
  const isLocal = environmentKey === LOCAL_ENVIRONMENT;
  const serverConfigQuery = useQuery(environmentServerConfigQueryOptions(environmentKey));
  const disabledProviders = new Set(settings.disabledProviders);

  return (serverConfigQuery.data?.providers ?? EMPTY_PROVIDER_STATUSES)
    .map((status) =>
      normalizeProviderStatusForLocalConfig({
        provider: status.provider,
        status,
        customBinaryPath: isLocal
          ? getCustomBinaryPathForProvider(settings, status.provider)
          : null,
        disabled: disabledProviders.has(status.provider),
      }),
    )
    .flatMap((status) => (status ? [status] : []));
}
