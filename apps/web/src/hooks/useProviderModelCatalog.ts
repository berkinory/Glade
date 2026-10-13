import type {
  ProviderAgentDescriptor,
  ProviderModelDescriptor,
} from "@glade/contracts/provider/providerDiscovery";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { getAppModelOptions, useAppSettings } from "../appSettings";
import { resolveRuntimeModelDescriptor } from "../components/chat/runtimeModelCapabilities";
import {
  prioritizeProviderModelDiscovery,
  providerAgentsQueryOptions,
  providerDiscoveryQueryKeys,
  providerModelsQueryOptions,
} from "../lib/providerDiscoveryReactQuery";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { mergeDynamicModelOptions, type ProviderModelOption } from "../providerModelOptions";
import { DEFAULT_PROVIDER_ORDER } from "../providerOrdering";

export interface ProviderModelCatalog {
  modelOptionsByProvider: Record<
    ProviderKind,
    ReadonlyArray<ProviderModelOption & { isSelectedHint?: boolean }>
  >;
  loadingModelProviders: Partial<Record<ProviderKind, boolean>>;
  runtimeModelsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelDescriptor>>;
  selectedRuntimeModel: ProviderModelDescriptor | undefined;
  selectedRuntimeAgents: ReadonlyArray<ProviderAgentDescriptor>;
  selectedProviderModelsLoading: boolean;
  selectedProviderRuntimeModelDiscoveryPending: boolean;
  discoveryErrorsByProvider: Partial<Record<ProviderKind, string | undefined>>;
}

const EMPTY_PROVIDER_AGENTS: ReadonlyArray<ProviderAgentDescriptor> = [];

function mapProviders<Value>(
  valueFor: (provider: ProviderKind) => Value,
): Record<ProviderKind, Value> {
  return Object.fromEntries(
    DEFAULT_PROVIDER_ORDER.map((provider) => [provider, valueFor(provider)]),
  ) as Record<ProviderKind, Value>;
}

// A module-level combine keeps its identity across renders, so TanStack Query structurally shares the
// per-provider record and consumers only see a new object when a query result changes.
function indexQueriesByProvider<Data>(
  results: ReadonlyArray<UseQueryResult<Data, Error>>,
): Record<
  ProviderKind,
  Pick<UseQueryResult<Data, Error>, "data" | "error" | "isFetching" | "isLoading" | "isPending">
> {
  return mapProviders((provider) => {
    const result = results[DEFAULT_PROVIDER_ORDER.indexOf(provider)]!;
    return {
      data: result.data,
      error: result.error,
      isFetching: result.isFetching,
      isLoading: result.isLoading,
      isPending: result.isPending,
    };
  });
}

