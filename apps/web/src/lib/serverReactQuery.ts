import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type {
  ServerConfig,
  ServerConsumeCodexResetCreditInput,
  ServerListProviderUsageInput,
  ServerProviderStatus,
  ServerStopLocalServerInput,
} from "@glade/contracts/server/server";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

const LOCAL_SERVERS_VISIBLE_REFETCH_INTERVAL_MS = 10_000;
const LOCAL_SERVERS_DEFAULT_STALE_TIME_MS = 3_000;
const KEEP_AWAKE_STATUS_REFETCH_INTERVAL_MS = 2_000;

export const serverQueryKeys = {
  all: ["server"] as const,
  config: () => ["server", "config"] as const,
  authSession: () => ["server", "auth", "session"] as const,
  environment: () => ["server", "environment"] as const,
  settings: () => ["server", "settings"] as const,
  keepAwakeStatus: () => ["server", "keepAwakeStatus"] as const,
  worktrees: () => ["server", "worktrees"] as const,
  localServers: () => ["server", "localServers"] as const,
  providerUsage: (provider: ProviderKind | null | undefined, homePath?: string | null) =>
    ["server", "providerUsage", provider ?? null, homePath ?? null] as const,
  providerUsageRoot: () => ["server", "providerUsage"] as const,
  allProviderUsage: () => ["server", "allProviderUsage"] as const,
  profileStats: (utcOffsetMinutes: number) =>
    ["server", "profileStats", "peak-hour-v2", utcOffsetMinutes] as const,
  profileTokenStats: (utcOffsetMinutes: number) =>
    ["server", "profileTokenStats", utcOffsetMinutes] as const,
};

const serverMutationKeys = {
  stopLocalServer: () => ["server", "mutation", "stopLocalServer"] as const,
};

export function serverConfigQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.config(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getConfig();
    },
    staleTime: Infinity,
  });
}

interface ProviderStatusSnapshot {
  readonly revision: number;
  readonly providers: readonly ServerProviderStatus[];
  readonly reconciled: boolean;
}

const latestProviderStatusSnapshotByQueryClient = new WeakMap<
  QueryClient,
  ProviderStatusSnapshot
>();

export function hasReconciledServerProviderStatuses(queryClient: QueryClient): boolean {
  return latestProviderStatusSnapshotByQueryClient.get(queryClient)?.reconciled === true;
}

function recordProviderStatusSnapshot(
  queryClient: QueryClient,
  providers: readonly ServerProviderStatus[],
): ProviderStatusSnapshot {
  const snapshot = {
    revision: (latestProviderStatusSnapshotByQueryClient.get(queryClient)?.revision ?? 0) + 1,
    providers,
    reconciled: true,
  };
  latestProviderStatusSnapshotByQueryClient.set(queryClient, snapshot);
  return snapshot;
}

// Provider streams can win the race against the initial config query, so retain the latest snapshot
// and apply it after config hydration instead of dropping it.
export async function reconcileServerProviderStatuses(
  queryClient: QueryClient,
  providers: readonly ServerProviderStatus[],
  options?: {
    readonly loadConfig?: () => Promise<ServerConfig>;
  },
): Promise<void> {
  recordProviderStatusSnapshot(queryClient, providers);

  let applied = false;
  queryClient.setQueryData<ServerConfig>(serverQueryKeys.config(), (current) => {
    if (!current) return current;
    applied = true;
    return { ...current, providers };
  });
  if (applied) return;

  const loadConfig =
    options?.loadConfig ??
    (() =>
      queryClient.fetchQuery({
        ...serverConfigQueryOptions(),
        staleTime: 0,
      }));
  const hydratedConfig = await loadConfig();
  const latestProviders =
    latestProviderStatusSnapshotByQueryClient.get(queryClient)?.providers ?? providers;
  queryClient.setQueryData<ServerConfig>(serverQueryKeys.config(), (current) => ({
    ...(current ?? hydratedConfig),
    providers: latestProviders,
  }));
}

// Refreshes the config projection when the WebSocket reopens without letting the response overwrite
// a provider snapshot that arrived while it was in flight.
export async function refreshServerConfigAfterTransportOpen(
  queryClient: QueryClient,
  options?: {
    readonly loadConfig?: () => Promise<ServerConfig>;
  },
): Promise<void> {
  const providerSnapshotAtStart = latestProviderStatusSnapshotByQueryClient.get(queryClient);
  const providerRevisionAtStart = providerSnapshotAtStart?.revision ?? 0;
  latestProviderStatusSnapshotByQueryClient.set(queryClient, {
    revision: providerRevisionAtStart,
    providers: providerSnapshotAtStart?.providers ?? [],
    reconciled: false,
  });
  const loadConfig =
    options?.loadConfig ??
    (() =>
      queryClient.fetchQuery({
        ...serverConfigQueryOptions(),
        staleTime: 0,
      }));
  const config = await loadConfig();
  const latestProviderSnapshot = latestProviderStatusSnapshotByQueryClient.get(queryClient);
  queryClient.setQueryData<ServerConfig>(serverQueryKeys.config(), {
    ...config,
    providers:
      latestProviderSnapshot?.reconciled === true &&
      latestProviderSnapshot.revision > providerRevisionAtStart
        ? latestProviderSnapshot.providers
        : config.providers,
  });
}

