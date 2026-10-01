import type {
  ProviderComposerCapabilities,
  ProviderListAgentsResult,
  ProviderListCommandsResult,
  ProviderListModelsResult,
  ProviderListPluginsResult,
  ProviderListSkillsResult,
  ProviderSkillsCatalogResult,
} from "@glade/contracts/provider/providerDiscovery";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ServerConfig } from "@glade/contracts/server/server";
import { serverQueryKeys } from "./serverReactQuery";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

const EMPTY_SKILLS_RESULT: ProviderListSkillsResult = {
  skills: [],
  source: "empty",
  cached: false,
};

const EMPTY_COMMANDS_RESULT: ProviderListCommandsResult = {
  commands: [],
  source: "empty",
  cached: false,
};

const EMPTY_AGENTS_RESULT: ProviderListAgentsResult = {
  agents: [],
  source: "empty",
  cached: false,
};

const EMPTY_PLUGINS_RESULT: ProviderListPluginsResult = {
  marketplaces: [],
  marketplaceLoadErrors: [],
  remoteSyncError: null,
  featuredPluginIds: [],
  source: "empty",
  cached: false,
};

// Keep model discovery to one request at a time so opening the provider picker cannot reject most
// catalogs before their CLIs even run. Foreground requests may move ahead of queued warming, but
// never interrupt the discovery that already owns the single model slot.
type ProviderModelDiscoveryPriority = "background" | "prefetch" | "foreground";

interface ProviderModelDiscoveryTask {
  readonly queryKey: readonly unknown[];
  priority: ProviderModelDiscoveryPriority;
  priorityOrder: number;
  readonly signal: AbortSignal;
  readonly discover: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly abort: () => void;
}

const providerModelDiscoveryQueue: ProviderModelDiscoveryTask[] = [];

const foregroundModelDiscoveryOwners = new Set<readonly unknown[]>();
let providerModelDiscoveryRunning = false;
let providerModelDiscoveryPriorityOrder = 0;

const PROVIDER_MODEL_DISCOVERY_PRIORITY_RANK: Record<ProviderModelDiscoveryPriority, number> = {
  background: 0,
  prefetch: 1,
  foreground: 2,
};

const PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS = 90_000;

function queryKeysMatch(left: readonly unknown[], right: readonly unknown[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  );
}

function abortReason(signal: AbortSignal): unknown {
  try {
    signal.throwIfAborted();
  } catch (error) {
    return error;
  }
  return new Error("Provider model discovery was cancelled.");
}

function drainProviderModelDiscoveryQueue(): void {
  if (providerModelDiscoveryRunning) return;

  let nextIndex = 0;
  for (let index = 1; index < providerModelDiscoveryQueue.length; index += 1) {
    const candidate = providerModelDiscoveryQueue[index];
    const current = providerModelDiscoveryQueue[nextIndex];
    if (!candidate || !current) continue;
    const candidateRank = PROVIDER_MODEL_DISCOVERY_PRIORITY_RANK[candidate.priority];
    const currentRank = PROVIDER_MODEL_DISCOVERY_PRIORITY_RANK[current.priority];
    if (
      candidateRank > currentRank ||
      (candidateRank === currentRank &&
        candidate.priority !== "background" &&
        candidate.priorityOrder > current.priorityOrder)
    ) {
      nextIndex = index;
    }
  }
  const task = providerModelDiscoveryQueue.splice(nextIndex, 1)[0];
  if (!task) return;

  task.signal.removeEventListener("abort", task.abort);
  if (task.signal.aborted) {
    task.reject(abortReason(task.signal));
    drainProviderModelDiscoveryQueue();
    return;
  }

  providerModelDiscoveryRunning = true;
  let taskSettled = false;
  const finishTask = (settle: () => void) => {
    if (taskSettled) return;
    taskSettled = true;
    clearTimeout(timeoutId);
    task.signal.removeEventListener("abort", onTaskAbort);
    providerModelDiscoveryRunning = false;
    settle();
    drainProviderModelDiscoveryQueue();
  };
  const onTaskAbort = () => finishTask(() => task.reject(abortReason(task.signal)));
  const timeoutId = setTimeout(
    () => finishTask(() => task.reject(new Error("Provider model discovery timed out."))),
    PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS,
  );
  task.signal.addEventListener("abort", onTaskAbort, { once: true });
  void Promise.resolve()
    .then(task.discover)
    .then(
      (value) => finishTask(() => task.resolve(value)),
      (reason) => finishTask(() => task.reject(reason)),
    );
}

