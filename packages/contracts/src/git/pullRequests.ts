import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "../core/baseSchemas";
import { GitPullRequestMergeability } from "./git";

export const PullRequestState = Schema.Literals(["open", "closed", "merged"]);
export type PullRequestState = typeof PullRequestState.Type;

export const PullRequestMergeMethod = Schema.Literals(["merge", "squash", "rebase"]);
export type PullRequestMergeMethod = typeof PullRequestMergeMethod.Type;

export const PullRequestAction = Schema.Literals(["merge", "ready", "draft", "close", "reopen"]);
export type PullRequestAction = typeof PullRequestAction.Type;

export const PullRequestActor = Schema.Struct({
  login: TrimmedNonEmptyString,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
});
export type PullRequestActor = typeof PullRequestActor.Type;

export const PullRequestCommitAuthor = Schema.Struct({
  login: Schema.NullOr(TrimmedNonEmptyString),
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
});
export type PullRequestCommitAuthor = typeof PullRequestCommitAuthor.Type;

export const PullRequestLabel = Schema.Struct({
  name: TrimmedNonEmptyString,
  color: Schema.NullOr(Schema.String),
});
export type PullRequestLabel = typeof PullRequestLabel.Type;

export const PullRequestCheckStatus = Schema.Literals([
  "pending",
  "success",
  "failure",
  "skipped",
  "neutral",
  "cancelled",
]);
export type PullRequestCheckStatus = typeof PullRequestCheckStatus.Type;

export const PullRequestCheck = Schema.Struct({
  name: TrimmedNonEmptyString,
  status: PullRequestCheckStatus,
  description: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type PullRequestCheck = typeof PullRequestCheck.Type;

export const PullRequestCommentKind = Schema.Literals([
  "issue-comment",
  "review-comment",
  "review",
]);
export type PullRequestCommentKind = typeof PullRequestCommentKind.Type;

export const PullRequestComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: PullRequestCommentKind,
  author: Schema.NullOr(PullRequestActor),
  body: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: Schema.NullOr(IsoDateTime),
  url: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  reviewState: Schema.NullOr(Schema.String),
});
export type PullRequestComment = typeof PullRequestComment.Type;

export const PullRequestCommit = Schema.Struct({
  oid: TrimmedNonEmptyString,
  messageHeadline: Schema.String,
  messageBody: Schema.String,
  committedDate: IsoDateTime,
  authors: Schema.Array(PullRequestCommitAuthor),
});
export type PullRequestCommit = typeof PullRequestCommit.Type;

export const PullRequestMergeCapabilities = Schema.Struct({
  merge: Schema.Boolean,
  squash: Schema.Boolean,
  rebase: Schema.Boolean,
  deleteBranchOnMerge: Schema.Boolean,
});
export type PullRequestMergeCapabilities = typeof PullRequestMergeCapabilities.Type;

export const PullRequestStackEntry = Schema.Struct({
  position: PositiveInt,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  headBranch: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  state: PullRequestState,
  isDraft: Schema.Boolean,
  mergeability: GitPullRequestMergeability,
  mergeStateStatus: Schema.NullOr(Schema.String),
});
export type PullRequestStackEntry = typeof PullRequestStackEntry.Type;

export const PullRequestStack = Schema.Struct({
  number: PositiveInt,
  size: PositiveInt,
  position: PositiveInt,
  baseBranch: TrimmedNonEmptyString,
  entries: Schema.Array(PullRequestStackEntry),
});
export type PullRequestStack = typeof PullRequestStack.Type;

export const PullRequestDetailInput = Schema.Struct({
  projectId: ProjectId,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
});
export type PullRequestDetailInput = typeof PullRequestDetailInput.Type;

export const PullRequestDetail = Schema.Struct({
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  body: Schema.String,
  url: TrimmedNonEmptyString,
  author: Schema.NullOr(PullRequestActor),
  state: PullRequestState,
  isDraft: Schema.Boolean,
  mergeable: Schema.NullOr(Schema.String),
  // Decoding default keeps a newer client compatible with an older server that predates the field
  // (brief version skew during dev restarts must not reject whole payloads).
  mergeability: Schema.optional(GitPullRequestMergeability).pipe(
    Schema.withDecodingDefault(() => "unknown"),
  ),
  mergeStateStatus: Schema.NullOr(Schema.String),
  reviewDecision: Schema.NullOr(Schema.String),
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  changedFiles: NonNegativeInt,
  headBranch: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  mergedAt: Schema.NullOr(IsoDateTime),
  closedAt: Schema.NullOr(IsoDateTime),
  maintainerCanModify: Schema.Boolean,
  reviewers: Schema.Array(PullRequestActor),
  labels: Schema.Array(PullRequestLabel),
  checks: Schema.Array(PullRequestCheck),
  comments: Schema.Array(PullRequestComment),
  commentsTruncated: Schema.Boolean,
  commentsIncomplete: Schema.Boolean,
  commits: Schema.Array(PullRequestCommit),
  mergeCapabilities: PullRequestMergeCapabilities,

  stack: Schema.optional(Schema.NullOr(PullRequestStack)).pipe(
    Schema.withDecodingDefault(() => null),
  ),

  stackMetadataIncomplete: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
});
export type PullRequestDetail = typeof PullRequestDetail.Type;

export const PullRequestDiffResult = Schema.Struct({
  patch: Schema.String,
  truncated: Schema.Boolean,
});
export type PullRequestDiffResult = typeof PullRequestDiffResult.Type;

export const PullRequestActionInput = Schema.Struct({
  projectId: ProjectId,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  action: PullRequestAction,
  mergeMethod: Schema.optional(PullRequestMergeMethod),
});
export type PullRequestActionInput = typeof PullRequestActionInput.Type;

export const PullRequestCommentInput = Schema.Struct({
  projectId: ProjectId,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,

  body: TrimmedNonEmptyString.check(Schema.isMaxLength(65536)),
});
export type PullRequestCommentInput = typeof PullRequestCommentInput.Type;

export const PullRequestActionResult = Schema.Struct({
  projectId: ProjectId,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  workspaceRoot: TrimmedNonEmptyString,

  mergeOutcome: Schema.optional(Schema.NullOr(Schema.Literals(["merged", "enqueued"]))).pipe(
    Schema.withDecodingDefault(() => null),
  ),
});
export type PullRequestActionResult = typeof PullRequestActionResult.Type;

export class PullRequestsUnavailableError extends Schema.TaggedErrorClass<PullRequestsUnavailableError>()(
  "PullRequestsUnavailableError",
  {
    reason: Schema.Literals(["gh-not-installed", "gh-not-authenticated"]),
    message: TrimmedNonEmptyString,
  },
) {}
