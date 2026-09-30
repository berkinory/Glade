import { ServiceMap } from "effect";
import type { GitCoreShape } from "./GitCore.ts";

export type GitBranchesShape = Pick<
  GitCoreShape,
  | "pushCurrentBranch"
  | "pullCurrentBranch"
  | "fetchPullRequestBranch"
  | "fetchPullRequestCommit"
  | "ensureRemote"
  | "fetchRemoteBranch"
  | "setBranchUpstream"
  | "deleteBranch"
  | "deleteBranchIfUnchanged"
  | "renameBranch"
  | "createBranch"
  | "publishBranch"
  | "checkoutBranch"
  | "stashAndCheckout"
  | "stashDrop"
  | "stashInfo"
>;

export class GitBranches extends ServiceMap.Service<GitBranches, GitBranchesShape>()(
  "glade/git/Services/GitBranches",
) {}
