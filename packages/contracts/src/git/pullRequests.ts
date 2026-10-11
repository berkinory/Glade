import { Schema } from "effect";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "../core/baseSchemas";

const PullRequestState = Schema.Literals(["open", "closed", "merged"]);

export const GitPullRequestListState = Schema.Literals(["open", "closed"]);
export type GitPullRequestListState = typeof GitPullRequestListState.Type;

export const GitPullRequestListInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  state: GitPullRequestListState,
});
export type GitPullRequestListInput = typeof GitPullRequestListInput.Type;

export const GitPullRequestListItem = Schema.Struct({
  number: PositiveInt,
  title: Schema.String,
  url: Schema.String,
  author: Schema.String,
  authorAvatarUrl: Schema.NullOr(Schema.String),
  state: PullRequestState,
  isDraft: Schema.Boolean,
  updatedAt: Schema.String,
  headBranch: Schema.String,
  baseBranch: Schema.String,
  checks: Schema.Literals(["success", "failure", "pending", "none"]),
  reviewDecision: Schema.NullOr(
    Schema.Literals(["approved", "changes_requested", "review_required"]),
  ),
  comments: NonNegativeInt,
});
export type GitPullRequestListItem = typeof GitPullRequestListItem.Type;

export const GitPullRequestListResult = Schema.Struct({
  repository: Schema.String,
  // Lets the list split the viewer's own pull requests from everyone else's.
  viewerLogin: Schema.NullOr(Schema.String),
  items: Schema.Array(GitPullRequestListItem),
});
export type GitPullRequestListResult = typeof GitPullRequestListResult.Type;

export const GitPullRequestNumberInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  number: PositiveInt,
});
export type GitPullRequestNumberInput = typeof GitPullRequestNumberInput.Type;

export const GitPullRequestDetail = Schema.Struct({
  number: PositiveInt,
  title: Schema.String,
  url: Schema.String,
  body: Schema.String,
  author: Schema.String,
  authorAvatarUrl: Schema.NullOr(Schema.String),
  state: PullRequestState,
  isDraft: Schema.Boolean,
  createdAt: Schema.String,
  baseBranch: Schema.String,
  headBranch: Schema.String,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  changedFiles: NonNegativeInt,
  commits: NonNegativeInt,
  reviewers: Schema.Array(
    Schema.Struct({
      login: Schema.String,
      avatarUrl: Schema.NullOr(Schema.String),
      state: Schema.Literals(["approved", "changes_requested", "commented", "pending"]),
    }),
  ),
  conversation: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["comment", "review"]),
      author: Schema.String,
      authorAvatarUrl: Schema.NullOr(Schema.String),
      body: Schema.String,
      createdAt: Schema.String,
      url: Schema.NullOr(Schema.String),
      reviewState: Schema.NullOr(Schema.String),
    }),
  ),
});
export type GitPullRequestDetail = typeof GitPullRequestDetail.Type;

export const GitPullRequestDiffResult = Schema.Struct({
  patch: Schema.String,
  truncated: Schema.Boolean,
});
export type GitPullRequestDiffResult = typeof GitPullRequestDiffResult.Type;

export const GitPullRequestCheckLogInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  jobId: PositiveInt,
});
export type GitPullRequestCheckLogInput = typeof GitPullRequestCheckLogInput.Type;

export const GitPullRequestCheckLogResult = Schema.Struct({
  excerpt: Schema.String,
  truncated: Schema.Boolean,
});
export type GitPullRequestCheckLogResult = typeof GitPullRequestCheckLogResult.Type;

export const GitPullRequestRerunInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  runId: PositiveInt,
});
export type GitPullRequestRerunInput = typeof GitPullRequestRerunInput.Type;
