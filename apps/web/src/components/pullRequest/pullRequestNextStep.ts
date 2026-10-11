import type {
  GitPullRequestMergeMethod,
  GitPullRequestReviewResult,
} from "@glade/contracts/git/pullRequestReview";
import { buildConflictPrompt, buildReviewCommentsPrompt } from "./pullRequestPrompts";

export type PullRequestNextStep =
  | { kind: "fix_checks"; label: string; hint: string }
  | { kind: "fix" | "resolve"; label: string; hint: string; prompt: string }
  | { kind: "ready" | "update_branch"; label: string }
  | { kind: "merge"; label: string; methods: readonly GitPullRequestMergeMethod[] }
  | { kind: "wait"; label: string };

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
      hint: "Ask the agent to resolve the merge conflicts",
      prompt: buildConflictPrompt(pr.number, pr.baseBranch),
    };
  }
  if (review.checks.some((check) => check.state === "failure")) {
    return {
      kind: "fix_checks",
      label: "Fix",
      hint: "Ask the agent to fix the failing checks, with their logs",
    };
  }
  if (review.reviewDecision === "changes_requested" && review.comments.length > 0) {
    return {
      kind: "fix",
      label: "Address",
      hint: "Ask the agent to address the requested changes",
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

/** Why GitHub would refuse a merge right now, or null when nothing stands in the way. */
export function resolveMergeBlocker(review: GitPullRequestReviewResult): string | null {
  if (review.mergeState === "conflicting") return "Conflicts with the base branch";
  if (review.checks.some((check) => check.state === "failure")) return "Checks are failing";
  if (review.checks.some((check) => check.state === "pending")) return "Checks are still running";
  if (review.reviewDecision === "changes_requested") return "Changes requested";
  if (review.reviewDecision === "review_required") return "Review required";
  if (review.mergeState === "behind") return "Branch is behind its base";
  if (review.mergeState === "blocked") return "Blocked by branch protection";
  if (review.mergeMethods.length === 0) return "Merging is disabled for this repository";
  if (review.mergeState === "unknown") return "GitHub is still checking mergeability";
  return null;
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