export function useProviderModelCatalog(input: {
  selectedProvider: ProviderKind;
  discoveryEnabled: boolean;
  cwd?: string | null;
  modelHintByProvider?: Partial<Record<ProviderKind, string | null>>;
  prefetchProviders?: ReadonlyArray<ProviderKind>;
}): ProviderModelCatalog {
  const { selectedProvider, discoveryEnabled, modelHintByProvider, cwd } = input;
  const { settings, serverSettings } = useAppSettings();
  const queryClient = useQueryClient();
  useQuery(serverConfigQueryOptions());
  const hiddenProviderSet = useMemo(
    () => new Set(settings.hiddenProviders),
    [settings.hiddenProviders],
  );
  const prefetchProviderSet = useMemo(
    () => (input.prefetchProviders === undefined ? null : new Set(input.prefetchProviders)),
    [input.prefetchProviders],
  );
  const shouldDiscoverProvider = (provider: ProviderKind, prefetchRequested = discoveryEnabled) => {
    if (serverSettings?.providers[provider]?.enabled === false) return false;
    if (provider === selectedProvider) return true;
    if (!prefetchRequested) return false;
    return prefetchProviderSet?.has(provider) ?? !hiddenProviderSet.has(provider);
  };

  const binaryPathFor = (provider: ProviderKind) => settings.providerBinaryPaths[provider] || null;
  const modelsQueryOptionsFor = (provider: ProviderKind) =>
    providerModelsQueryOptions(
      {
        provider,
        binaryPath: binaryPathFor(provider),
        cwd: cwd ?? null,
        enabled: shouldDiscoverProvider(provider),
      },
      queryClient,
    );
  const modelQueries = useQueries({
    queries: DEFAULT_PROVIDER_ORDER.map(modelsQueryOptionsFor),
    combine: indexQueriesByProvider,
  });

  const selectedModelsQueryOptions = modelsQueryOptionsFor(selectedProvider);
  const [, , modelProvider, modelBinaryPath, modelApiEndpoint, modelCwd, accountIdentity] =
    selectedModelsQueryOptions.queryKey;
  const selectedProviderModelsQueryKey = useMemo(
    () =>
      providerDiscoveryQueryKeys.models(
        modelProvider,
        modelBinaryPath,
        modelApiEndpoint,
        modelCwd,
        accountIdentity,
      ),
    [modelProvider, modelBinaryPath, modelApiEndpoint, modelCwd, accountIdentity],
  );
  const selectedProviderModelsEnabled = selectedModelsQueryOptions.enabled;
  useEffect(() => {
    if (!selectedProviderModelsEnabled) return;
    return prioritizeProviderModelDiscovery(selectedProviderModelsQueryKey);
  }, [selectedProviderModelsQueryKey, selectedProviderModelsEnabled]);

  const agentQueries = useQueries({
    queries: DEFAULT_PROVIDER_ORDER.map((provider) =>
      providerAgentsQueryOptions({
        provider,
        binaryPath: binaryPathFor(provider),
        cwd: cwd ?? null,
        enabled: shouldDiscoverProvider(provider) && !modelQueries[provider].isPending,
      }),
    ),
    combine: indexQueriesByProvider,
  });

  const modelOptionsByProvider = useMemo(
    () =>
      mapProviders((provider) => {
        const staticOptions = getAppModelOptions(provider, modelHintByProvider?.[provider]);
        const discovery = modelQueries[provider].data;
        const dynamicModels = discovery?.models;
        // The Codex app server reports its full catalog, so an empty list from it is authoritative.
        const isAuthoritativeCatalog =
          discovery?.source === "codex-app-server" && discovery.error === undefined;
        return dynamicModels && (dynamicModels.length > 0 || isAuthoritativeCatalog)
          ? mergeDynamicModelOptions({ staticOptions, dynamicModels })
          : staticOptions;
      }),
    [modelHintByProvider, modelQueries],
  );

  const runtimeModelsByProvider = useMemo<ProviderModelCatalog["runtimeModelsByProvider"]>(
    () => mapProviders((provider) => modelQueries[provider].data?.models ?? []),
    [modelQueries],
  );
  const selectedRuntimeModel = useMemo(
    () =>
      resolveRuntimeModelDescriptor({
        provider: selectedProvider,
        model: modelHintByProvider?.[selectedProvider] ?? null,
        runtimeModels: runtimeModelsByProvider[selectedProvider],
      }),
    [selectedProvider, modelHintByProvider, runtimeModelsByProvider],
  );
  const selectedDynamicAgents =
    agentQueries[selectedProvider].data?.agents ?? EMPTY_PROVIDER_AGENTS;
  const selectedRuntimeAgents = useMemo<ReadonlyArray<ProviderAgentDescriptor>>(
    () =>
      selectedDynamicAgents.map((agent) =>
        agent.description
          ? { name: agent.name, displayName: agent.displayName, description: agent.description }
          : { name: agent.name, displayName: agent.displayName },
      ),
    [selectedDynamicAgents],
  );
  const discoveryErrorsByProvider = useMemo<ProviderModelCatalog["discoveryErrorsByProvider"]>(
    () =>
      mapProviders(
        (provider) => modelQueries[provider].data?.error ?? modelQueries[provider].error?.message,
      ),
    [modelQueries],
  );
  const selectedQuery = modelQueries[selectedProvider];
  const selectedProviderRuntimeModelDiscoveryPending =
    selectedQuery.data === undefined && selectedQuery.isFetching;
  const selectedProviderModelsLoading =
    selectedQuery.isLoading || (selectedQuery.isFetching && selectedQuery.data === undefined);

  return {
    modelOptionsByProvider,
    loadingModelProviders: mapProviders(
      (provider) => modelQueries[provider].isFetching && modelQueries[provider].data === undefined,
    ),
    runtimeModelsByProvider,
    selectedRuntimeModel,
    selectedRuntimeAgents,
    selectedProviderModelsLoading,
    selectedProviderRuntimeModelDiscoveryPending,
    discoveryErrorsByProvider,
  };
}