export function serverAuthSessionQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.authSession(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getAuthSession();
    },
    staleTime: 15_000,
  });
}

export function serverSettingsQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.settings(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getSettings();
    },
    staleTime: Infinity,
  });
}

// Polled only while a consumer is mounted: the assertion follows agent work, not client actions.
export function serverKeepAwakeStatusQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.keepAwakeStatus(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getKeepAwakeStatus();
    },
    staleTime: 0,
    refetchInterval: KEEP_AWAKE_STATUS_REFETCH_INTERVAL_MS,
  });
}

export function serverWorktreesQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.worktrees(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listWorktrees();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function serverLocalServersQueryOptions(
  input:
    | boolean
    | {
        enabled?: boolean;
        refetchInterval?: number | false;
        staleTime?: number;
      } = true,
) {
  const options = typeof input === "boolean" ? { enabled: input } : input;
  const enabled = options.enabled ?? true;
  return queryOptions({
    queryKey: serverQueryKeys.localServers(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listLocalServers();
    },
    enabled,
    staleTime: options.staleTime ?? LOCAL_SERVERS_DEFAULT_STALE_TIME_MS,
    refetchInterval: enabled
      ? (options.refetchInterval ?? LOCAL_SERVERS_VISIBLE_REFETCH_INTERVAL_MS)
      : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function serverStopLocalServerMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: serverMutationKeys.stopLocalServer(),
    mutationFn: async (server: ServerStopLocalServerInput) => {
      const api = ensureNativeApi();
      return api.server.stopLocalServer(server);
    },
    onSettled: () => {
      void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.localServers() });
    },
  });
}

export function serverProviderUsageSnapshotQueryOptions(input: {
  provider: ProviderKind | null | undefined;
  homePath?: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: serverQueryKeys.providerUsage(input.provider, input.homePath),
    enabled: (input.enabled ?? true) && input.provider !== null && input.provider !== undefined,
    // Longer than the server's 30s snapshot cache, so polls rarely land on a cached value.
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      if (!input.provider) return null;
      const api = ensureNativeApi();
      return api.server.getProviderUsageSnapshot({
        provider: input.provider,
        ...(input.homePath ? { homePath: input.homePath } : {}),
      });
    },
  });
}

export async function fetchAllProviderUsage(input: ServerListProviderUsageInput = {}) {
  const api = ensureNativeApi();
  return api.server.listProviderUsage(input);
}

export async function consumeCodexResetCredit(input: ServerConsumeCodexResetCreditInput) {
  const api = ensureNativeApi();
  return api.server.consumeCodexResetCredit(input);
}

// Provider enablement changes alter the membership of the batch and invalidate any provider-scoped
// result that may otherwise survive after a provider is disabled.
export async function invalidateProviderUsageQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: serverQueryKeys.allProviderUsage() }),
    queryClient.invalidateQueries({ queryKey: serverQueryKeys.providerUsageRoot() }),
  ]);
}

export function serverProfileStatsQueryOptions(input: { enabled?: boolean } = {}) {
  const utcOffsetMinutes = -new Date().getTimezoneOffset();
  return queryOptions({
    queryKey: serverQueryKeys.profileStats(utcOffsetMinutes),
    enabled: input.enabled ?? true,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.stats.getProfileStats({
        utcOffsetMinutes,
      });
    },
  });
}

export function serverProfileTokenStatsQueryOptions(input: { enabled?: boolean } = {}) {
  const utcOffsetMinutes = -new Date().getTimezoneOffset();
  return queryOptions({
    queryKey: serverQueryKeys.profileTokenStats(utcOffsetMinutes),
    enabled: input.enabled ?? true,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.stats.getProfileTokenStats({
        utcOffsetMinutes,
      });
    },
  });
}

export function serverAllProviderUsageQueryOptions(
  input:
    | boolean
    | {
        enabled?: boolean;
      } = true,
) {
  const enabled = typeof input === "boolean" ? input : (input.enabled ?? true);
  return queryOptions({
    queryKey: serverQueryKeys.allProviderUsage(),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => fetchAllProviderUsage(),
  });
}
