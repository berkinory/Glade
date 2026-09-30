import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";
import type {
  GitBlameLineInput,
  GitReadFileAtRevInput,
  GitReadFileAtRevResult,
  GitBlameLineResult,
  GitCheckoutInput,
  GitCreateBranchInput,
  GitCreateDetachedWorktreeInput,
  GitWorktreeSetupPhase,
  GitCreateDetachedWorktreeResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitListRecentCommitsInput,
  GitListRecentCommitsResult,
  GitReadCommitInput,
  GitReadCommitResult,
  GitPullResult,
  GitRemoveIndexLockInput,
  GitRemoveWorktreeInput,
  GitStashAndCheckoutInput,
  GitStashDropInput,
  GitStashInfoInput,
  GitStashInfoResult,
  GitStatusInput,
  GitStatusResult,
  GitSourceControlFilesResult,
  GitWorkingTreeDiffStatsResult,
} from "@glade/contracts/git/git";

import type { GitCheckoutDirtyWorktreeError, GitCommandError } from "../Errors.ts";

export interface ExecuteGitInput {
  readonly priority?: "foreground" | "background";
  readonly operation: string;
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowNonZeroExit?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly outputMode?: "error" | "truncate";
  readonly progress?: ExecuteGitProgress;
}

export interface ExecuteGitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;
}

export interface GitStatusDetails extends Omit<GitStatusResult, "pr"> {
  isRepo: boolean;
  hasOriginRemote: boolean;
  isDefaultBranch: boolean;
  upstreamRef: string | null;
}

interface GitBranchContext {
  readonly isRepo: boolean;
  readonly branch: string | null;
  readonly upstreamRef: string | null;
}

type GitDiffScope = "branch" | "staged" | "unstaged" | "workingTree" | "ref";

interface GitPreparedCommitContext {
  stagedSummary: string;
  stagedPatch: string;
}

export interface ExecuteGitProgress {
  readonly stdoutLineDelimiter?: "\n" | "\0";
  readonly onStdoutLine?: (line: string) => Effect.Effect<void, never>;
  readonly onStderrLine?: (line: string) => Effect.Effect<void, never>;
  readonly onHookStarted?: (hookName: string) => Effect.Effect<void, never>;
  readonly onHookFinished?: (input: {
    hookName: string;
    exitCode: number | null;
    durationMs: number | null;
  }) => Effect.Effect<void, never>;
}

interface GitCommitProgress {
  readonly onOutputLine?: (input: {
    stream: "stdout" | "stderr";
    text: string;
  }) => Effect.Effect<void, never>;
  readonly onHookStarted?: (hookName: string) => Effect.Effect<void, never>;
  readonly onHookFinished?: (input: {
    hookName: string;
    exitCode: number | null;
    durationMs: number | null;
  }) => Effect.Effect<void, never>;
}

export interface GitCommitOptions {
  readonly timeoutMs?: number;
  readonly progress?: GitCommitProgress;
}

interface GitPushResult {
  status: "pushed" | "skipped_up_to_date";
  branch: string;
  upstreamBranch?: string | undefined;
  setUpstream?: boolean | undefined;
}

interface GitRangeContext {
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
}

export interface GitWorkingTreePatch {
  patch: string;
  truncated: boolean;
}

interface GitRenameBranchInput {
  cwd: string;
  oldBranch: string;
  newBranch: string;
}

interface GitRenameBranchResult {
  branch: string;
}

interface GitDeleteBranchInput {
  cwd: string;
  branch: string;
  force?: boolean | undefined;
}

interface GitWorktreeOwnershipProof {
  readonly token: string;
  readonly gitDir: string;
  readonly branch: string | null;
  readonly head: string;

  readonly stateHash?: string;
}

interface GitVerifyWorktreeOwnershipResult {
  readonly verified: boolean;
  readonly reason: string | null;
}

interface GitSnapshotWorktreeInput {
  readonly cwd: string;
  readonly outputPath: string;
}

interface GitFetchPullRequestBranchInput {
  cwd: string;
  prNumber: number;
  branch: string;
}

