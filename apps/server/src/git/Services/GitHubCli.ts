import { ServiceMap, type Effect } from "effect";

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

  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  readonly listPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector?: string;
    readonly limit?: number;
    readonly priority?: "foreground" | "background";
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

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
