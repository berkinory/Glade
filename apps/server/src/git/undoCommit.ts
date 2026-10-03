import { refreshPublicationRefs } from "./gitPublication";
import { readGitOperation } from "./gitOperationState";
import { Effect } from "effect";
import { GitCommandError } from "./Errors";
import type { GitCoreShape } from "./Services/GitCore";

export function undoCommitActions(git: GitCoreShape) {
  const run = (cwd: string, args: readonly string[]) =>
    git.execute({ cwd, args, operation: "undo commit", timeoutMs: 120_000 });
  const fail = (cwd: string, detail: string) =>
    new GitCommandError({ cwd, detail, operation: "undo commit", command: "git" });
  const candidate = (cwd: string) =>
    Effect.gen(function* () {
      const branch = yield* git.execute({
        cwd,
        args: ["symbolic-ref", "-q", "HEAD"],
        operation: "undo commit",
        allowNonZeroExit: true,
      });
      if (branch.code !== 0) return null;
      const head = yield* git.execute({
        cwd,
        args: ["rev-list", "--parents", "-n", "1", "HEAD"],
        operation: "undo commit",
        allowNonZeroExit: true,
      });
      const [sha, parent, ...others] = head.stdout.trim().split(/\s+/);
      // Root and merge commits need different semantics; neither is a single-commit undo.
      if (head.code !== 0 || !sha || !parent || others.length) return null;
      const published = yield* run(cwd, [
        "for-each-ref",
        `--contains=${sha}`,
        "--format=%(refname)",
        "refs/remotes",
        "refs/tags",
        "refs/glade/publication",
      ]);
      if (published.stdout.trim()) return null;
      return { sha, parent, branch: branch.stdout.trim() };
    });
  const undo = (cwd: string, expectedHead: string) =>
    Effect.gen(function* () {
      // Publication is checked against every configured remote, including branches without an upstream.
      yield* refreshPublicationRefs(cwd, git.execute);
      const operation = yield* readGitOperation(cwd, git.execute);
      if (operation.kind || operation.conflicts.length)
        return yield* fail(cwd, "Finish the current Git operation before undoing a commit.");
      const current = yield* candidate(cwd);
      if (!current || current.sha !== expectedHead)
        return yield* fail(
          cwd,
          "Only the current latest unpublished, non-merge commit can be undone. Refresh History and try again.",
        );
      const message = (yield* run(cwd, [
        "show",
        "-s",
        "--format=%B",
        current.sha,
      ])).stdout.trimEnd();
      if ((yield* run(cwd, ["symbolic-ref", "HEAD"])).stdout.trim() !== current.branch)
        return yield* fail(cwd, "The current branch changed. Try again.");
      // Compare-and-swap moves only the branch ref. Index, worktree and untracked files stay intact.
      yield* run(cwd, [
        "update-ref",
        "-m",
        "glade: undo commit",
        current.branch,
        current.parent,
        current.sha,
      ]);
      return { message };
    });
  return { candidate, undo };
}
