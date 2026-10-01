import type { GitSidebarSummaryResult, GitStatusResult } from "@glade/contracts/git/git";
import type { OrchestrationThreadPullRequest } from "@glade/contracts/orchestration/threadEntities";
import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { resolveThreadWorkspaceCwd } from "@glade/shared/threads/threadEnvironment";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { resolveSidebarThreadPullRequest } from "../components/Sidebar.logic.statusTypes";
import { ensureNativeApi } from "../nativeApi";
import { useVisibleSidebarThreadIds } from "./useVisibleSidebarThreadIds";
import type { SidebarThreadSummary } from "../types";

export type ThreadPullRequest = GitStatusResult["pr"];

export type ThreadPullRequestSource = Pick<
  SidebarThreadSummary,
  "id" | "projectId" | "branch" | "envMode" | "worktreePath" | "lastKnownPr"
>;

const THREAD_PR_STALE_TIME_MS = 30_000;

const THREAD_PR_REFETCH_INTERVAL_MS = 900_000;

// Also accepts persisted `lastKnownPr` entries, whose draft/mergeability/diff fields are optional
// because older rows predate them.
function toThreadPullRequest(
  pr:
    | NonNullable<ThreadPullRequest>
    | {
        number: number;
        title: string;
        url: string;
        baseBranch: string;
        headBranch: string;
        state: "open" | "closed" | "merged";
        isDraft?: boolean | undefined;
        mergeability?: "mergeable" | "conflicting" | "unknown" | undefined;
        additions?: number | null | undefined;
        deletions?: number | null | undefined;
        changedFiles?: number | null | undefined;
      },
): ThreadPullRequest {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseBranch: pr.baseBranch,
    headBranch: pr.headBranch,
    state: pr.state,
    isDraft: pr.isDraft ?? false,
    mergeability: pr.mergeability ?? "unknown",
    additions: pr.additions ?? null,
    deletions: pr.deletions ?? null,
    changedFiles: pr.changedFiles ?? null,
  };
}

// Runs the same persisted-PR validation as the live path, so a stale "open" badge the resolver
// already ruled out cannot reappear here.
export function resolveThreadPullRequestFallback(input: {
  readonly branch: string | null;
  readonly hasDedicatedWorktree: boolean;
  readonly lastKnownPr: OrchestrationThreadPullRequest | null | undefined;
}): ThreadPullRequest {
  return resolveSidebarThreadPullRequest({
    threadBranch: input.branch,
    liveBranch: null,
    hasLiveStatus: false,
    hasDedicatedWorktree: input.hasDedicatedWorktree,
    livePullRequest: null,
    persistedPullRequest: input.lastKnownPr ? toThreadPullRequest(input.lastKnownPr) : null,
  });
}

export function useThreadPullRequests(input: {
  readonly threads: readonly ThreadPullRequestSource[];
  readonly projectCwdById: ReadonlyMap<ProjectId, string>;
  readonly pinnedThreadIds: readonly ThreadId[];
}): ReadonlyMap<ThreadId, ThreadPullRequest> {
  const visibleIds = useVisibleSidebarThreadIds(input.threads.map((thread) => thread.id));
  const activeIds = new Set([...visibleIds, ...input.pinnedThreadIds]);
  const repositories = new Map<string, { cwd: string; worktreeCwds: string[] }>();
  for (const thread of input.threads) {
    if (!activeIds.has(thread.id)) continue;
    const cwd = input.projectCwdById.get(thread.projectId);
    if (!cwd) continue;
    let repository = repositories.get(cwd);
    if (!repository) {
      repository = { cwd, worktreeCwds: [] };
      repositories.set(cwd, repository);
    }
    const worktreeCwd = resolveThreadWorkspaceCwd({
      projectCwd: cwd,
      envMode: thread.envMode,
      worktreePath: thread.worktreePath,
    });
    if (thread.worktreePath && worktreeCwd && !repository.worktreeCwds.includes(worktreeCwd))
      repository.worktreeCwds.push(worktreeCwd);
  }
  const targets = [...repositories.values()].map((repository) => ({
    ...repository,
    worktreeCwds: repository.worktreeCwds.toSorted(),
  }));
  const queries = useQueries({
    queries: targets.map((target) => ({
      queryKey: ["git", "sidebar", target.cwd, target.worktreeCwds],
      queryFn: () => ensureNativeApi().git.sidebarSummary(target),
      staleTime: THREAD_PR_STALE_TIME_MS,
      gcTime: 60_000,
      refetchInterval: THREAD_PR_REFETCH_INTERVAL_MS,
      refetchIntervalInBackground: false,
    })),
  });
  const queryClient = useQueryClient();
  const targetsKey = JSON.stringify(targets);
  useEffect(() => {
    const subscriptions = (JSON.parse(targetsKey) as typeof targets).flatMap((target) =>
      target.worktreeCwds.map((cwd) =>
        ensureNativeApi().git.onStatus({ cwd, summaryOnly: true }, (event) => {
          if (event._tag !== "summaryUpdated") return;
          queryClient.setQueryData<GitSidebarSummaryResult>(
            ["git", "sidebar", target.cwd, target.worktreeCwds],
            (previous) =>
              previous
                ? {
                    ...previous,
                    worktrees: previous.worktrees.map((worktree) =>
                      worktree.cwd === cwd ? { ...worktree, summary: event.summary } : worktree,
                    ),
                  }
                : previous,
          );
        }),
      ),
    );
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [queryClient, targetsKey]);
  const byRepository = new Map(targets.map((target, index) => [target.cwd, queries[index]?.data]));
  const result = new Map<ThreadId, ThreadPullRequest>();
  for (const thread of input.threads) {
    const projectCwd = input.projectCwdById.get(thread.projectId) ?? null;
    const data = projectCwd ? byRepository.get(projectCwd) : undefined;
    const cwd = resolveThreadWorkspaceCwd({
      projectCwd,
      envMode: thread.envMode,
      worktreePath: thread.worktreePath,
    });
    const summary = data?.worktrees.find((worktree) => worktree.cwd === cwd)?.summary;
    const branch = summary?.branch ?? thread.branch;
    const prs = data?.pullRequests;
    const stored = thread.lastKnownPr ? toThreadPullRequest(thread.lastKnownPr) : null;
    const updatedStored = stored ? (prs?.find((pr) => pr.url === stored.url) ?? stored) : null;
    const matchingPrs = prs?.filter(
      (pr) =>
        pr.headBranch === branch &&
        (pr.url === stored?.url ||
          (Boolean(summary?.headRepository) &&
            pr.headRepository?.toLowerCase() === summary?.headRepository?.toLowerCase())),
    );
    const livePr = matchingPrs?.find((pr) => pr.state === "open") ?? matchingPrs?.[0] ?? null;
    result.set(
      thread.id,
      resolveSidebarThreadPullRequest({
        threadBranch: thread.branch,
        liveBranch: summary?.branch ?? null,
        hasLiveStatus: summary !== undefined,
        hasDedicatedWorktree: thread.worktreePath !== null,
        livePullRequest: livePr,
        persistedPullRequest: updatedStored,
      }),
    );
  }
  return result;
}
