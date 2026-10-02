import {
  GitActionProgressEvent,
  GitBlameLineInput,
  GitReadFileAtRevInput,
  GitReadFileAtRevResult,
  GitBlameLineResult,
  GitHandoffThreadInput,
  GitHandoffThreadResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitResolvedPullRequest,
  GitReadWorkingTreeDiffInput,
  GitReadWorkingTreeDiffResult,
  GitWorkingTreeDiffStatsResult,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitStatusInput,
  GitStatusResult,
  GitSourceControlFilesResult,
  GitSummarizeDiffInput,
  GitGenerateCommitMessageInput,
  GitGenerateCommitMessageResult,
  GitSummarizeDiffResult,
} from "@glade/contracts/git/git";
import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { GitManagerServiceError } from "../Errors.ts";

export interface GitActionProgressReporter {
  readonly publish: (event: GitActionProgressEvent) => Effect.Effect<void, never>;
}

export interface GitRunStackedActionOptions {
  readonly actionId?: string;
  readonly progressReporter?: GitActionProgressReporter;
}

export interface GitManagerShape {
  readonly status: (
    input: GitStatusInput,
  ) => Effect.Effect<GitStatusResult, GitManagerServiceError>;

  readonly pullRequestForBranch: (input: {
    readonly cwd: string;
    readonly branch: string;
    readonly upstreamRef: string | null;
  }) => Effect.Effect<GitResolvedPullRequest | null, GitManagerServiceError>;

  readonly readWorkingTreeDiff: (
    input: GitReadWorkingTreeDiffInput,
  ) => Effect.Effect<GitReadWorkingTreeDiffResult, GitManagerServiceError>;

  readonly readSourceControlFiles: (
    cwd: string,
    query?: string,
  ) => Effect.Effect<GitSourceControlFilesResult, GitManagerServiceError>;

  readonly blameLine: (
    input: GitBlameLineInput,
  ) => Effect.Effect<GitBlameLineResult, GitManagerServiceError>;

  readonly readFileAtRev: (
    input: GitReadFileAtRevInput,
  ) => Effect.Effect<GitReadFileAtRevResult, GitManagerServiceError>;

  readonly readWorkingTreeDiffStats: (
    input: GitReadWorkingTreeDiffInput,
  ) => Effect.Effect<GitWorkingTreeDiffStatsResult, GitManagerServiceError>;

  readonly generateCommitMessage: (
    input: GitGenerateCommitMessageInput,
  ) => Effect.Effect<GitGenerateCommitMessageResult, GitManagerServiceError>;

  readonly summarizeDiff: (
    input: GitSummarizeDiffInput,
  ) => Effect.Effect<GitSummarizeDiffResult, GitManagerServiceError>;

  readonly resolvePullRequest: (
    input: GitPullRequestRefInput,
  ) => Effect.Effect<GitResolvePullRequestResult, GitManagerServiceError>;

  readonly preparePullRequestThread: (
    input: GitPreparePullRequestThreadInput,
  ) => Effect.Effect<GitPreparePullRequestThreadResult, GitManagerServiceError>;

  readonly handoffThread: (
    input: Omit<GitHandoffThreadInput, "commandId" | "threadId">,
  ) => Effect.Effect<GitHandoffThreadResult, GitManagerServiceError>;

  readonly runStackedAction: (
    input: GitRunStackedActionInput,
    options?: GitRunStackedActionOptions,
  ) => Effect.Effect<GitRunStackedActionResult, GitManagerServiceError>;
}

export class GitManager extends ServiceMap.Service<GitManager, GitManagerShape>()(
  "glade/git/Services/GitManager",
) {}