export function prioritizeProviderModelDiscovery(
  queryKey: readonly unknown[],
  priority: Exclude<ProviderModelDiscoveryPriority, "background"> = "foreground",
): (() => void) | undefined {
  const owner = priority === "foreground" ? [...queryKey] : undefined;
  if (owner) foregroundModelDiscoveryOwners.add(owner);
  for (const task of providerModelDiscoveryQueue) {
    const matches = queryKeysMatch(task.queryKey, queryKey);
    if (!matches && priority === "prefetch" && task.priority === "prefetch") {
      task.priority = "background";
    } else if (matches) {
      if (
        task.priority === "background" ||
        (task.priority === "prefetch" && priority === "foreground")
      ) {
        task.priority = priority;
      }

      task.priorityOrder = ++providerModelDiscoveryPriorityOrder;
    }
  }
  if (!owner) return;
  return () => {
    foregroundModelDiscoveryOwners.delete(owner);
    if ([...foregroundModelDiscoveryOwners].some((key) => queryKeysMatch(key, queryKey))) return;
    for (const task of providerModelDiscoveryQueue) {
      if (queryKeysMatch(task.queryKey, queryKey) && task.priority === "foreground") {
        task.priority = "background";
        task.priorityOrder = 0;
      }
    }
  };
}

function serializeProviderModelDiscovery<T>(
  queryKey: readonly unknown[],
  signal: AbortSignal,
  priority: ProviderModelDiscoveryPriority,
  discover: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      const taskIndex = providerModelDiscoveryQueue.findIndex((task) => task.abort === abort);
      if (taskIndex < 0) return;
      providerModelDiscoveryQueue.splice(taskIndex, 1);
      reject(abortReason(signal));
    };
    const effectivePriority = [...foregroundModelDiscoveryOwners].some((key) =>
      queryKeysMatch(key, queryKey),
    )
      ? "foreground"
      : priority;
    providerModelDiscoveryQueue.push({
      queryKey,
      priority: effectivePriority,
      priorityOrder: effectivePriority === "background" ? 0 : ++providerModelDiscoveryPriorityOrder,
      signal,
      discover,
      resolve: (value) => resolve(value as T),
      reject,
      abort,
    });
    signal.addEventListener("abort", abort, { once: true });
    drainProviderModelDiscoveryQueue();
  });
}

export const providerDiscoveryQueryKeys = {
  all: ["provider-discovery"] as const,
  modelsAll: ["provider-discovery", "models"] as const,
  composerCapabilities: (provider: ProviderKind) =>
    ["provider-discovery", "composer-capabilities", provider] as const,
  commands: (provider: ProviderKind, cwd: string | null, connectionKey: string | null) =>
    ["provider-discovery", "commands", provider, cwd, connectionKey] as const,

  skills: (provider: ProviderKind, cwd: string | null) =>
    ["provider-discovery", "skills", provider, cwd] as const,
  skillsCatalog: (cwd: string | null) => ["provider-discovery", "skills-catalog", cwd] as const,
  plugins: (provider: ProviderKind, cwd: string | null, threadId: string | null) =>
    ["provider-discovery", "plugins", provider, cwd, threadId] as const,
  plugin: (
    provider: ProviderKind,
    marketplacePath: string,
    pluginName: string,
    cwd: string | null,
    threadId: string | null,
  ) =>
    ["provider-discovery", "plugin", provider, marketplacePath, pluginName, cwd, threadId] as const,
  models: (
    provider: ProviderKind,
    binaryPath: string | null,
    apiEndpoint: string | null,
    cwd: string | null,
    accountIdentity: string | null = null,
  ) =>
    [
      "provider-discovery",
      "models",
      provider,
      binaryPath,
      apiEndpoint,
      cwd,
      accountIdentity,
    ] as const,
  agentsForProvider: (provider: ProviderKind) =>
    ["provider-discovery", "agents", provider] as const,
  agents: (provider: ProviderKind, binaryPath: string | null, cwd: string | null) =>
    [...providerDiscoveryQueryKeys.agentsForProvider(provider), binaryPath, cwd] as const,
};

