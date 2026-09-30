import type { GitResolvedPullRequest } from "@glade/contracts/git/git";

export function toResolvedPullRequest(pr: {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  state?: "open" | "closed" | "merged";
  isDraft?: boolean;
  mergeability?: "mergeable" | "conflicting" | "unknown";
  additions?: number | null;
  deletions?: number | null;
  changedFiles?: number | null;
}): GitResolvedPullRequest {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    state: pr.state ?? "open",
    isDraft: pr.isDraft ?? false,
    mergeability: pr.mergeability ?? "unknown",
    additions: pr.additions ?? null,
    deletions: pr.deletions ?? null,
    changedFiles: pr.changedFiles ?? null,
  };
}
