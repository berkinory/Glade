import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "../core/baseSchemas";

export const GitPullRequestCheckState = Schema.Literals([
  "pending",
  "success",
  "failure",
  "neutral",
  "skipped",
]);
export type GitPullRequestCheckState = typeof GitPullRequestCheckState.Type;

export const GitPullRequestMergeMethod = Schema.Literals(["squash", "merge", "rebase"]);
export type GitPullRequestMergeMethod = typeof GitPullRequestMergeMethod.Type;

export const GitPullRequestReviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  number: PositiveInt,
});
export type GitPullRequestReviewInput = typeof GitPullRequestReviewInput.Type;

export const GitPullRequestReviewResult = Schema.Struct({
  number: PositiveInt,
  state: Schema.Literals(["open", "closed", "merged"]),
  isDraft: Schema.Boolean,
  checks: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      state: GitPullRequestCheckState,
      url: Schema.NullOr(Schema.String),
    }),
  ),
  reviewDecision: Schema.NullOr(
    Schema.Literals(["approved", "changes_requested", "review_required"]),
  ),
  mergeState: Schema.Literals(["clean", "blocked", "behind", "conflicting", "unstable", "unknown"]),
  // Unresolved review threads and change requests that are still waiting on the author.
  comments: Schema.Array(
    Schema.Struct({
      author: Schema.String,
      body: Schema.String,
      path: Schema.NullOr(Schema.String),
      line: Schema.NullOr(PositiveInt),
      url: Schema.NullOr(Schema.String),
    }),
  ),
  // Methods the repository allows, in the order Glade prefers them.
  mergeMethods: Schema.Array(GitPullRequestMergeMethod),
});
export type GitPullRequestReviewResult = typeof GitPullRequestReviewResult.Type;

export const GitPullRequestActionInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  number: PositiveInt,
  action: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("merge"), method: GitPullRequestMergeMethod }),
    Schema.Struct({ kind: Schema.Literal("ready") }),
    Schema.Struct({ kind: Schema.Literal("update_branch") }),
  ]),
});
export type GitPullRequestActionInput = typeof GitPullRequestActionInput.Type;
