import { ServiceMap } from "effect";
import type { GitCoreShape } from "./GitCore.ts";

export type GitRefsShape = Pick<
  GitCoreShape,
  | "readRangeContext"
  | "readConfigValue"
  | "listBranches"
  | "listRecentCommits"
  | "readCommit"
  | "listLocalBranchNames"
>;

export class GitRefs extends ServiceMap.Service<GitRefs, GitRefsShape>()(
  "glade/git/Services/GitRefs",
) {}
