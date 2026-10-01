import type { GitReadWorkingTreeDiffInput } from "@glade/contracts/git/git";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";
import { EXPENSIVE_READ_RETRY_OPTIONS, isRpcCapacityExceededError } from "./expensiveReadRetry";
import { preserveActivePullRequestActionGitFields } from "./pullRequestGitCache";
import { capturePullRequestActionReadFence } from "./pullRequestMutationCoordinator";

const GIT_STATUS_STALE_TIME_MS = 30_000;

const GIT_STATUS_REFETCH_INTERVAL_MS = 900_000;
const GIT_BRANCHES_STALE_TIME_MS = 15_000;
const GIT_BRANCHES_REFETCH_INTERVAL_MS = 900_000;
const GIT_WORKING_TREE_DIFF_STALE_TIME_MS = 5_000;
export const GIT_WORKING_TREE_DIFF_LIVE_REFETCH_INTERVAL_MS = 4_000;

export function isGitExpensiveReadCapacityError(
  error: unknown,
): error is { readonly code: string; readonly retryAfterMs?: unknown } {
  return isRpcCapacityExceededError(error);
}

const GIT_EXPENSIVE_READ_RETRY_OPTIONS = EXPENSIVE_READ_RETRY_OPTIONS;

export const gitQueryKeys = {
  all: ["git"] as const,
  history: (cwd: string | null) => ["git", "history", cwd] as const,
  statuses: ["git", "status"] as const,
  pullRequests: ["git", "pull-request"] as const,
  githubRepository: (cwd: string | null) => ["git", "github-repository", cwd] as const,
  status: (cwd: string | null) => ["git", "status", cwd] as const,
  branches: (cwd: string | null) => ["git", "branches", cwd] as const,
  recentCommits: (cwd: string | null, limit: number) =>
    ["git", "recent-commits", cwd, limit] as const,
  pullRequest: (cwd: string | null) => ["git", "pull-request", cwd] as const,
  workingTreeDiffs: (cwd: string | null) => ["git", "working-tree-diff", cwd] as const,
  sourceControlFiles: (cwd: string | null) => ["git", "source-control-files", cwd] as const,
  workingTreeDiff: (
    cwd: string | null,
    scope: GitReadWorkingTreeDiffInput["scope"] = "workingTree",
    compareRef: string | null = null,
    filePath: string | null = null,
  ) =>
    filePath === null
      ? (["git", "working-tree-diff", cwd, scope, compareRef] as const)
      : (["git", "working-tree-diff", cwd, scope, compareRef, "file", filePath] as const),

  workingTreeDiffStats: (
    cwd: string | null,
    scope: GitReadWorkingTreeDiffInput["scope"] = "workingTree",
    compareRef: string | null = null,
    includeUntrackedFiles = false,
  ) =>
    includeUntrackedFiles
      ? (["git", "working-tree-diff", cwd, scope, compareRef, "stats", "untracked-files"] as const)
      : (["git", "working-tree-diff", cwd, scope, compareRef, "stats"] as const),
  blameLine: (
    cwd: string | null,
    filePath: string | null,
    line: number | null,
    rev: string | null,
    base: "branch" | null,
  ) => ["git", "blame-line", cwd, filePath, line, rev, base] as const,
  fileAtRev: (
    cwd: string | null,
    filePath: string | null,
    rev: string | null,
    base: "branch" | "index" | null,
  ) => ["git", "file-at-rev", cwd, filePath, rev, base] as const,
  diffSummary: (
    cacheScope: string | null,
    model: string | null,
    modelSelectionKey: string | null,
    codexHomePath: string | null,
    providerOptionsKey: string | null,
    patchKey: string | null,
  ) =>
    [
      "git",
      "diff-summary",
      cacheScope,
      model,
      modelSelectionKey,
      codexHomePath,
      providerOptionsKey,
      patchKey,
    ] as const,
};

export const gitMutationKeys = {
  init: (cwd: string | null) => ["git", "mutation", "init", cwd] as const,
  checkout: (cwd: string | null) => ["git", "mutation", "checkout", cwd] as const,
  runStackedAction: (cwd: string | null) => ["git", "mutation", "run-stacked-action", cwd] as const,
  pull: (cwd: string | null) => ["git", "mutation", "pull", cwd] as const,
  preparePullRequestThread: (cwd: string | null) =>
    ["git", "mutation", "prepare-pull-request-thread", cwd] as const,
  handoffThread: (cwd: string | null) => ["git", "mutation", "handoff-thread", cwd] as const,
  stageFiles: (cwd: string | null) => ["git", "mutation", "stage-files", cwd] as const,
  revertUnstagedFile: (cwd: string | null) =>
    ["git", "mutation", "revert-unstaged-file", cwd] as const,
  unstageFiles: (cwd: string | null) => ["git", "mutation", "unstage-files", cwd] as const,
};

