import { Effect } from "effect";
import type { GitLocalWorktreeState } from "@glade/contracts/git/localWorktree";
import { GitCommandError } from "./Errors";
import type { GitCoreShape } from "./Services/GitCore";
import { readGitOperation } from "./gitOperationState";
import { pushIntent } from "./pushSynchronization";

export function localWorktreeActions(git: GitCoreShape) {
  const run = (cwd: string, args: readonly string[]) =>
    git.execute({ cwd, args, operation: "local worktree", timeoutMs: 120_000 });
  const fail = (cwd: string, detail: string) =>
    new GitCommandError({ cwd, detail, operation: "local worktree", command: "git" });
  const read = (cwd: string) =>
    Effect.gen(function* () {
      // Porcelain -z preserves paths containing spaces and Git's quoting characters.
      const listing = yield* run(cwd, ["worktree", "list", "--porcelain", "-z"]);
      const entries = listing.stdout
        .split("\0\0")
        .filter(Boolean)
        .map((record) => {
          const fields = record.split("\0");
          return {
            cwd: fields.find((field) => field.startsWith("worktree "))?.slice(9),
            branch:
              fields.find((field) => field.startsWith("branch refs/heads/"))?.slice(18) ?? null,
          };
        });
      const root = (yield* run(cwd, ["rev-parse", "--show-toplevel"])).stdout.trim();
      const source = entries.find((entry) => entry.cwd === root);
      const target = entries[0];
      if (!source || !target?.cwd || source.cwd === target.cwd)
        return yield* fail(cwd, "This chat must use a linked worktree.");
      const clean = !(yield* run(root, ["status", "--porcelain=v1", "-z"])).stdout;
      const targetClean = !(yield* run(target.cwd, ["status", "--porcelain=v1", "-z"])).stdout;
      const operation = yield* readGitOperation(root, git.execute);
      const targetOperation = yield* readGitOperation(target.cwd, git.execute);
      const pendingPush = (yield* pushIntent(root, git.execute).read()) !== null;
      const targetPendingPush = (yield* pushIntent(target.cwd, git.execute).read()) !== null;
      const counts =
        source.branch && target.branch
          ? (yield* run(root, [
              "rev-list",
              "--left-right",
              "--count",
              `refs/heads/${source.branch}...refs/heads/${target.branch}`,
            ])).stdout
              .trim()
              .split(/\s+/)
              .map(Number)
          : [0, 0];
      const state: GitLocalWorktreeState = {
        cwd: root,
        branch: source.branch,
        targetCwd: target.cwd,
        targetBranch: target.branch,
        ahead: counts[0] ?? 0,
        behind: counts[1] ?? 0,
        clean,
        blockedReason:
          operation.kind || operation.conflicts.length
            ? "Finish or abort the Git operation in this worktree."
            : targetOperation.kind || targetOperation.conflicts.length
              ? "Finish or abort the Git operation in the project checkout."
              : !source.branch || !target.branch
                ? "Both checkouts need a local branch."
                : pendingPush || targetPendingPush
                  ? "Finish or abort the pending push first."
                  : !targetClean
                    ? "Commit or discard changes in the project checkout first."
                    : null,
      };
      return state;
    });

  const apply = (state: GitLocalWorktreeState, action: "update" | "merge") =>
    Effect.gen(function* () {
      if (state.blockedReason) return yield* fail(state.cwd, state.blockedReason);
      if (!state.clean) return yield* fail(state.cwd, "Commit changes in this worktree first.");
      if (!state.branch || !state.targetBranch)
        return yield* fail(state.cwd, "A local branch is required.");
      const targetHead = (yield* run(state.targetCwd, ["rev-parse", "HEAD"])).stdout.trim();
      if (state.behind > 0 && state.ahead === 0) {
        yield* run(state.cwd, ["merge", "--ff-only", targetHead]);
      } else if (state.behind > 0) {
        // A configured upstream means the branch may be shared. Preserve published history.
        const tracking = yield* git.execute({
          cwd: state.cwd,
          operation: "local worktree",
          args: ["rev-parse", "--verify", "@{upstream}"],
          allowNonZeroExit: true,
        });
        const unpublished = yield* run(state.cwd, [
          "rev-list",
          "--count",
          "HEAD",
          `^${targetHead}`,
          "--not",
          "--remotes",
        ]);
        if (tracking.code === 0 || Number(unpublished.stdout.trim()) < state.ahead) {
          yield* run(state.cwd, ["-c", "core.editor=true", "merge", "--no-edit", targetHead]);
        } else {
          yield* run(state.cwd, ["-c", "core.editor=true", "rebase", "--no-autostash", targetHead]);
        }
      }
      if (action === "merge" && state.ahead > 0) {
        const current = yield* read(state.cwd);
        if (current.blockedReason) return yield* fail(state.cwd, current.blockedReason);
        if (current.targetBranch !== state.targetBranch)
          return yield* fail(state.cwd, "The project checkout changed branches. Review and retry.");
        const sourceHead = (yield* run(state.cwd, ["rev-parse", "HEAD"])).stdout.trim();
        yield* run(state.targetCwd, ["merge", "--ff-only", sourceHead]);
      }
      return yield* read(state.cwd);
    });
  return { read, apply };
}
