import type {
  GitPullRequestSnapshotResult,
  GitStatusResult,
  PullRequestDetailInput,
} from "@glade/contracts";
import { parseGitHubRepositoryNameWithOwnerFromPullRequestUrl } from "@glade/shared/githubRepository";
import type { QueryClient, QueryFilters, QueryKey } from "@tanstack/react-query";

import {
  activePullRequestActionPatch,
  hasPullRequestActionReadProtection,
  type PullRequestActionPatch,
  type PullRequestActionReadFence,
} from "./pullRequestMutationCoordinator";

type GitPullRequestCache = GitStatusResult | GitPullRequestSnapshotResult;
type GitPullRequest = NonNullable<GitStatusResult["pr"]>;
type PullRequestIdentity = Pick<PullRequestDetailInput, "repository" | "number">;

export type GitPullRequestActionRollback = {
  queryKey: QueryKey;
  previousFields: PullRequestActionPatch;
};

function cachedPullRequest(data: GitPullRequestCache | undefined): GitPullRequest | null {
  if (!data) return null;
  return ("pullRequest" in data ? data.pullRequest : data.pr) ?? null;
}

function matchesPullRequest(pr: GitPullRequest | null, input: PullRequestIdentity): boolean {
  return (
    pr !== null &&
    pr.number === input.number &&
    parseGitHubRepositoryNameWithOwnerFromPullRequestUrl(pr.url)?.toLowerCase() ===
      input.repository.toLowerCase()
  );
}

function matchesPullRequestReference(reference: unknown, input: PullRequestIdentity): boolean {
  if (typeof reference !== "string") return false;
  const numberMatch = /\/pull\/(\d+)(?:[/?#]|$)/i.exec(reference.trim());
  return (
    Number(numberMatch?.[1]) === input.number &&
    parseGitHubRepositoryNameWithOwnerFromPullRequestUrl(reference)?.toLowerCase() ===
      input.repository.toLowerCase()
  );
}

export function pullRequestGitQueryFilters(
  input: PullRequestIdentity,
  workspaceRoot?: string,
): QueryFilters {
  return {
    queryKey: ["git"],
    predicate: (query) => {
      const key = query.queryKey;

      if (workspaceRoot !== undefined && key[1] === "pull-request" && key[2] === workspaceRoot) {
        return true;
      }
      const isStatus = key[1] === "status";
      const isSnapshot = key[1] === "pull-request" && key[3] === "snapshot";
      if (!isStatus && !isSnapshot) return false;

      return (
        matchesPullRequest(
          cachedPullRequest(query.state.data as GitPullRequestCache | undefined),
          input,
        ) ||
        (isSnapshot && matchesPullRequestReference(key[4], input))
      );
    },
  };
}

function patchCachedPullRequest(
  data: GitPullRequestCache,
  patch: PullRequestActionPatch,
): GitPullRequestCache {
  if ("pullRequest" in data) return { ...data, pullRequest: { ...data.pullRequest, ...patch } };
  return data.pr ? { ...data, pr: { ...data.pr, ...patch } } : data;
}

export function preserveActivePullRequestActionGitFields<T extends GitPullRequestCache>(
  queryClient: QueryClient,
  data: T,
  readFence?: PullRequestActionReadFence,
): T {
  if (!hasPullRequestActionReadProtection(queryClient, readFence)) return data;
  const pr = cachedPullRequest(data);
  const repository = pr ? parseGitHubRepositoryNameWithOwnerFromPullRequestUrl(pr.url) : null;
  if (!pr || !repository) return data;

  const patch = activePullRequestActionPatch(
    queryClient,
    { repository, number: pr.number },
    readFence,
  );
  return Object.keys(patch).length > 0 ? (patchCachedPullRequest(data, patch) as T) : data;
}

export function optimisticallyPatchPullRequestGitCaches(
  queryClient: QueryClient,
  input: PullRequestIdentity,
  patch: PullRequestActionPatch,
): GitPullRequestActionRollback[] {
  if (Object.keys(patch).length === 0) return [];
  const rollback: GitPullRequestActionRollback[] = [];
  for (const [queryKey, data] of queryClient.getQueriesData<GitPullRequestCache>(
    pullRequestGitQueryFilters(input),
  )) {
    const pr = cachedPullRequest(data);
    if (!data || !pr) continue;
    rollback.push({
      queryKey,
      previousFields: {
        ...(patch.state !== undefined ? { state: pr.state } : {}),
        ...(patch.isDraft !== undefined ? { isDraft: pr.isDraft } : {}),
      },
    });
    queryClient.setQueryData(queryKey, patchCachedPullRequest(data, patch));
  }
  return rollback;
}

export function rollbackPullRequestGitCaches(input: {
  queryClient: QueryClient;
  identity: PullRequestIdentity;
  optimisticPatch: PullRequestActionPatch;
  rollback: ReadonlyArray<GitPullRequestActionRollback>;
}) {
  for (const { queryKey, previousFields } of input.rollback) {
    input.queryClient.setQueryData<GitPullRequestCache>(queryKey, (current) => {
      const pr = cachedPullRequest(current);
      if (!current || !pr || !matchesPullRequest(pr, input.identity)) return current;
      return patchCachedPullRequest(current, {
        ...(previousFields.state !== undefined && pr.state === input.optimisticPatch.state
          ? { state: previousFields.state }
          : {}),
        ...(previousFields.isDraft !== undefined && pr.isDraft === input.optimisticPatch.isDraft
          ? { isDraft: previousFields.isDraft }
          : {}),
      });
    });
  }
}