type GitRefreshDepth = "availability" | "active-details";

interface ActiveGitRefresh {
  depth: GitRefreshDepth;
  started: boolean;

  availability: Promise<void>;

  promise: Promise<void>;
}

const activeGitRefreshes = new WeakMap<QueryClient, Map<string, ActiveGitRefresh>>();
const gitRefreshQueueTails = new WeakMap<QueryClient, Promise<void>>();

function enqueueGitRefresh(queryClient: QueryClient, refresh: () => Promise<void>): Promise<void> {
  const previous = gitRefreshQueueTails.get(queryClient) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(refresh);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  gitRefreshQueueTails.set(queryClient, settled);
  void settled.then(() => {
    if (gitRefreshQueueTails.get(queryClient) === settled) {
      gitRefreshQueueTails.delete(queryClient);
    }
  });
  return result;
}

function trackGitRefresh(
  queryClient: QueryClient,
  cwd: string,
  entry: ActiveGitRefresh,
): Promise<void> {
  let refreshes = activeGitRefreshes.get(queryClient);
  if (!refreshes) {
    refreshes = new Map();
    activeGitRefreshes.set(queryClient, refreshes);
  }
  refreshes.set(cwd, entry);
  const cleanup = () => {
    if (refreshes.get(cwd) === entry) refreshes.delete(cwd);
  };
  void entry.promise.then(cleanup, cleanup);
  return entry.promise;
}

// Refetches the matching active queries from scratch. A fetch already in flight may have read the
// repository before whatever change triggered this refresh (e.g. a checkout or pull that just
// settled), so reusing it would mark stale data fresh. It is cancelled explicitly first because
// refetchQueries' cancelRefetch only cancels fetches on queries that already hold data — a cold
// query's initial fetch would otherwise be joined.
async function refetchFreshGitQueries(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
): Promise<void> {
  await queryClient.cancelQueries({ queryKey, exact: true, fetchStatus: "fetching" });
  await queryClient.refetchQueries(
    { queryKey, exact: true, type: "active" },
    { cancelRefetch: true },
  );
}

async function refreshGitAvailability(queryClient: QueryClient, cwd: string): Promise<void> {
  await queryClient.resetQueries({ queryKey: gitQueryKeys.history(cwd) });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["git", "rebase-state", cwd] }),
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.githubRepository(cwd),
      exact: true,
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.status(cwd),
      exact: true,
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.branches(cwd),
      exact: true,
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: ["git", "recent-commits", cwd] as const,
      refetchType: "none",
    }),
  ]);
  await Promise.all([
    refetchFreshGitQueries(queryClient, gitQueryKeys.githubRepository(cwd)),
    refetchFreshGitQueries(queryClient, gitQueryKeys.status(cwd)),
    refetchFreshGitQueries(queryClient, gitQueryKeys.branches(cwd)),
    ...queryClient
      .getQueryCache()
      .findAll({ queryKey: ["git", "recent-commits", cwd] as const, type: "active" })
      .map((query) => refetchFreshGitQueries(queryClient, query.queryKey)),
  ]);
}

function activeGitDetailQueries(queryClient: QueryClient, cwd: string) {
  const queryCache = queryClient.getQueryCache();
  const queries = [
    ...queryCache.findAll({
      queryKey: gitQueryKeys.workingTreeDiffs(cwd),
      type: "active",
    }),
    ...queryCache.findAll({ queryKey: gitQueryKeys.pullRequest(cwd), type: "active" }),
    ...queryCache.findAll({ queryKey: gitQueryKeys.sourceControlFiles(cwd), type: "active" }),

    ...queryCache.findAll({ queryKey: ["git", "file-at-rev", cwd] as const, type: "active" }),
    ...queryCache.findAll({ queryKey: ["git", "blame-line", cwd] as const, type: "active" }),
  ];
  const uniqueQueries = [...new Map(queries.map((query) => [query.queryHash, query])).values()];
  return uniqueQueries.toSorted((left, right) => {
    const leftIsStats = left.queryKey.at(-1) === "stats";
    const rightIsStats = right.queryKey.at(-1) === "stats";
    if (leftIsStats !== rightIsStats) return leftIsStats ? -1 : 1;
    const leftIsPatch = left.queryKey[1] === "working-tree-diff" && !leftIsStats;
    const rightIsPatch = right.queryKey[1] === "working-tree-diff" && !rightIsStats;
    if (leftIsPatch !== rightIsPatch) return leftIsPatch ? 1 : -1;
    return left.queryHash.localeCompare(right.queryHash);
  });
}

