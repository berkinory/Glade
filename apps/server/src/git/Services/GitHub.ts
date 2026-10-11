import type {
  GitPullRequestMergeMethod,
  GitPullRequestReviewResult,
} from "@glade/contracts/git/pullRequestReview";
import type {
  GitPullRequestCheckLogInput,
  GitPullRequestCheckLogResult,
  GitPullRequestDetail,
  GitPullRequestDiffResult,
  GitPullRequestListInput,
  GitPullRequestListResult,
  GitPullRequestNumberInput,
  GitPullRequestRerunInput,
} from "@glade/contracts/git/pullRequests";
import { ServiceMap, type Effect } from "effect";

import type { ProcessRunResult } from "../../platform/processRunner";
import type { GitHubError } from "../Errors.ts";

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly isDraft?: boolean;
  readonly mergeability?: "mergeable" | "conflicting" | "unknown";
  readonly additions?: number | null;
  readonly deletions?: number | null;
  readonly changedFiles?: number | null;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;

  readonly updatedAt?: string | null;
}

interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

export interface GitHubAccount {
  readonly login: string;
  readonly avatarUrl: string | null;
}

export interface GitHubShape {
  readonly execute: (input: {
    readonly priority?: "foreground" | "background";
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
    readonly maxBufferBytes?: number;
    readonly outputMode?: "error" | "truncate";
    readonly allowNonZeroExit?: boolean;
    // Piped to the child's stdin — for payloads that must never appear in argv.
    readonly stdin?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly onStdoutChunk?: (chunk: string) => void;
    readonly onStderrChunk?: (chunk: string) => void;
  }) => Effect.Effect<ProcessRunResult, GitHubError>;

  readonly getViewer: () => Effect.Effect<GitHubAccount, GitHubError>;

  readonly listViewerOrganizations: () => Effect.Effect<ReadonlyArray<GitHubAccount>, GitHubError>;

  /** Maps commit author emails to GitHub avatars; emails without a GitHub account are left out. */
  readonly resolveCommitAuthorAvatars: (input: {
    readonly cwd: string;
    readonly commits: ReadonlyArray<{ readonly sha: string; readonly email: string }>;
  }) => Effect.Effect<Readonly<Record<string, string>>, GitHubError>;

  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubError>;

  readonly listPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector?: string;
    readonly limit?: number;
    readonly priority?: "foreground" | "background";
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubError>;

  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubError>;

  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubError>;

  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
    readonly draft?: boolean;
  }) => Effect.Effect<void, GitHubError>;

  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHubError>;

  readonly getPullRequestReview: (input: {
    readonly cwd: string;
    readonly number: number;
    readonly priority?: "foreground" | "background";
  }) => Effect.Effect<GitPullRequestReviewResult, GitHubError>;

  readonly mergePullRequest: (input: {
    readonly cwd: string;
    readonly number: number;
    readonly method: GitPullRequestMergeMethod;
  }) => Effect.Effect<void, GitHubError>;

  readonly markPullRequestReady: (input: {
    readonly cwd: string;
    readonly number: number;
  }) => Effect.Effect<void, GitHubError>;

  readonly updatePullRequestBranch: (input: {
    readonly cwd: string;
    readonly number: number;
  }) => Effect.Effect<void, GitHubError>;

  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHubError>;

  readonly listRepositoryPullRequests: (
    input: GitPullRequestListInput,
  ) => Effect.Effect<GitPullRequestListResult, GitHubError>;

  readonly getPullRequestDetail: (
    input: GitPullRequestNumberInput,
  ) => Effect.Effect<GitPullRequestDetail, GitHubError>;

  readonly getPullRequestDiff: (
    input: GitPullRequestNumberInput,
  ) => Effect.Effect<GitPullRequestDiffResult, GitHubError>;

  readonly getCheckLog: (
    input: GitPullRequestCheckLogInput,
  ) => Effect.Effect<GitPullRequestCheckLogResult, GitHubError>;

  readonly rerunFailedJobs: (input: GitPullRequestRerunInput) => Effect.Effect<void, GitHubError>;
}

export class GitHub extends ServiceMap.Service<GitHub, GitHubShape>()(
  "glade/git/Services/GitHub",
) {}