export function providerComposerCapabilitiesQueryOptions(provider: ProviderKind) {
  return queryOptions({
    queryKey: providerDiscoveryQueryKeys.composerCapabilities(provider),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.provider.getComposerCapabilities({ provider });
    },
    staleTime: Infinity,
  });
}

export function providerSkillsQueryOptions(input: {
  provider: ProviderKind;
  cwd: string | null;
  threadId?: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: providerDiscoveryQueryKeys.skills(input.provider, input.cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Skill discovery is unavailable.");
      }
      return api.provider.listSkills({
        provider: input.provider,
        cwd: input.cwd,
        ...(input.threadId ? { threadId: input.threadId } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: 30_000,
    placeholderData: (previous) => previous ?? EMPTY_SKILLS_RESULT,
  });
}

export function skillsCatalogQueryOptions(input?: { cwd?: string | null; enabled?: boolean }) {
  const cwd = input?.cwd ?? null;
  return queryOptions({
    queryKey: providerDiscoveryQueryKeys.skillsCatalog(cwd),
    queryFn: async (): Promise<ProviderSkillsCatalogResult> => {
      const api = ensureNativeApi();
      return api.provider.listSkillsCatalog(cwd ? { cwd } : {});
    },
    enabled: input?.enabled ?? true,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

export function providerCommandsQueryOptions(input: {
  provider: ProviderKind;
  cwd: string | null;
  threadId?: string | null;
  binaryPath?: string | null;
  serverUrl?: string | null;

  experimentalWebSockets?: boolean | undefined;
  enabled?: boolean;
}) {
  const connectionKey = JSON.stringify({
    binaryPath: input.binaryPath ?? null,
    serverUrl: input.serverUrl ?? null,
    experimentalWebSockets: input.experimentalWebSockets ?? null,

    threadId: input.provider === "claudeAgent" ? (input.threadId ?? null) : null,
  });
  return queryOptions({
    queryKey: providerDiscoveryQueryKeys.commands(input.provider, input.cwd, connectionKey),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Command discovery is unavailable.");
      }
      return api.provider.listCommands({
        provider: input.provider,
        cwd: input.cwd,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.binaryPath ? { binaryPath: input.binaryPath } : {}),
        ...(input.serverUrl ? { serverUrl: input.serverUrl } : {}),
        ...(input.experimentalWebSockets !== undefined
          ? { experimentalWebSockets: input.experimentalWebSockets }
          : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: 30_000,
    // Keeps the menu populated while refetching. `artifacts` is dropped because the previous entry can
    // belong to another Claude thread, whose session may have a different Artifact opt-in; the warning
    // waits for this thread's own answer.
    placeholderData: (previous) => {
      if (!previous) return EMPTY_COMMANDS_RESULT;
      const { artifacts: _previousArtifacts, ...rest } = previous;
      return rest;
    },
  });
}

export function providerModelsQueryOptions(
  input: {
    provider: ProviderKind;
    binaryPath?: string | null;
    apiEndpoint?: string | null;
    cwd?: string | null;
    enabled?: boolean;
    priority?: ProviderModelDiscoveryPriority | undefined;
  },
  queryClient: QueryClient,
) {
  const status = queryClient
    .getQueryData<ServerConfig>(serverQueryKeys.config())
    ?.providers.find((status) => status.provider === input.provider);
  const accountIdentity = status?.modelCatalogContextIdentity ?? null;
  const cwd = input.cwd ?? null;
  const queryKey = providerDiscoveryQueryKeys.models(
    input.provider,
    input.binaryPath ?? null,
    input.apiEndpoint ?? null,
    cwd,
    accountIdentity,
  );
  const globalQueryKey = providerDiscoveryQueryKeys.models(
    input.provider,
    input.binaryPath ?? null,
    input.apiEndpoint ?? null,
    null,
    accountIdentity,
  );
  return queryOptions<ProviderListModelsResult, Error, ProviderListModelsResult, typeof queryKey>({
    queryKey,
    queryFn: ({ signal }): Promise<ProviderListModelsResult> =>
      serializeProviderModelDiscovery(
        queryKey,
        signal,
        input.priority ?? "background",
        async () => {
          const api = ensureNativeApi();
          const result = await api.provider.listModels({
            provider: input.provider,
            ...(input.binaryPath ? { binaryPath: input.binaryPath } : {}),
            ...(input.apiEndpoint ? { apiEndpoint: input.apiEndpoint } : {}),
            ...(cwd ? { cwd } : {}),
          });
          return result;
        },
      ),
    enabled: input.enabled ?? true,

    retry: 3,

    gcTime: 24 * 60 * 60_000,
    placeholderData: () =>
      cwd === null || accountIdentity === null
        ? undefined
        : queryClient.getQueryData<ProviderListModelsResult>(globalQueryKey),
    staleTime: (query) => (query.state.data?.stale ? 0 : 30 * 60_000),
    refetchOnWindowFocus: "always",
    refetchInterval: (query) =>
      query.state.data?.stale && !query.state.data.error ? 1_000 : false,
  });
}

export function providerAgentsQueryOptions(input: {
  provider: ProviderKind;
  binaryPath?: string | null;
  cwd?: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: providerDiscoveryQueryKeys.agents(
      input.provider,
      input.binaryPath ?? null,
      input.cwd ?? null,
    ),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.provider.listAgents({
        provider: input.provider,
        ...(input.binaryPath ? { binaryPath: input.binaryPath } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
      });
    },
    enabled: input.enabled ?? true,

    staleTime: (query) => (query.state.data?.source === "pending" ? 0 : 15 * 60_000),
    refetchInterval: (query) => (query.state.data?.source === "pending" ? 30_000 : false),
    placeholderData: (previous) => previous ?? EMPTY_AGENTS_RESULT,
  });
}

export function providerPluginsQueryOptions(input: {
  provider: ProviderKind;
  cwd: string | null;
  threadId?: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: providerDiscoveryQueryKeys.plugins(input.provider, input.cwd, input.threadId ?? null),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.provider.listPlugins({
        provider: input.provider,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
      });
    },
    enabled: input.enabled ?? true,
    staleTime: 30_000,
    placeholderData: (previous) => previous ?? EMPTY_PLUGINS_RESULT,
  });
}

export function supportsSkillDiscovery(
  capabilities: ProviderComposerCapabilities | undefined,
): boolean {
  return capabilities?.supportsSkillDiscovery === true;
}

export function supportsNativeSlashCommandDiscovery(
  capabilities: ProviderComposerCapabilities | undefined,
): boolean {
  return capabilities?.supportsNativeSlashCommandDiscovery === true;
}

export function supportsPluginDiscovery(
  capabilities: ProviderComposerCapabilities | undefined,
): boolean {
  return capabilities?.supportsPluginDiscovery === true;
}

export function supportsThreadCompaction(
  capabilities: ProviderComposerCapabilities | undefined,
): boolean {
  return capabilities?.supportsThreadCompaction === true;
}

export function supportsThreadImport(
  capabilities: ProviderComposerCapabilities | undefined,
): boolean {
  return capabilities?.supportsThreadImport === true;
}
