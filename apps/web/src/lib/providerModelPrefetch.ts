import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import type { ServerSettings } from "@glade/contracts/settings/settings";
import type { QueryClient } from "@tanstack/react-query";

import type { AppSettings } from "../appSettings";
import type { DraftThreadEnvMode } from "../composerDraftDomain";
import { findProviderStatus, resolveAvailableProviderPreference } from "./providerAvailability";
import { resolveProviderDiscoveryCwd } from "./providerDiscovery";
import {
  prioritizeProviderModelDiscovery,
  providerAgentsQueryOptions,
  providerComposerCapabilitiesQueryOptions,
  providerDiscoveryQueryKeys,
  providerModelsQueryOptions,
} from "./providerDiscoveryReactQuery";

export type ProviderModelPrefetchSettings = Pick<
  AppSettings,
  "defaultProvider" | "claudeBinaryPath" | "codexBinaryPath"
>;

const NEW_THREAD_MODEL_PREFETCH_PROVIDERS: ReadonlyArray<ProviderKind> = ["codex", "claudeAgent"];

const NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS = 30 * 60_000;

const NEW_THREAD_MODEL_PREFETCH_GC_TIME_MS = 24 * 60 * 60_000;

const EMPTY_PROVIDER_STATUSES: readonly ServerProviderStatus[] = [];

function resolveNewThreadModelPrefetchProvider(input: {
  providerOverride?: ProviderKind | null | undefined;
  draftActiveProvider?: ProviderKind | null | undefined;
  stickyActiveProvider?: ProviderKind | null | undefined;
  projectDefaultProvider?: ProviderKind | null | undefined;
  defaultProvider: ProviderKind;
}): ProviderKind {
  return (
    input.providerOverride ??
    input.draftActiveProvider ??
    input.stickyActiveProvider ??
    input.projectDefaultProvider ??
    input.defaultProvider
  );
}

function resolveNewThreadModelPrefetchCwd(input: {
  worktreePath?: string | null | undefined;

  hasExplicitWorktreePath?: boolean;

  fresh?: boolean;

  envMode?: DraftThreadEnvMode | null;
  draftWorktreePath?: string | null | undefined;
  projectCwd?: string | null | undefined;
  serverCwd?: string | null | undefined;
}): string | null {
  let worktreePath: string | null;
  if (input.hasExplicitWorktreePath === true) {
    worktreePath = input.worktreePath ?? null;
  } else if (input.fresh === true) {
    worktreePath = null;
  } else if (input.envMode === "local") {
    worktreePath = null;
  } else {
    worktreePath = input.draftWorktreePath ?? null;
  }
  return resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: worktreePath,
    activeProjectCwd: input.projectCwd ?? null,
    serverCwd: input.serverCwd ?? null,
  });
}

function providerModelsPrefetchQueryOptions(
  queryClient: QueryClient,
  input: {
    provider: ProviderKind;
    settings: ProviderModelPrefetchSettings;
    cwd?: string | null;
    priority?: "background" | "prefetch" | undefined;
  },
) {
  const { priority, provider, settings } = input;

  switch (provider) {
    case "claudeAgent":
      return providerModelsQueryOptions(
        {
          provider: "claudeAgent",
          binaryPath: settings.claudeBinaryPath || null,
          priority,
          cwd: input.cwd ?? null,
        },
        queryClient,
      );
    case "codex":
      return providerModelsQueryOptions(
        {
          provider: "codex",
          binaryPath: settings.codexBinaryPath || null,
          cwd: input.cwd ?? null,
          priority,
        },
        queryClient,
      );
  }
}

function providerAgentsPrefetchQueryOptions(input: {
  provider: ProviderKind;
  settings: ProviderModelPrefetchSettings;
  cwd?: string | null;
}) {
  const { provider } = input;

  switch (provider) {
    case "claudeAgent":
      return providerAgentsQueryOptions({ provider: "claudeAgent" });
    case "codex":
      return providerAgentsQueryOptions({ provider: "codex" });
    default:
      return null;
  }
}

function prefetchProviderModelsForNewThread(
  queryClient: QueryClient,
  input: {
    settings: ProviderModelPrefetchSettings;
    cwd?: string | null;
    providers?: ReadonlyArray<ProviderKind>;
    foregroundProvider?: ProviderKind;
  },
): void {
  const cwd = input.cwd ?? null;
  const providers = input.providers ?? NEW_THREAD_MODEL_PREFETCH_PROVIDERS;

  for (const provider of providers) {
    const modelsOptions = providerModelsPrefetchQueryOptions(queryClient, {
      provider,
      settings: input.settings,
      cwd,
      priority: provider === (input.foregroundProvider ?? providers[0]) ? "prefetch" : "background",
    });
    if (cwd !== null) {
      void queryClient.prefetchQuery({
        ...providerModelsPrefetchQueryOptions(queryClient, { provider, settings: input.settings }),
        retry: 0,
      });
    }
    void queryClient.prefetchQuery({
      ...modelsOptions,
      retry: 0,
      staleTime: NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS,
      gcTime: NEW_THREAD_MODEL_PREFETCH_GC_TIME_MS,
    });

    const agentsOptions = providerAgentsPrefetchQueryOptions({
      provider,
      settings: input.settings,
      cwd,
    });
    if (agentsOptions) {
      void queryClient.prefetchQuery({
        ...agentsOptions,
        retry: 0,
        staleTime: NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS,
        gcTime: NEW_THREAD_MODEL_PREFETCH_GC_TIME_MS,
      });
    }

    void queryClient.prefetchQuery({
      ...providerComposerCapabilitiesQueryOptions(provider),
      retry: 0,
      gcTime: NEW_THREAD_MODEL_PREFETCH_GC_TIME_MS,
    });
  }
}

