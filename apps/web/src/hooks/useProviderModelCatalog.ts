// Shared provider model catalog for composer-like surfaces.
import type {
  ProviderAgentDescriptor,
  ProviderKind,
  ProviderModelDescriptor,
} from "@glade/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { getAppModelOptions, useAppSettings } from "../appSettings";
import { resolveRuntimeModelDescriptor } from "../components/chat/runtimeModelCapabilities";
import { collapseCursorModelVariants } from "../cursorModelVariants";
import {
  isInitialModelDiscoveryPending,
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

function modelDiscoveryError(
  resultError: string | undefined,
  queryError: unknown,
): string | undefined {
  if (resultError) return resultError;
  if (queryError instanceof Error) return queryError.message;
  return typeof queryError === "string" ? queryError : undefined;
}

export function useProviderModelCatalog(input: {
  selectedProvider: ProviderKind;
  discoveryEnabled: boolean;
  cwd?: string | null;
  modelHintByProvider?: Partial<Record<ProviderKind, string | null>>;
  prefetchProviders?: ReadonlyArray<ProviderKind>;
  agentDiscoveryPolicy?: "selected" | "eager-core";
}): ProviderModelCatalog {
  const { selectedProvider, discoveryEnabled, modelHintByProvider } = input;
  const discoveryCwd = input.cwd ?? null;
  const agentDiscoveryPolicy = input.agentDiscoveryPolicy ?? "selected";
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
    // Discovery remains available while the settings query is still loading.
    if (serverSettings?.providers[provider]?.enabled === false) return false;
    if (provider === selectedProvider) return true;
    if (!prefetchRequested) return false;
    return prefetchProviderSet?.has(provider) ?? !hiddenProviderSet.has(provider);
  };

  const cursorModelDiscoveryEnabled = shouldDiscoverProvider("cursor");
  const openCodeModelDiscoveryEnabled = shouldDiscoverProvider("opencode");
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
    cursor: providerModelsQueryOptions({
      provider: "cursor",
      binaryPath: settings.cursorBinaryPath || null,
      apiEndpoint: settings.cursorApiEndpoint || null,
      enabled: cursorModelDiscoveryEnabled,
    }),
    grok: providerModelsQueryOptions({
      provider: "grok",
      binaryPath: settings.grokBinaryPath || null,
      enabled: shouldDiscoverProvider("grok"),
    }),
    opencode: providerModelsQueryOptions({
      provider: "opencode",
      binaryPath: settings.openCodeBinaryPath || null,
      cwd: discoveryCwd,
      enabled: openCodeModelDiscoveryEnabled,
    }),
  } as const;

  const claudeQuery = useQuery(modelQueryOptionsByProvider.claudeAgent);
  const codexQuery = useQuery(modelQueryOptionsByProvider.codex);
  const cursorQuery = useQuery(modelQueryOptionsByProvider.cursor);
  const grokQuery = useQuery(modelQueryOptionsByProvider.grok);
  const openCodeQuery = useQuery(modelQueryOptionsByProvider.opencode);
  const queries = {
    claudeAgent: claudeQuery,
    codex: codexQuery,
    cursor: cursorQuery,
    grok: grokQuery,
    opencode: openCodeQuery,
  } as const;

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
      enabled: shouldDiscoverProvider("claudeAgent", agentDiscoveryPolicy === "eager-core"),
    }),
  );
  const codexAgentsQuery = useQuery(
    providerAgentsQueryOptions({
      provider: "codex",
      enabled: shouldDiscoverProvider("codex", agentDiscoveryPolicy === "eager-core"),
    }),
  );
  const openCodeAgentsQuery = useQuery(
    providerAgentsQueryOptions({
      provider: "opencode",
      binaryPath: settings.openCodeBinaryPath || null,
      cwd: discoveryCwd,
      enabled: openCodeModelDiscoveryEnabled,
    }),
  );

  const cursorRuntimeModels = useMemo(
    () => collapseCursorModelVariants(cursorQuery.data?.models ?? []),
    [cursorQuery.data?.models],
  );
  const cursorResolved =
    (cursorQuery.data?.source === "cursor.cli" || cursorQuery.data?.source === "cursor.acp") &&
    cursorQuery.data.models.length > 0;
  const openCodeResolved =
    (openCodeQuery.data?.source === "opencode-cli" || openCodeQuery.data?.source === "opencode") &&
    openCodeQuery.data.models.length > 0;
  const loadingModelProviders = useMemo<Partial<Record<ProviderKind, boolean>>>(
    () => ({
      cursor:
        cursorModelDiscoveryEnabled &&
        !cursorResolved &&
        isInitialModelDiscoveryPending(cursorQuery),
      opencode:
        openCodeModelDiscoveryEnabled &&
        !openCodeResolved &&
        isInitialModelDiscoveryPending(openCodeQuery),
    }),
    [
      cursorModelDiscoveryEnabled,
      cursorResolved,
      cursorQuery,
      openCodeModelDiscoveryEnabled,
      openCodeResolved,
      openCodeQuery,
    ],
  );

  const modelOptionsByProvider = useMemo(() => {
    const staticOptions: Record<ProviderKind, ReturnType<typeof getAppModelOptions>> = {
      codex: getAppModelOptions("codex", modelHintByProvider?.codex),
      claudeAgent: getAppModelOptions("claudeAgent", modelHintByProvider?.claudeAgent),
      cursor: getAppModelOptions("cursor", modelHintByProvider?.cursor),
      grok: getAppModelOptions("grok", modelHintByProvider?.grok),
      opencode: getAppModelOptions("opencode", modelHintByProvider?.opencode),
    };
    const result: ProviderModelCatalog["modelOptionsByProvider"] = { ...staticOptions };
    const dynamicSources = {
      claudeAgent: claudeQuery.data,
      codex: codexQuery.data,
      cursor:
        cursorQuery.data === undefined
          ? undefined
          : { ...cursorQuery.data, models: cursorRuntimeModels },
      grok: grokQuery.data,
      opencode: openCodeQuery.data,
    };
    for (const provider of ["claudeAgent", "codex", "cursor", "grok", "opencode"] as const) {
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
  }, [
    modelHintByProvider,
    claudeQuery.data,
    codexQuery.data,
    cursorQuery.data,
    cursorRuntimeModels,
    grokQuery.data,
    openCodeQuery.data,
  ]);

  const runtimeModelsByProvider = useMemo<ProviderModelCatalog["runtimeModelsByProvider"]>(
    () => ({
      claudeAgent: claudeQuery.data?.models ?? [],
      codex: codexQuery.data?.models ?? [],
      cursor: cursorRuntimeModels,
      grok: grokQuery.data?.models ?? [],
      opencode: openCodeQuery.data?.models ?? [],
    }),
    [
      claudeQuery.data?.models,
      codexQuery.data?.models,
      cursorRuntimeModels,
      grokQuery.data?.models,
      openCodeQuery.data?.models,
    ],
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
      : selectedProvider === "opencode"
        ? (openCodeAgentsQuery.data?.agents ?? EMPTY_PROVIDER_AGENTS)
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
    () => ({
      claudeAgent: claudeQuery.data?.error,
      codex: codexQuery.data?.error,
      cursor: modelDiscoveryError(cursorQuery.data?.error, cursorQuery.error),
      grok: modelDiscoveryError(grokQuery.data?.error, grokQuery.error),
      opencode: modelDiscoveryError(openCodeQuery.data?.error, openCodeQuery.error),
    }),
    [
      claudeQuery.data?.error,
      codexQuery.data?.error,
      cursorQuery.data?.error,
      cursorQuery.error,
      grokQuery.data?.error,
      grokQuery.error,
      openCodeQuery.data?.error,
      openCodeQuery.error,
    ],
  );
  const selectedProviderRuntimeModelDiscoveryPending =
    loadingModelProviders[selectedProvider] ?? false;
  const selectedQuery = queries[selectedProvider];
  const selectedProviderModelsLoading =
    selectedProviderRuntimeModelDiscoveryPending ||
    (loadingModelProviders[selectedProvider] === undefined &&
      (selectedQuery.isLoading || (selectedQuery.isFetching && selectedQuery.data === undefined)));

  return {
    modelOptionsByProvider,
    loadingModelProviders,
    runtimeModelsByProvider,
    selectedRuntimeModel,
    selectedRuntimeAgents,
    selectedProviderModelsLoading,
    selectedProviderRuntimeModelDiscoveryPending,
    discoveryErrorsByProvider,
  };
}
