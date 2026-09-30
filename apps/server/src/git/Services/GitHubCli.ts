import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { GitPullRequestCheck, GitPullRequestComment } from "@glade/contracts/git/git";
import type {
  PullRequestActor,
  PullRequestCheck,
  PullRequestComment,
  PullRequestCommit,
  PullRequestLabel,
  PullRequestMergeCapabilities,
  PullRequestMergeMethod,
  PullRequestStack,
  PullRequestState,
} from "@glade/contracts/git/pullRequests";

import type { ProcessRunResult } from "../../platform/processRunner";
import type { GitHubCliError } from "../Errors.ts";

export const PULL_REQUEST_SUMMARY_JSON_FIELDS =
  "number,title,url,baseRefName,headRefName,state,mergedAt,isDraft,mergeable,additions,deletions,changedFiles,isCrossRepository,headRepository,headRepositoryOwner,updatedAt";

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

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

interface GitHubPullRequestReviewCommentsResult {
  readonly comments: ReadonlyArray<GitPullRequestComment>;
  readonly truncated: boolean;
}

export interface GitHubPullRequestDetailData {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly author: PullRequestActor | null;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly mergeable: string | null;
  readonly mergeability: "mergeable" | "conflicting" | "unknown";
  readonly mergeStateStatus: string | null;
  readonly reviewDecision: string | null;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly maintainerCanModify: boolean;
  readonly reviewers: ReadonlyArray<PullRequestActor>;
  readonly labels: ReadonlyArray<PullRequestLabel>;
  readonly checks: ReadonlyArray<PullRequestCheck>;
  readonly comments: ReadonlyArray<PullRequestComment>;
  readonly commits: ReadonlyArray<PullRequestCommit>;
}

export interface GitHubCliShape {
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
  }) => Effect.Effect<ProcessRunResult, GitHubCliError>;

  readonly getViewerLogin: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string, GitHubCliError>;

  readonly getPullRequestDetail: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly number: number;
  }) => Effect.Effect<GitHubPullRequestDetailData, GitHubCliError>;

  readonly getPullRequestStack: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly number: number;
  }) => Effect.Effect<PullRequestStack | null, GitHubCliError>;

  readonly getRepositoryMergeCapabilities: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<PullRequestMergeCapabilities, GitHubCliError>;

  readonly getPullRequestDiff: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly number: number;
  }) => Effect.Effect<{ readonly patch: string; readonly truncated: boolean }, GitHubCliError>;

  readonly runPullRequestAction: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly number: number;
    readonly action: "merge" | "ready" | "draft" | "close" | "reopen";
    readonly mergeMethod?: PullRequestMergeMethod;
  }) => Effect.Effect<{ readonly mergeOutcome: "merged" | "enqueued" | null }, GitHubCliError>;

  readonly commentOnPullRequest: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly number: number;
    readonly body: string;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  readonly listPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

  readonly getPullRequestWithChecks: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<
    {
      readonly summary: GitHubPullRequestSummary;
      readonly checks: ReadonlyArray<GitPullRequestCheck>;
    },
    GitHubCliError
  >;

  readonly getPullRequestReviewComments: (input: {
    readonly cwd: string;
    readonly host: string;
    readonly owner: string;
    readonly repo: string;
    readonly number: number;
  }) => Effect.Effect<GitHubPullRequestReviewCommentsResult, GitHubCliError>;

  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
    readonly draft?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHubCliError>;

  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;
}

export class GitHubCli extends ServiceMap.Service<GitHubCli, GitHubCliShape>()(
  "glade/git/Services/GitHubCli",
) {}