async function refreshActiveGitDetails(queryClient: QueryClient, cwd: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.workingTreeDiffs(cwd),
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.sourceControlFiles(cwd),
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.pullRequest(cwd),
      refetchType: "none",
    }),
    // Revision-dependent families: after a save, commit, or branch movement the cached
    // attribution/blobs would otherwise survive their stale windows.
    queryClient.invalidateQueries({
      queryKey: ["git", "blame-line", cwd] as const,
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: ["git", "file-at-rev", cwd] as const,
      refetchType: "none",
    }),
  ]);
  for (const query of activeGitDetailQueries(queryClient, cwd)) {
    await enqueueGitRefresh(queryClient, () => refetchFreshGitQueries(queryClient, query.queryKey));
  }
}

async function refreshGitWorkingTreeDiffsForCwd(
  queryClient: QueryClient,
  cwd: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: gitQueryKeys.sourceControlFiles(cwd),
    refetchType: "none",
  });
  await queryClient.invalidateQueries({
    queryKey: gitQueryKeys.workingTreeDiffs(cwd),
    refetchType: "none",
  });
  const queries = activeGitDetailQueries(queryClient, cwd).filter(
    (query) =>
      query.queryKey[1] === "working-tree-diff" || query.queryKey[1] === "source-control-files",
  );
  for (const query of queries) {
    await enqueueGitRefresh(queryClient, () => refetchFreshGitQueries(queryClient, query.queryKey));
  }
}

const activeFileWriteRefreshes = new WeakMap<
  QueryClient,
  Map<string, { generation: number; promise: Promise<void> }>
>();

// Refresh only working-copy data after file writes. Autosave must not refetch PRs, branches or
// revision blobs for each pause in typing. Watcher echoes join the pending refresh; events arriving
// during a read request one fresh pass.
export function refreshGitAfterFileWrite(queryClient: QueryClient, cwd: string): Promise<void> {
  let refreshes = activeFileWriteRefreshes.get(queryClient);
  if (!refreshes) {
    refreshes = new Map();
    activeFileWriteRefreshes.set(queryClient, refreshes);
  }
  const existing = refreshes.get(cwd);
  if (existing) {
    existing.generation += 1;
    return existing.promise;
  }
  const entry = { generation: 0, promise: Promise.resolve() };
  refreshes.set(cwd, entry);
  entry.promise = (async () => {
    let completed: number;
    do {
      completed = entry.generation;

      await refreshGitWorkingTreeDiffsForCwd(queryClient, cwd);
      await queryClient.invalidateQueries({
        queryKey: gitQueryKeys.status(cwd),
        exact: true,
        refetchType: "none",
      });
      await enqueueGitRefresh(queryClient, () =>
        refetchFreshGitQueries(queryClient, gitQueryKeys.status(cwd)),
      );
    } while (completed !== entry.generation);
  })().finally(() => {
    if (refreshes.get(cwd) === entry) refreshes.delete(cwd);
  });
  return entry.promise;
}

// Availability is refreshed first; active diff/PR details follow one at a time so Git UI work
// cannot consume both expensive-read leases or fan out across every visible worktree. A refresh
// only joins an existing one while that refresh is still queued: once its reads have begun they may
// predate whatever change triggered this request (a checkout or pull that just settled), so joining
// would return without ever observing the new repository state.
function refreshGitQueriesForCwd(
  queryClient: QueryClient,
  cwd: string,
  depth: GitRefreshDepth = "active-details",
): Promise<void> {
  const existing = activeGitRefreshes.get(queryClient)?.get(cwd);
  if (existing && !existing.started) {
    if (depth === "active-details") existing.depth = "active-details";
    return depth === "availability" ? existing.availability : existing.promise;
  }

  const entry: ActiveGitRefresh = {
    depth,
    started: false,
    availability: Promise.resolve(),
    promise: Promise.resolve(),
  };
  entry.availability = enqueueGitRefresh(queryClient, () => {
    entry.started = true;
    return refreshGitAvailability(queryClient, cwd);
  });

  entry.promise = entry.availability.then(() =>
    entry.depth === "active-details" ? refreshActiveGitDetails(queryClient, cwd) : undefined,
  );
  void trackGitRefresh(queryClient, cwd, entry);
  return depth === "availability" ? entry.availability : entry.promise;
}