export function prefetchModelsForNewThread(
  queryClient: QueryClient,
  input: {
    settings: ProviderModelPrefetchSettings;
    serverSettings?: ServerSettings | null;
    hiddenProviders?: ReadonlyArray<ProviderKind>;

    providerStatuses?: readonly ServerProviderStatus[] | null;

    statusesReconciled?: boolean;
    providerOrder?: readonly ProviderKind[];
    providerOverride?: ProviderKind | null;
    draftActiveProvider?: ProviderKind | null;
    stickyActiveProvider?: ProviderKind | null;
    projectDefaultProvider?: ProviderKind | null;
    projectCwd?: string | null;
    draftWorktreePath?: string | null;
    serverCwd?: string | null;
    worktreePath?: string | null;
    hasExplicitWorktreePath?: boolean;
    fresh?: boolean;
    envMode?: DraftThreadEnvMode | null;
  },
): void {
  const resolvedProvider = resolveNewThreadModelPrefetchProvider({
    providerOverride: input.providerOverride,
    draftActiveProvider: input.draftActiveProvider,
    stickyActiveProvider: input.stickyActiveProvider,
    projectDefaultProvider: input.projectDefaultProvider,
    defaultProvider: input.settings.defaultProvider,
  });

  const selectedProvider =
    input.statusesReconciled === true
      ? resolveAvailableProviderPreference({
          preferredProvider: resolvedProvider,
          statuses: input.providerStatuses ?? EMPTY_PROVIDER_STATUSES,
          providerOrder: input.providerOrder ?? [],
          hiddenProviders: input.hiddenProviders ?? [],
        })
      : resolvedProvider;
  const cwd = resolveNewThreadModelPrefetchCwd({
    worktreePath: input.worktreePath ?? null,
    hasExplicitWorktreePath: input.hasExplicitWorktreePath === true,
    fresh: input.fresh === true,
    envMode: input.envMode ?? null,
    draftWorktreePath: input.draftWorktreePath,
    projectCwd: input.projectCwd,
    serverCwd: input.serverCwd,
  });
  const hiddenProviderSet = new Set(input.hiddenProviders ?? []);
  const statusesReconciled = input.statusesReconciled === true;
  const providerStatuses = input.providerStatuses ?? EMPTY_PROVIDER_STATUSES;
  const isProviderWarmable = (provider: ProviderKind): boolean => {
    if (input.serverSettings?.providers[provider]?.enabled === false) {
      return false;
    }

    if (provider === selectedProvider) {
      return true;
    }
    if (hiddenProviderSet.has(provider)) {
      return false;
    }

    if (statusesReconciled) {
      const status = findProviderStatus(providerStatuses, provider);
      if (status !== null && status.available === false) {
        return false;
      }
    }
    return true;
  };
  const providers = NEW_THREAD_MODEL_PREFETCH_PROVIDERS.filter(isProviderWarmable);
  const orderedProviders = !isProviderWarmable(selectedProvider)
    ? providers
    : [selectedProvider, ...providers.filter((provider) => provider !== selectedProvider)];
  const desiredModelQueryKeys = orderedProviders.map(
    (provider) =>
      providerModelsPrefetchQueryOptions(queryClient, {
        provider,
        settings: input.settings,
        cwd,
      }).queryKey,
  );
  const selectedModelQueryKey = desiredModelQueryKeys.find(
    (queryKey) => queryKey[2] === selectedProvider,
  );
  if (selectedModelQueryKey) {
    prioritizeProviderModelDiscovery(selectedModelQueryKey, "prefetch");
  }

  // Include both fetching and offline-paused queries so stale hover work cannot revive on reconnect
  // and consume native admission.
  void queryClient.cancelQueries({
    queryKey: providerDiscoveryQueryKeys.modelsAll,
    type: "inactive",
    predicate: (query) =>
      query.queryKey[5] !== null &&
      !desiredModelQueryKeys.some(
        (queryKey) =>
          query.queryKey.length === queryKey.length &&
          query.queryKey.every((value, index) => Object.is(value, queryKey[index])),
      ),
  });

  prefetchProviderModelsForNewThread(queryClient, {
    settings: input.settings,
    cwd,
    providers: orderedProviders,
    foregroundProvider: selectedProvider,
  });
}
