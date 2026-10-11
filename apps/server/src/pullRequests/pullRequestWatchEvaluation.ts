import type { GitPullRequestReviewResult } from "@glade/contracts/git/pullRequestReview";
import { Schema } from "effect";

const MAX_SEEN_COMMENTS = 300;
export const MAX_COMMENT_ONLY_WAKES = 10;

export const PullRequestWatchState = Schema.Struct({
  headSha: Schema.NullOr(Schema.String),
  failed: Schema.Array(Schema.String),
  passedFor: Schema.Array(Schema.String),
  seenComments: Schema.Array(Schema.String),
  conflict: Schema.Boolean,
  commentOnlyWakes: Schema.Number,
});
export type PullRequestWatchState = typeof PullRequestWatchState.Type;

type PullRequestWatchComment = GitPullRequestReviewResult["comments"][number];

export interface PullRequestWatchOutcome {
  readonly next: PullRequestWatchState;
  readonly newFailures: ReadonlyArray<string>;
  readonly passed: boolean;
  readonly newComments: ReadonlyArray<PullRequestWatchComment>;
  readonly conflict: boolean;
  readonly stop: "merged" | "closed" | "comment-limit" | null;
}

const PASSING = new Set(["success", "neutral", "skipped"]);

function commentKey(comment: PullRequestWatchComment): string {
  return comment.url ?? `${comment.author}\u0000${comment.path ?? ""}\u0000${comment.body}`;
}

/** The baseline when a watch starts: only what changes afterwards wakes the agent. */
export function initialWatchState(review: GitPullRequestReviewResult): PullRequestWatchState {
  return evaluatePullRequestWatch(
    {
      headSha: review.headSha,
      failed: review.checks.filter((check) => check.state === "failure").map((check) => check.name),
      passedFor: [],
      seenComments: review.comments.map(commentKey),
      conflict: review.mergeState === "conflicting",
      commentOnlyWakes: 0,
    },
    review,
    null,
  ).next;
}

export function evaluatePullRequestWatch(
  previous: PullRequestWatchState,
  review: GitPullRequestReviewResult,
  viewerLogin: string | null,
): PullRequestWatchOutcome {
  if (review.state !== "open") {
    return {
      next: previous,
      newFailures: [],
      passed: false,
      newComments: [],
      conflict: false,
      stop: review.state,
    };
  }
  // A new head is a new attempt: earlier failures and passes no longer describe it.
  const pushed = previous.headSha !== null && previous.headSha !== review.headSha;
  const known = pushed ? [] : previous.failed;
  const failing = review.checks.filter((check) => check.state === "failure").map((c) => c.name);
  // A rerun drops off the failing list, so failing again reports again.
  const newFailures = failing.filter((name) => !known.includes(name));

  const required = review.checks.filter((check) => check.required);
  const relevant = required.length > 0 ? required : review.checks;
  const relevantNames = relevant.map((check) => check.name).toSorted();
  const allPassed = relevant.length > 0 && relevant.every((check) => PASSING.has(check.state));
  const reportedFor = pushed ? [] : previous.passedFor;
  // Fires again when the relevant set grows, catching a required job that appeared already finished.
  const passed = allPassed && relevantNames.some((name) => !reportedFor.includes(name));

  const seen = new Set(previous.seenComments);
  const newComments = review.comments.filter(
    (comment) => !seen.has(commentKey(comment)) && comment.author !== viewerLogin,
  );
  const seenComments = [...previous.seenComments, ...review.comments.map(commentKey)]
    .filter((key, index, all) => all.indexOf(key) === index)
    .slice(-MAX_SEEN_COMMENTS);

  // GitHub reports "unknown" while it recomputes mergeability; that keeps the last known state.
  const conflictNow =
    review.mergeState === "conflicting"
      ? true
      : review.mergeState === "unknown"
        ? previous.conflict
        : false;
  const conflict = conflictNow && (!previous.conflict || pushed);

  const otherNews = newFailures.length > 0 || passed || conflict || pushed;
  const commentOnly = newComments.length > 0 && !otherNews;
  const commentOnlyWakes = commentOnly
    ? previous.commentOnlyWakes + 1
    : otherNews
      ? 0
      : previous.commentOnlyWakes;

  return {
    next: {
      headSha: review.headSha,
      failed: failing,
      passedFor: allPassed ? relevantNames : [],
      seenComments,
      conflict: conflictNow,
      commentOnlyWakes,
    },
    newFailures,
    passed,
    newComments,
    conflict,
    stop: commentOnlyWakes >= MAX_COMMENT_ONLY_WAKES ? "comment-limit" : null,
  };
}

export function hasWatchNews(outcome: PullRequestWatchOutcome): boolean {
  return (
    outcome.newFailures.length > 0 ||
    outcome.passed ||
    outcome.newComments.length > 0 ||
    outcome.conflict
  );
}