interface GitFetchPullRequestCommitInput {
  cwd: string;
  prNumber: number;

  expectedRepositoryNameWithOwner?: string;
}

interface GitEnsureRemoteInput {
  cwd: string;
  preferredName: string;
  url: string;
}

interface GitFetchRemoteBranchInput {
  cwd: string;
  remoteName: string;
  remoteBranch: string;
  localBranch: string;
}

interface GitSetBranchUpstreamInput {
  cwd: string;
  branch: string;
  remoteName: string;
  remoteBranch: string;
}

interface GitPublishBranchInput {
  cwd: string;
  branch: string;
}

export interface GitCoreShape {
  readonly withMutation: <A, E, R>(
    cwd: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | GitCommandError, R>;

  readonly execute: (input: ExecuteGitInput) => Effect.Effect<ExecuteGitResult, GitCommandError>;

  readonly status: (input: GitStatusInput) => Effect.Effect<GitStatusResult, GitCommandError>;

  readonly statusDetails: (cwd: string) => Effect.Effect<GitStatusDetails, GitCommandError>;

  readonly readBranchContext: (cwd: string) => Effect.Effect<GitBranchContext, GitCommandError>;

  readonly readWorkingTreePatch: (
    cwd: string,
    filePath?: string,
  ) => Effect.Effect<GitWorkingTreePatch, GitCommandError>;

  readonly readUnstagedPatch: (
    cwd: string,
    filePath?: string,
  ) => Effect.Effect<GitWorkingTreePatch, GitCommandError>;

  readonly readStagedPatch: (
    cwd: string,
    filePath?: string,
  ) => Effect.Effect<GitWorkingTreePatch, GitCommandError>;

  readonly readSourceControlFiles: (
    cwd: string,
  ) => Effect.Effect<GitSourceControlFilesResult, GitCommandError>;

  readonly readBranchPatch: (cwd: string) => Effect.Effect<GitWorkingTreePatch, GitCommandError>;

  readonly blameLine: (
    input: GitBlameLineInput,
  ) => Effect.Effect<GitBlameLineResult, GitCommandError>;

  readonly readFileAtRev: (
    input: GitReadFileAtRevInput,
  ) => Effect.Effect<GitReadFileAtRevResult, GitCommandError>;

  readonly readRefPatch: (
    cwd: string,
    ref: string,
  ) => Effect.Effect<GitWorkingTreePatch, GitCommandError>;

  readonly readDiffStats: (
    cwd: string,
    scope: GitDiffScope,
    ref?: string,
    includeUntrackedFiles?: boolean,
  ) => Effect.Effect<GitWorkingTreeDiffStatsResult, GitCommandError>;

  readonly prepareCommitContext: (
    cwd: string,
    filePaths?: readonly string[],
  ) => Effect.Effect<GitPreparedCommitContext | null, GitCommandError>;

  readonly commit: (
    cwd: string,
    subject: string,
    body: string,
    options?: GitCommitOptions,
  ) => Effect.Effect<{ commitSha: string }, GitCommandError>;

  readonly pushCurrentBranch: (
    cwd: string,
    fallbackBranch: string | null,
  ) => Effect.Effect<GitPushResult, GitCommandError>;

  readonly readRangeContext: (
    cwd: string,
    baseBranch: string,
  ) => Effect.Effect<GitRangeContext, GitCommandError>;

  readonly readConfigValue: (
    cwd: string,
    key: string,
  ) => Effect.Effect<string | null, GitCommandError>;

  readonly listBranches: (
    input: GitListBranchesInput,
  ) => Effect.Effect<GitListBranchesResult, GitCommandError>;

  readonly listRecentCommits: (
    input: GitListRecentCommitsInput,
  ) => Effect.Effect<GitListRecentCommitsResult, GitCommandError>;

  readonly readCommit: (
    input: GitReadCommitInput,
  ) => Effect.Effect<GitReadCommitResult, GitCommandError>;

  readonly pullCurrentBranch: (cwd: string) => Effect.Effect<GitPullResult, GitCommandError>;

  readonly createWorktree: (
    input: GitCreateWorktreeInput,
  ) => Effect.Effect<GitCreateWorktreeResult, GitCommandError>;

  readonly recordWorktreeOwnership: (input: {
    readonly path: string;
    readonly branch: string | null;
    readonly token: string;
  }) => Effect.Effect<GitWorktreeOwnershipProof, GitCommandError>;

  readonly verifyWorktreeOwnership: (input: {
    readonly path: string;
    readonly proof: GitWorktreeOwnershipProof;
  }) => Effect.Effect<GitVerifyWorktreeOwnershipResult, GitCommandError>;

  readonly snapshotWorktree: (
    input: GitSnapshotWorktreeInput,
  ) => Effect.Effect<void, GitCommandError>;

  readonly createDetachedWorktree: (
    input: GitCreateDetachedWorktreeInput,
    options?: {
      readonly onPhase?: (phase: GitWorktreeSetupPhase) => Effect.Effect<void>;
    },
  ) => Effect.Effect<GitCreateDetachedWorktreeResult, GitCommandError>;

  readonly fetchPullRequestBranch: (
    input: GitFetchPullRequestBranchInput,
  ) => Effect.Effect<void, GitCommandError>;

  readonly fetchPullRequestCommit: (
    input: GitFetchPullRequestCommitInput,
  ) => Effect.Effect<string, GitCommandError>;

  readonly ensureRemote: (input: GitEnsureRemoteInput) => Effect.Effect<string, GitCommandError>;

  readonly fetchRemoteBranch: (
    input: GitFetchRemoteBranchInput,
  ) => Effect.Effect<void, GitCommandError>;

  readonly setBranchUpstream: (
    input: GitSetBranchUpstreamInput,
  ) => Effect.Effect<void, GitCommandError>;

  readonly removeWorktree: (input: GitRemoveWorktreeInput) => Effect.Effect<void, GitCommandError>;

  readonly deleteBranch: (input: GitDeleteBranchInput) => Effect.Effect<void, GitCommandError>;

  readonly deleteBranchIfUnchanged: (input: {
    readonly cwd: string;
    readonly branch: string;
    readonly expectedHead: string;
  }) => Effect.Effect<void, GitCommandError>;

  readonly renameBranch: (
    input: GitRenameBranchInput,
  ) => Effect.Effect<GitRenameBranchResult, GitCommandError>;

  readonly createBranch: (input: GitCreateBranchInput) => Effect.Effect<void, GitCommandError>;

  readonly publishBranch: (input: GitPublishBranchInput) => Effect.Effect<void, GitCommandError>;

  readonly checkoutBranch: (
    input: GitCheckoutInput,
  ) => Effect.Effect<void, GitCommandError | GitCheckoutDirtyWorktreeError, Scope.Scope>;

  readonly stashAndCheckout: (
    input: GitStashAndCheckoutInput,
  ) => Effect.Effect<void, GitCommandError | GitCheckoutDirtyWorktreeError, Scope.Scope>;

  readonly stashDrop: (input: GitStashDropInput) => Effect.Effect<void, GitCommandError>;

  readonly stashInfo: (
    input: GitStashInfoInput,
  ) => Effect.Effect<GitStashInfoResult, GitCommandError>;

  readonly removeIndexLock: (
    input: GitRemoveIndexLockInput,
  ) => Effect.Effect<void, GitCommandError>;

  readonly initRepo: (input: GitInitInput) => Effect.Effect<void, GitCommandError>;

  readonly listLocalBranchNames: (cwd: string) => Effect.Effect<string[], GitCommandError>;

  readonly stageFiles: (
    cwd: string,
    paths: readonly string[],
  ) => Effect.Effect<void, GitCommandError>;
  readonly revertUnstagedFile: (cwd: string, path: string) => Effect.Effect<void, GitCommandError>;

  readonly unstageFiles: (
    cwd: string,
    paths: readonly string[],
  ) => Effect.Effect<void, GitCommandError>;
}

export class GitCore extends ServiceMap.Service<GitCore, GitCoreShape>()(
  "glade/git/Services/GitCore",
) {}
