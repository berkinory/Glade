import type {
  GitPullRequestMergeMethod,
  GitPullRequestReviewResult,
} from "@glade/contracts/git/pullRequestReview";

export type PullRequestNextStep =
  | { kind: "fix" | "resolve"; label: string; prompt: string }
  | { kind: "ready" | "update_branch"; label: string }
  | { kind: "merge"; label: string; methods: readonly GitPullRequestMergeMethod[] }
  | { kind: "wait"; label: string };

export const MERGE_METHOD_LABELS: Record<GitPullRequestMergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};

// Offers the one action that unblocks the PR next, so Merge never appears while anything still
// stands in its way.
export function resolvePullRequestNextStep(
  pr: { readonly number: number; readonly baseBranch: string },
  review: GitPullRequestReviewResult,
): PullRequestNextStep | null {
  if (review.state !== "open") return null;
  if (review.mergeState === "conflicting") {
    return {
      kind: "resolve",
      label: "Resolve",
      prompt: `Pull request #${pr.number} has merge conflicts with ${pr.baseBranch}. Rebase this branch onto the latest ${pr.baseBranch}, resolve the conflicts, run the relevant checks, and push.`,
    };
  }
  const failing = review.checks.filter((check) => check.state === "failure");
  if (failing.length > 0) {
    const list = failing
      .map((check) => `- ${check.name}${check.url ? ` (${check.url})` : ""}`)
      .join("\n");
    return {
      kind: "fix",
      label: "Fix",
      prompt: `These checks are failing on pull request #${pr.number}:\n${list}\n\nInvestigate the failures, fix them, and push the fix.`,
    };
  }
  if (review.reviewDecision === "changes_requested" && review.comments.length > 0) {
    return {
      kind: "fix",
      label: "Address",
      prompt: buildReviewCommentsPrompt(pr.number, review.comments),
    };
  }
  if (review.isDraft) return { kind: "ready", label: "Ready" };
  if (review.checks.some((check) => check.state === "pending")) {
    return { kind: "wait", label: "Checks running" };
  }
  if (review.reviewDecision === "changes_requested") {
    return { kind: "wait", label: "Changes requested" };
  }
  if (review.reviewDecision === "review_required")
    return { kind: "wait", label: "Review required" };
  if (review.mergeState === "behind") return { kind: "update_branch", label: "Update" };
  if (review.mergeState === "blocked") return { kind: "wait", label: "Blocked" };
  if (
    (review.mergeState === "clean" || review.mergeState === "unstable") &&
    review.mergeMethods.length > 0
  ) {
    return { kind: "merge", label: "Merge", methods: review.mergeMethods };
  }
  return null;
}

export function buildReviewCommentsPrompt(
  number: number,
  comments: GitPullRequestReviewResult["comments"],
): string {
  const list = comments
    .map((comment) => {
      const location = comment.path
        ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ""}`
        : "";
      return `- ${comment.author}${location}: ${comment.body}`;
    })
    .join("\n");
  return `Address this review feedback on pull request #${number}:\n${list}\n\nMake the changes, run the relevant checks, and push.`;
}

export function summarizePullRequestChecks(checks: GitPullRequestReviewResult["checks"]): {
  label: string;
  tone: "success" | "failure" | "pending" | "neutral";
} | null {
  if (checks.length === 0) return null;
  const failing = checks.filter((check) => check.state === "failure").length;
  const pending = checks.filter((check) => check.state === "pending").length;
  const passed = checks.filter((check) => check.state === "success").length;
  if (failing > 0) return { label: `${failing} failing`, tone: "failure" };
  if (pending > 0) return { label: `${pending} running`, tone: "pending" };
  return { label: `${passed}/${checks.length} passed`, tone: passed > 0 ? "success" : "neutral" };
}
