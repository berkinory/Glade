import type {
  ProviderAgentDescriptor,
  ProviderKind,
  ProviderModelDescriptor,
} from "@glade/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { getAppModelOptions, useAppSettings } from "../appSettings";
import { resolveRuntimeModelDescriptor } from "../components/chat/runtimeModelCapabilities";
import {
  prioritizeProviderModelDiscovery,
  providerAgentsQueryOptions,
  providerDiscoveryQueryKeys,
  providerModelsQueryOptions,
} from "../lib/providerDiscoveryReactQuery";
import { mergeDynamicModelOptions, type ProviderModelOption } from "../providerModelOptions";

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

export function useProviderModelCatalog(input: {
  selectedProvider: ProviderKind;
  discoveryEnabled: boolean;
  cwd?: string | null;
  modelHintByProvider?: Partial<Record<ProviderKind, string | null>>;
  prefetchProviders?: ReadonlyArray<ProviderKind>;
  agentDiscoveryPolicy?: "selected" | "eager-core";
}): ProviderModelCatalog {
  const { selectedProvider, discoveryEnabled, modelHintByProvider } = input;
  const { settings, serverSettings } = useAppSettings();
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

  const modelQueryOptionsByProvider = {
    claudeAgent: providerModelsQueryOptions({
      provider: "claudeAgent",
      binaryPath: settings.claudeBinaryPath || null,
      enabled: shouldDiscoverProvider("claudeAgent"),
    }),
    codex: providerModelsQueryOptions({
      provider: "codex",
      enabled: shouldDiscoverProvider("codex"),
    }),
  } as const;
  const claudeQuery = useQuery(modelQueryOptionsByProvider.claudeAgent);
  const codexQuery = useQuery(modelQueryOptionsByProvider.codex);
  const queries = { claudeAgent: claudeQuery, codex: codexQuery } as const;

  const [, , modelProvider, modelBinaryPath, modelApiEndpoint, modelCwd] =
    modelQueryOptionsByProvider[selectedProvider].queryKey;
  const selectedProviderModelsQueryKey = useMemo(
    () =>
      providerDiscoveryQueryKeys.models(modelProvider, modelBinaryPath, modelApiEndpoint, modelCwd),
    [modelProvider, modelBinaryPath, modelApiEndpoint, modelCwd],
  );
  const selectedProviderModelsEnabled = modelQueryOptionsByProvider[selectedProvider].enabled;
  useEffect(() => {
    if (!selectedProviderModelsEnabled) return;
    return prioritizeProviderModelDiscovery(selectedProviderModelsQueryKey);
  }, [selectedProviderModelsQueryKey, selectedProviderModelsEnabled]);

  const claudeAgentsQuery = useQuery(
    providerAgentsQueryOptions({
      provider: "claudeAgent",
      enabled: shouldDiscoverProvider("claudeAgent", input.agentDiscoveryPolicy === "eager-core"),
    }),
  );
  const codexAgentsQuery = useQuery(
    providerAgentsQueryOptions({
      provider: "codex",
      enabled: shouldDiscoverProvider("codex", input.agentDiscoveryPolicy === "eager-core"),
    }),
  );

  const modelOptionsByProvider = useMemo(() => {
    const staticOptions = {
      codex: getAppModelOptions("codex", modelHintByProvider?.codex),
      claudeAgent: getAppModelOptions("claudeAgent", modelHintByProvider?.claudeAgent),
    };
    const result: ProviderModelCatalog["modelOptionsByProvider"] = { ...staticOptions };
    const dynamicSources = { claudeAgent: claudeQuery.data, codex: codexQuery.data };
    for (const provider of ["claudeAgent", "codex"] as const) {
      const discovery = dynamicSources[provider];
      const dynamicModels = discovery?.models;
      const hasCodexCatalog =
        provider === "codex" &&
        discovery?.source === "codex-app-server" &&
        discovery.error === undefined;
      if (dynamicModels && (dynamicModels.length > 0 || hasCodexCatalog)) {
        result[provider] = mergeDynamicModelOptions({
          provider,
          staticOptions: staticOptions[provider],
          dynamicModels,
        });
      }
    }
    return result;
  }, [modelHintByProvider, claudeQuery.data, codexQuery.data]);

  const runtimeModelsByProvider = useMemo<ProviderModelCatalog["runtimeModelsByProvider"]>(
    () => ({ claudeAgent: claudeQuery.data?.models ?? [], codex: codexQuery.data?.models ?? [] }),
    [claudeQuery.data?.models, codexQuery.data?.models],
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
    selectedProvider === "claudeAgent"
      ? (claudeAgentsQuery.data?.agents ?? EMPTY_PROVIDER_AGENTS)
      : (codexAgentsQuery.data?.agents ?? EMPTY_PROVIDER_AGENTS);
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
    () => ({ claudeAgent: claudeQuery.data?.error, codex: codexQuery.data?.error }),
    [claudeQuery.data?.error, codexQuery.data?.error],
  );
  const selectedProviderRuntimeModelDiscoveryPending = false;
  const selectedQuery = queries[selectedProvider];
  const selectedProviderModelsLoading =
    selectedQuery.isLoading || (selectedQuery.isFetching && selectedQuery.data === undefined);

  return {
    modelOptionsByProvider,
    loadingModelProviders: {},
    runtimeModelsByProvider,
    selectedRuntimeModel,
    selectedRuntimeAgents,
    selectedProviderModelsLoading,
    selectedProviderRuntimeModelDiscoveryPending,
    discoveryErrorsByProvider,
  };
}
