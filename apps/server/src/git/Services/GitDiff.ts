import { ServiceMap } from "effect";
import type { GitCoreShape } from "./GitCore.ts";

export type GitDiffShape = Pick<
  GitCoreShape,
  | "readWorkingTreePatch"
  | "readUnstagedPatch"
  | "readStagedPatch"
  | "readSourceControlFiles"
  | "readBranchPatch"
  | "blameLine"
  | "readFileAtRev"
  | "readRefPatch"
  | "readDiffStats"
>;

export class GitDiff extends ServiceMap.Service<GitDiff, GitDiffShape>()(
  "glade/git/Services/GitDiff",
) {}
