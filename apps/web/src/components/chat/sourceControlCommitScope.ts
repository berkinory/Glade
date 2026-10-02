import type { GitSourceControlFilesResult } from "@glade/contracts/git/git";
import { ensureNativeApi } from "~/nativeApi";

export interface CommitScope {
  staged: boolean;
  paths: readonly string[];
  deletedPaths: readonly string[];
  renameCount: number;
  hasUnstagedChanges: boolean;
  inventory: string;
}

export function commitScopeInventory(files: GitSourceControlFilesResult): string {
  return JSON.stringify(
    files.staged.length > 0 ? ["staged", files.staged] : ["changes", files.unstaged],
  );
}

export async function readCommitScope(cwd: string): Promise<CommitScope> {
  const files = await ensureNativeApi().git.readSourceControlFiles({ cwd });
  const staged = files.staged.length > 0;
  const selection = staged ? files.staged : files.unstaged;
  if (selection.length === 0) throw new Error("There are no changes to commit.");
  return {
    staged,
    paths: selection.map((file) => file.path),
    deletedPaths: selection.filter((file) => file.status === "D").map((file) => file.path),
    renameCount: selection.filter((file) => file.status === "R").length,
    hasUnstagedChanges: files.unstaged.length > 0,
    inventory: commitScopeInventory(files),
  };
}

export function assertCommitScope(expected: CommitScope, current: CommitScope) {
  if (expected.inventory !== current.inventory) {
    throw new Error(
      "The commit scope changed. Review the changes and regenerate or edit the message before committing.",
    );
  }
}

export function assertStagedChanges(expected: CommitScope, current: CommitScope) {
  const stagedPaths = new Set(current.paths);
  const expectedPaths = new Set(expected.paths);
  const deletedPaths = new Set(expected.deletedPaths);
  // Git can fold a staged deletion/addition pair into one rename row.
  const missingDeletions = expected.deletedPaths.filter((path) => !stagedPaths.has(path)).length;
  if (
    !current.staged ||
    current.hasUnstagedChanges ||
    missingDeletions > current.renameCount ||
    current.paths.some((path) => !expectedPaths.has(path)) ||
    expected.paths.some((path) => !deletedPaths.has(path) && !stagedPaths.has(path))
  ) {
    throw new Error(
      "The staged selection changed. Review Staged before committing; your message has been preserved.",
    );
  }
}