export function refreshGitActionAvailability(queryClient: QueryClient, cwd: string): Promise<void> {
  return refreshGitQueriesForCwd(queryClient, cwd, "availability");
}

function cachedGitCwds(queryClient: QueryClient): string[] {
  const cwdFamilies = new Set([
    "github-repository",
    "status",
    "branches",
    "recent-commits",
    "working-tree-diff",
    "source-control-files",
    "pull-request",
  ]);
  const cwds = queryClient
    .getQueryCache()
    .findAll({ queryKey: gitQueryKeys.all })
    .flatMap((query) => {
      const family = query.queryKey[1];
      const cwd = query.queryKey[2];
      return typeof family === "string" && cwdFamilies.has(family) && typeof cwd === "string"
        ? [cwd]
        : [];
    });
  return [...new Set(cwds)];
}

// excludeCwds lets a caller that already refreshed (and awaited) specific checkouts fan the rest
// out in the background without queueing duplicate refreshes for the awaited ones.
export function invalidateGitQueries(
  queryClient: QueryClient,
  options?: { readonly excludeCwds?: Iterable<string> },
) {
  const excludedCwds = new Set(options?.excludeCwds ?? []);
  return Promise.all(
    cachedGitCwds(queryClient)
      .filter((cwd) => !excludedCwds.has(cwd))
      .map((cwd) => refreshGitQueriesForCwd(queryClient, cwd)),
  );
}

export function invalidateGitQueriesForCwds(queryClient: QueryClient, cwds: Iterable<string>) {
  const uniqueCwds = [...new Set([...cwds].filter((cwd) => cwd.length > 0))];
  return Promise.all(uniqueCwds.map((cwd) => refreshGitQueriesForCwd(queryClient, cwd)));
}

export function refreshGitQueriesScoped(
  queryClient: QueryClient,
  cwds: Iterable<string>,
): Promise<void> {
  const awaitedCwds = [...new Set([...cwds].filter((cwd) => cwd.length > 0))];
  const scoped = invalidateGitQueriesForCwds(queryClient, awaitedCwds);
  void invalidateGitQueries(queryClient, { excludeCwds: awaitedCwds }).catch(() => undefined);
  return scoped.then(() => undefined);
}

export function gitStatusQueryOptions(cwd: string | null, enabled = true) {
  return queryOptions({
    queryKey: gitQueryKeys.status(cwd),
    queryFn: async ({ client }) => {
      const readFence = capturePullRequestActionReadFence(client);
      const api = ensureNativeApi();
      if (!cwd) throw new Error("Git status is unavailable.");
      return preserveActivePullRequestActionGitFields(
        client,
        await api.git.status({ cwd }),
        readFence,
      );
    },
    enabled: enabled && cwd !== null,
    staleTime: GIT_STATUS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always",
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
    ...GIT_EXPENSIVE_READ_RETRY_OPTIONS,
  });
}

export function gitGithubRepositoryQueryOptions(cwd: string | null, enabled = true) {
  return queryOptions({
    queryKey: gitQueryKeys.githubRepository(cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!cwd) throw new Error("GitHub repository is unavailable.");
      return api.git.githubRepository({ cwd });
    },
    enabled: enabled && cwd !== null,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

function resolveGitCompareRef(
  scope: GitReadWorkingTreeDiffInput["scope"],
  compareRef: string | null | undefined,
): string | null {
  if (scope !== "ref") {
    return null;
  }
  const trimmed = compareRef?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function gitBranchesQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: gitQueryKeys.branches(cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!cwd) throw new Error("Git branches are unavailable.");
      return api.git.listBranches({ cwd });
    },
    enabled: cwd !== null,
    staleTime: GIT_BRANCHES_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_BRANCHES_REFETCH_INTERVAL_MS,
  });
}

