import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import type { ServerSettings } from "@glade/contracts/settings/settings";
import type { QueryClient } from "@tanstack/react-query";

import type { AppSettings } from "../appSettings";
import type { DraftThreadEnvMode } from "../composerDraftDomain";
import { resolveAvailableProviderPreference } from "./providerAvailability";
import { resolveProviderDiscoveryCwd } from "./providerDiscovery";
import {
  prioritizeProviderModelDiscovery,
  providerComposerCapabilitiesQueryOptions,
  providerDiscoveryQueryKeys,
  providerModelsQueryOptions,
} from "./providerDiscoveryReactQuery";

export type ProviderModelPrefetchSettings = Pick<
  AppSettings,
  "defaultProvider" | "claudeBinaryPath" | "codexBinaryPath"
>;

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

function prefetchProviderModelsForNewThread(
  queryClient: QueryClient,
  input: {
    settings: ProviderModelPrefetchSettings;
    cwd?: string | null;
    provider: ProviderKind;
  },
): void {
  const cwd = input.cwd ?? null;
  const provider = input.provider;
  const modelsOptions = providerModelsPrefetchQueryOptions(queryClient, {
    provider,
    settings: input.settings,
    cwd,
    priority: "prefetch",
  });
  void queryClient.prefetchQuery({
    ...modelsOptions,
    retry: 0,
    staleTime: NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS,
    gcTime: NEW_THREAD_MODEL_PREFETCH_GC_TIME_MS,
  });

  void queryClient.prefetchQuery({
    ...providerComposerCapabilitiesQueryOptions(provider),
    retry: 0,
    gcTime: NEW_THREAD_MODEL_PREFETCH_GC_TIME_MS,
  });
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
  if (input.serverSettings?.providers[selectedProvider]?.enabled === false) return;
  const selectedModelQueryKey = providerModelsPrefetchQueryOptions(queryClient, {
    provider: selectedProvider,
    settings: input.settings,
    cwd,
  }).queryKey;
  prioritizeProviderModelDiscovery(selectedModelQueryKey, "prefetch");

  // Include both fetching and offline-paused queries so stale hover work cannot revive on reconnect
  // and consume native admission.
  void queryClient.cancelQueries({
    queryKey: providerDiscoveryQueryKeys.modelsAll,
    type: "inactive",
    predicate: (query) =>
      query.queryKey[5] !== null &&
      !(
        query.queryKey.length === selectedModelQueryKey.length &&
        query.queryKey.every((value, index) => Object.is(value, selectedModelQueryKey[index]))
      ),
  });

  prefetchProviderModelsForNewThread(queryClient, {
    settings: input.settings,
    cwd,
    provider: selectedProvider,
  });
}
