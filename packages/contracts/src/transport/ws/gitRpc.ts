import {
  GitPublishContextInput,
  GitPublishContextResult,
  GitPublishRepositoryInput,
  GitPublishRepositoryResult,
} from "../../git/githubRepositoryPublishing";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { WS_METHODS } from "./ws";
import {
  GitStatusInput,
  GitStatusWatchInput,
  GitStatusStreamEvent,
  GitSidebarSummaryInput,
  GitSidebarSummaryResult,
  GitStatusResult,
  GitHubRepositoryInput,
  GitHubRepositoryResult,
  GitReadWorkingTreeDiffInput,
  GitReadWorkingTreeDiffResult,
  GitSourceControlFilesResult,
  GitReadSourceControlFilesInput,
  GitBlameLineInput,
  GitBlameLineResult,
  GitReadFileAtRevInput,
  GitReadFileAtRevResult,
  GitWorkingTreeDiffStatsResult,
  GitGenerateCommitMessageInput,
  GitGenerateCommitMessageResult,
  GitSummarizeDiffInput,
  GitSummarizeDiffResult,
  GitPullInput,
  GitPullResult,
  GitRunStackedActionInput,
  GitActionProgressEvent,
  GitPullRequestRefInput,
  GitResolvePullRequestResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitListBranchesInput,
  GitListBranchesResult,
  GitListRecentCommitsInput,
  GitListRecentCommitsResult,
  GitReadCommitInput,
  GitReadCommitResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitCreateDetachedWorktreeInput,
  GitWorktreeSetupProgressEvent,
  GitRemoveWorktreeInput,
  GitCreateBranchInput,
  GitCheckoutInput,
  GitStashAndCheckoutInput,
  GitStashDropInput,
  GitStashInfoInput,
  GitStashInfoResult,
  GitRemoveIndexLockInput,
  GitInitInput,
  GitStageFilesInput,
  GitStageFilesResult,
  GitCommitStagedInput,
  GitFetchInput,
  GitIgnorePathsInput,
  GitRebaseInput,
  GitUndoCommitInput,
  GitUndoCommitResult,
  GitRebaseStateInput,
  GitRebaseStateResult,
  GitRevertUnstagedFileInput,
  GitRevertUnstagedFileResult,
  GitUnstageFilesInput,
  GitUnstageFilesResult,
  GitHandoffThreadInput,
  GitHandoffThreadResult,
} from "../../git/git";
import { Schema } from "effect";
import { WsRpcError } from "./rpcErrors";

export const WsGitStatusRpc = Rpc.make(WS_METHODS.gitStatus, {
  payload: GitStatusInput,
  success: GitStatusResult,
  error: WsRpcError,
});

export const WsGitSidebarSummaryRpc = Rpc.make(WS_METHODS.gitSidebarSummary, {
  payload: GitSidebarSummaryInput,
  success: GitSidebarSummaryResult,
  error: WsRpcError,
});
export const WsGitSubscribeStatusRpc = Rpc.make(WS_METHODS.gitSubscribeStatus, {
  payload: GitStatusWatchInput,
  success: GitStatusStreamEvent,
  error: WsRpcError,
  stream: true,
});

export const WsGitGithubRepositoryRpc = Rpc.make(WS_METHODS.gitGithubRepository, {
  payload: GitHubRepositoryInput,
  success: GitHubRepositoryResult,
  error: WsRpcError,
});

export const WsGitReadWorkingTreeDiffRpc = Rpc.make(WS_METHODS.gitReadWorkingTreeDiff, {
  payload: GitReadWorkingTreeDiffInput,
  success: GitReadWorkingTreeDiffResult,
  error: WsRpcError,
});

export const WsGitReadSourceControlFilesRpc = Rpc.make(WS_METHODS.gitReadSourceControlFiles, {
  payload: GitReadSourceControlFilesInput,
  success: GitSourceControlFilesResult,
  error: WsRpcError,
});

export const WsGitBlameLineRpc = Rpc.make(WS_METHODS.gitBlameLine, {
  payload: GitBlameLineInput,
  success: GitBlameLineResult,
  error: WsRpcError,
});

export const WsGitReadFileAtRevRpc = Rpc.make(WS_METHODS.gitReadFileAtRev, {
  payload: GitReadFileAtRevInput,
  success: GitReadFileAtRevResult,
  error: WsRpcError,
});

export const WsGitWorkingTreeDiffStatsRpc = Rpc.make(WS_METHODS.gitWorkingTreeDiffStats, {
  payload: GitReadWorkingTreeDiffInput,
  success: GitWorkingTreeDiffStatsResult,
  error: WsRpcError,
});

export const WsGitGenerateCommitMessageRpc = Rpc.make(WS_METHODS.gitGenerateCommitMessage, {
  payload: GitGenerateCommitMessageInput,
  success: GitGenerateCommitMessageResult,
  error: WsRpcError,
});

