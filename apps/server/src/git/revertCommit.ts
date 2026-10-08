import { Effect } from "effect";
import type { GitRevertCommitResult } from "@glade/contracts/git/git";
import { GitCommandError } from "./Errors";
import { readGitOperation } from "./gitOperationState";
import type { GitCoreShape } from "./Services/GitCore";
import { GIT_WRITE_EXECUTION } from "./Services/GitCommands";

const COMMIT_ID = /^[0-9a-f]{4,64}$/i;

// Callers refuse first while another Git operation is in progress.
export function revertCommit(git: GitCoreShape, cwd: string, sha: string) {
  const fail = (detail: string) =>
    new GitCommandError({ cwd, detail, operation: "revert commit", command: "git revert" });
  return Effect.gen(function* () {
    if (!COMMIT_ID.test(sha)) return yield* fail("This is not a commit id.");
    const lookup = yield* git.execute({
      cwd,
      operation: "revert commit",
      args: ["rev-list", "--parents", "-n", "1", `${sha}^{commit}`],
      allowNonZeroExit: true,
    });
    const [commit, ...parents] = lookup.stdout.trim().split(/\s+/);
    if (lookup.code !== 0 || !commit)
      return yield* fail("This commit is no longer available. Refresh History and try again.");
    if (parents.length > 1)
      return yield* fail(
        "Merge commits cannot be reverted here because Git needs a parent to keep.",
      );
    const result = yield* git.execute({
      cwd,
      operation: "revert commit",
      args: ["revert", "--no-edit", commit],
      allowNonZeroExit: true,
      ...GIT_WRITE_EXECUTION,
    });
    if (result.code === 0) return { status: "reverted" } satisfies GitRevertCommitResult;
    const reason = (result.stderr.trim() || result.stdout.trim() || "git revert failed").trim();
    if ((yield* readGitOperation(cwd, git.execute)).kind === "revert")
      return { status: "stopped", reason } satisfies GitRevertCommitResult;
    return yield* fail(
      /would be overwritten/i.test(reason)
        ? `Commit or stash your changes first.\n${reason}`
        : reason,
    );
  });
}
