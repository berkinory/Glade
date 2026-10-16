import type { NativeApi } from "@glade/contracts/ipc/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAppSettings } from "../appSettings";
import { type EnvironmentKey } from "../environments/environmentKey";
import {
  PROVIDER_AUTH_REFRESH_MIN_INTERVAL_MS,
  useProviderAuthRefreshOnFocus,
} from "../hooks/useProviderAuthRefreshOnFocus";
import { useProviderStatusRefresh } from "../hooks/useProviderStatusRefresh";
import {
  environmentServerConfigQueryOptions,
  serverConfigQueryOptions,
  serverSettingsQueryOptions,
} from "../lib/serverReactQuery";
import {
  PROVIDER_UPDATE_INITIAL_REFRESH_DELAY_MS,
  PROVIDER_UPDATE_REFRESH_INTERVAL_MS,
} from "../providerUpdates";
import { prefetchModelsForNewThread } from "../lib/providerModelPrefetch";
import { addWsTransportStateListener } from "../wsTransportEvents";

export function ProviderStatusRefreshCoordinator() {
  const { settings } = useAppSettings();
  const queryClient = useQueryClient();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const [transportOpen, setTransportOpen] = useState(false);
  const providerUpdateChecksEnabled =
    serverSettingsQuery.data !== undefined && settings.enableProviderUpdateChecks;

  // The update coordinator includes the same focus/visibility refresh. Keep the auth-only loop for
  // the setting-off case so enabling update checks never launches duplicate provider probes on focus.
  useProviderAuthRefreshOnFocus({ enabled: !providerUpdateChecksEnabled });
  useEffect(
    () =>
      addWsTransportStateListener((state) => setTransportOpen(state === "open"), {
        replayCurrent: true,
      }),
    [],
  );

  useEffect(() => {
    if (!transportOpen || !serverSettingsQuery.data || !serverConfigQuery.data) return;
    prefetchModelsForNewThread(queryClient, {
      settings,
      serverSettings: serverSettingsQuery.data,
      providerStatuses: serverConfigQuery.data.providers,
      statusesReconciled: true,
      providerOrder: settings.providerOrder,
    });
  }, [queryClient, settings, serverSettingsQuery.data, serverConfigQuery.data, transportOpen]);

  useProviderStatusRefresh({
    enabled: providerUpdateChecksEnabled && transportOpen,
    initialDelayMs: PROVIDER_UPDATE_INITIAL_REFRESH_DELAY_MS,
    intervalMs: PROVIDER_UPDATE_REFRESH_INTERVAL_MS,
    minIntervalMs: PROVIDER_AUTH_REFRESH_MIN_INTERVAL_MS,
    refreshOnFocus: true,
  });

  return null;
}

// A host's server checks its own provider CLIs: once per connection, so its chats know which
// providers it has, and hourly for updates.
export function HostProviderStatusRefresh(props: {
  readonly environmentKey: EnvironmentKey;
  readonly api: NativeApi;
}) {
  const { settings } = useAppSettings();
  const queryClient = useQueryClient();
  const { api, environmentKey } = props;
  const updateChecks = settings.enableProviderUpdateChecks;

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      void api.server
        .refreshProviders()
        .then(() => {
          if (cancelled) return;
          void queryClient.invalidateQueries({
            queryKey: environmentServerConfigQueryOptions(environmentKey).queryKey,
          });
        })
        .catch(() => undefined);
    refresh();
    const interval = updateChecks
      ? window.setInterval(refresh, PROVIDER_UPDATE_REFRESH_INTERVAL_MS)
      : null;
    return () => {
      cancelled = true;
      if (interval !== null) window.clearInterval(interval);
    };
  }, [api, environmentKey, queryClient, updateChecks]);

  return null;
}