export const WsGitSummarizeDiffRpc = Rpc.make(WS_METHODS.gitSummarizeDiff, {
  payload: GitSummarizeDiffInput,
  success: GitSummarizeDiffResult,
  error: WsRpcError,
});

export const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, {
  payload: GitPullInput,
  success: GitPullResult,
  error: WsRpcError,
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: WsRpcError,
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: WsRpcError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: WsRpcError,
});

export const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, {
  payload: GitListBranchesInput,
  success: GitListBranchesResult,
  error: WsRpcError,
});

export const WsGitListRecentCommitsRpc = Rpc.make(WS_METHODS.gitListRecentCommits, {
  payload: GitListRecentCommitsInput,
  success: GitListRecentCommitsResult,
  error: WsRpcError,
});

export const WsGitReadCommitRpc = Rpc.make(WS_METHODS.gitReadCommit, {
  payload: GitReadCommitInput,
  success: GitReadCommitResult,
  error: WsRpcError,
});

export const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, {
  payload: GitCreateWorktreeInput,
  success: GitCreateWorktreeResult,
  error: WsRpcError,
});

export const WsGitCreateDetachedWorktreeRpc = Rpc.make(WS_METHODS.gitCreateDetachedWorktree, {
  payload: GitCreateDetachedWorktreeInput,
  success: GitWorktreeSetupProgressEvent,
  error: WsRpcError,
  stream: true,
});

export const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, {
  payload: GitRemoveWorktreeInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, {
  payload: GitCreateBranchInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, {
  payload: GitCheckoutInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStashAndCheckoutRpc = Rpc.make(WS_METHODS.gitStashAndCheckout, {
  payload: GitStashAndCheckoutInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStashDropRpc = Rpc.make(WS_METHODS.gitStashDrop, {
  payload: GitStashDropInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStashInfoRpc = Rpc.make(WS_METHODS.gitStashInfo, {
  payload: GitStashInfoInput,
  success: GitStashInfoResult,
  error: WsRpcError,
});

export const WsGitRemoveIndexLockRpc = Rpc.make(WS_METHODS.gitRemoveIndexLock, {
  payload: GitRemoveIndexLockInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitPublishContextRpc = Rpc.make(WS_METHODS.gitPublishContext, {
  payload: GitPublishContextInput,
  success: GitPublishContextResult,
  error: WsRpcError,
});

export const WsGitPublishRepositoryRpc = Rpc.make(WS_METHODS.gitPublishRepository, {
  payload: GitPublishRepositoryInput,
  success: GitPublishRepositoryResult,
  error: WsRpcError,
});

export const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, {
  payload: GitInitInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStageFilesRpc = Rpc.make(WS_METHODS.gitStageFiles, {
  payload: GitStageFilesInput,
  success: GitStageFilesResult,
  error: WsRpcError,
});

export const WsGitCommitStagedRpc = Rpc.make(WS_METHODS.gitCommitStaged, {
  payload: GitCommitStagedInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitFetchRpc = Rpc.make(WS_METHODS.gitFetch, {
  payload: GitFetchInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitIgnorePathsRpc = Rpc.make(WS_METHODS.gitIgnorePaths, {
  payload: GitIgnorePathsInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitRebaseRpc = Rpc.make(WS_METHODS.gitRebase, {
  payload: GitRebaseInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitRebaseStateRpc = Rpc.make(WS_METHODS.gitRebaseState, {
  payload: GitRebaseStateInput,
  success: GitRebaseStateResult,
  error: WsRpcError,
});

export const WsGitRevertUnstagedFileRpc = Rpc.make(WS_METHODS.gitRevertUnstagedFile, {
  payload: GitRevertUnstagedFileInput,
  success: GitRevertUnstagedFileResult,
  error: WsRpcError,
});

export const WsGitUnstageFilesRpc = Rpc.make(WS_METHODS.gitUnstageFiles, {
  payload: GitUnstageFilesInput,
  success: GitUnstageFilesResult,
  error: WsRpcError,
});

export const WsGitHandoffThreadRpc = Rpc.make(WS_METHODS.gitHandoffThread, {
  payload: GitHandoffThreadInput,
  success: GitHandoffThreadResult,
  error: WsRpcError,
});

export const WsGitUndoCommitRpc = Rpc.make(WS_METHODS.gitUndoCommit, {
  payload: GitUndoCommitInput,
  success: GitUndoCommitResult,
  error: WsRpcError,
});

export const WsGitCheckUndoCommitRpc = Rpc.make(WS_METHODS.gitCheckUndoCommit, {
  payload: GitStatusInput,
  success: Schema.NullOr(Schema.String),
  error: WsRpcError,
});
