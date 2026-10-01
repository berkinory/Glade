import { ServiceMap } from "effect";
import type { GitCoreShape } from "./GitCore.ts";

export type GitWorktreesShape = Pick<
  GitCoreShape,
  | "createWorktree"
  | "recordWorktreeOwnership"
  | "verifyWorktreeOwnership"
  | "snapshotWorktree"
  | "createDetachedWorktree"
  | "removeWorktree"
>;

export class GitWorktrees extends ServiceMap.Service<GitWorktrees, GitWorktreesShape>()(
  "glade/git/Services/GitWorktrees",
) {}