export function gitResolvePullRequestQueryOptions(input: {
  cwd: string | null;
  reference: string | null;
  pollIntervalMs?: number;
}) {
  return queryOptions({
    queryKey: [...gitQueryKeys.pullRequest(input.cwd), input.reference] as const,
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd || !input.reference) {
        throw new Error("Pull request lookup is unavailable.");
      }
      return api.git.resolvePullRequest({ cwd: input.cwd, reference: input.reference });
    },
    enabled: input.cwd !== null && input.reference !== null,
    staleTime: 30_000,

    refetchInterval: (query) =>
      input.pollIntervalMs === undefined || query.state.data?.pullRequest.state === "merged"
        ? false
        : input.pollIntervalMs,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

const GIT_PR_SNAPSHOT_STALE_TIME_MS = 30_000;
const GIT_PR_SNAPSHOT_REFETCH_INTERVAL_MS = 60_000;

export function gitPullRequestSnapshotQueryOptions(input: {
  cwd: string | null;
  reference: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: [...gitQueryKeys.pullRequest(input.cwd), "snapshot", input.reference] as const,
    queryFn: async ({ client }) => {
      const readFence = capturePullRequestActionReadFence(client);
      const api = ensureNativeApi();
      if (!input.cwd || !input.reference) {
        throw new Error("Pull request snapshot is unavailable.");
      }
      return preserveActivePullRequestActionGitFields(
        client,
        await api.git.pullRequestSnapshot({ cwd: input.cwd, reference: input.reference }),
        readFence,
      );
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.reference !== null,
    staleTime: GIT_PR_SNAPSHOT_STALE_TIME_MS,
    // Once the snapshot itself reports the PR merged/closed, stop polling it — the cached git status
    // can lag behind and would otherwise keep the interval alive.
    refetchInterval: (query) =>
      query.state.data && query.state.data.pullRequest.state !== "open"
        ? false
        : GIT_PR_SNAPSHOT_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: (query) =>
      !query.state.data || query.state.data.pullRequest.state === "open",
    refetchOnReconnect: true,
    ...GIT_EXPENSIVE_READ_RETRY_OPTIONS,
  });
}

export function gitWorkingTreeDiffStatsQueryOptions(input: {
  cwd: string | null;
  scope?: GitReadWorkingTreeDiffInput["scope"];
  compareRef?: string | null;
  enabled?: boolean;
  refetchInterval?: number | false;
  includeUntrackedFiles?: boolean;
}) {
  const scope = input.scope ?? "workingTree";
  const compareRef = resolveGitCompareRef(scope, input.compareRef);
  const refetchInterval = input.refetchInterval;
  return queryOptions({
    queryKey: gitQueryKeys.workingTreeDiffStats(
      input.cwd,
      scope,
      compareRef,
      input.includeUntrackedFiles,
    ),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Working tree diff stats are unavailable.");
      }
      return api.git.workingTreeDiffStats({
        cwd: input.cwd,
        scope,
        ...(compareRef ? { compareRef } : {}),
        ...(input.includeUntrackedFiles ? { includeUntrackedFiles: true } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && (scope !== "ref" || !!compareRef),
    staleTime: GIT_WORKING_TREE_DIFF_STALE_TIME_MS,
    ...(refetchInterval !== undefined ? { refetchInterval } : {}),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    ...GIT_EXPENSIVE_READ_RETRY_OPTIONS,
  });
}

export function gitWorkingTreeDiffQueryOptions(input: {
  cwd: string | null;
  scope?: GitReadWorkingTreeDiffInput["scope"];
  compareRef?: string | null;
  filePath?: string | null | undefined;
  enabled?: boolean;
  refetchInterval?: number | false;
}) {
  const scope = input.scope ?? "workingTree";
  const compareRef = resolveGitCompareRef(scope, input.compareRef);
  const refetchInterval = input.refetchInterval;
  return queryOptions({
    queryKey: gitQueryKeys.workingTreeDiff(input.cwd, scope, compareRef, input.filePath ?? null),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Working tree diff is unavailable.");
      }
      return api.git.readWorkingTreeDiff({
        cwd: input.cwd,
        scope,
        ...(compareRef ? { compareRef } : {}),
        ...(input.filePath ? { filePath: input.filePath } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && (scope !== "ref" || !!compareRef),
    staleTime: GIT_WORKING_TREE_DIFF_STALE_TIME_MS,
    ...(refetchInterval !== undefined ? { refetchInterval } : {}),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    ...GIT_EXPENSIVE_READ_RETRY_OPTIONS,
  });
}

export function gitSourceControlFilesQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: gitQueryKeys.sourceControlFiles(cwd),
    queryFn: async () => {
      if (!cwd) throw new Error("Source control is unavailable.");
      return ensureNativeApi().git.readSourceControlFiles({ cwd });
    },
    enabled: cwd !== null,
    staleTime: GIT_WORKING_TREE_DIFF_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    ...GIT_EXPENSIVE_READ_RETRY_OPTIONS,
  });
}
