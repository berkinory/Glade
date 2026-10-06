import { refreshPublicationRefs } from "./gitPublication";
import { readGitOperation } from "./gitOperationState";
import { pushIntent } from "./pushSynchronization";
import { undoCommitActions } from "./undoCommit";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Effect } from "effect";
import { readGenerationContext } from "./generationContext";
import type { GitRebaseInput } from "@glade/contracts/git/git";
import { isWorkspaceRelativePathSafe } from "@glade/shared/platform/path";
import { GitCommandError } from "./Errors.ts";
import type { GitCoreShape } from "./Services/GitCore.ts";
import { GIT_WRITE_EXECUTION } from "./Services/GitCommands.ts";

export function sourceControlActions(git: GitCoreShape) {
  const run = (cwd: string, args: readonly string[]) =>
    git.execute({ operation: "SourceControl", cwd, args, timeoutMs: 120_000 });
  const write = (cwd: string, args: readonly string[]) =>
    git.execute({ operation: "SourceControl", cwd, args, ...GIT_WRITE_EXECUTION });
  const fail = (cwd: string, detail: string) =>
    new GitCommandError({ operation: "SourceControl", command: "git", cwd, detail });
  const io = <T>(cwd: string, operation: () => Promise<T>) =>
    Effect.tryPromise({ try: operation, catch: (cause) => fail(cwd, String(cause)) });

  const rebaseState = (cwd: string) =>
    Effect.gen(function* () {
      const operation = yield* readGitOperation(cwd, git.execute);
      const inProgress = operation.kind !== null;
      const pendingPush = (yield* pushIntent(cwd, git.execute).read()) !== null;
      return {
        ...operation,
        inProgress,
        pendingPush,
        undoableHead:
          inProgress || pendingPush || operation.conflicts.length
            ? null
            : ((yield* undoCommitActions(git).candidate(cwd))?.sha ?? null),
      };
    });

  return {
    rebaseState,
    checkUndoCommit: (cwd: string) =>
      Effect.gen(function* () {
        yield* refreshPublicationRefs(cwd, git.execute);
        return (yield* rebaseState(cwd)).undoableHead;
      }),
    undoCommit: (cwd: string, expectedHead: string) =>
      Effect.gen(function* () {
        if ((yield* rebaseState(cwd)).undoableHead !== expectedHead)
          return yield* fail(cwd, "Finish or abort the current operation before undoing a commit.");
        return yield* undoCommitActions(git).undo(cwd, expectedHead);
      }),
    commitStaged: (
      cwd: string,
      message: string,
      expected?: { snapshot: string; scope: "staged" | "workingTree" },
    ) =>
      Effect.gen(function* () {
        if ((yield* rebaseState(cwd)).inProgress)
          return yield* fail(cwd, "Finish or abort the current Git operation before committing.");
        if (expected) {
          const context =
            expected.scope === "workingTree"
              ? yield* readGenerationContext(git, cwd, undefined, false, true)
              : yield* git.prepareCommitContext(cwd, false);
          if (context?.snapshot !== expected.snapshot)
            return yield* fail(
              cwd,
              "Changes or index changed after generation. Regenerate the message before committing.",
            );
          if (expected.scope === "workingTree") {
            const unstaged = yield* git.execute({
              operation: "SourceControl.commit",
              cwd,
              args: ["diff", "--quiet"],
              allowNonZeroExit: true,
            });
            const untracked = yield* git.execute({
              operation: "SourceControl.commit",
              cwd,
              args: ["ls-files", "--others", "--exclude-standard", "-z"],
              maxOutputBytes: 1,
              outputMode: "prefix",
            });
            if (unstaged.code !== 0 || untracked.stdout || untracked.stdoutTruncated)
              return yield* fail(
                cwd,
                "The staged selection no longer matches the generated message. Regenerate before committing.",
              );
          }
        }
        yield* git.commit(cwd, message, "");
      }),
    fetch: (cwd: string) => write(cwd, ["fetch", "--all", "--prune"]).pipe(Effect.asVoid),
    rebase: (input: GitRebaseInput) =>
      Effect.gen(function* () {
        const state = yield* rebaseState(input.cwd);
        if (input.action !== "start" && input.operation && input.operation !== "rebase") {
          if (state.kind !== input.operation || input.operation === "sequencer")
            return yield* fail(
              input.cwd,
              "This operation requires manual recovery in the terminal.",
            );
          yield* write(input.cwd, ["-c", "core.editor=true", input.operation, `--${input.action}`]);
          return;
        }
        const active = state.kind === "rebase";
        if (input.action === "start") {
          if (active) return yield* fail(input.cwd, "A rebase is already in progress.");

          const target = yield* run(input.cwd, [
            "rev-parse",
            "--verify",
            "--end-of-options",
            `${input.target}^{commit}`,
          ]);
          yield* write(input.cwd, [
            "-c",
            "core.editor=true",
            "rebase",
            "--no-autostash",
            target.stdout.trim(),
          ]);
        } else {
          const intent = pushIntent(input.cwd, git.execute);
          const pending = yield* intent.read();
          if (!active) {
            if (!pending || state.inProgress)
              return yield* fail(input.cwd, "There is no matching push to recover.");
            const branch = (yield* run(input.cwd, [
              "symbolic-ref",
              "--short",
              "HEAD",
            ])).stdout.trim();
            if (input.action === "continue" && branch !== pending.branch)
              return yield* fail(
                input.cwd,
                "Return to the original branch before resuming this push.",
              );
            yield* intent.clear();
            if (input.action === "continue") yield* git.pushCurrentBranch(input.cwd, branch);
            return;
          }
          if (pending) {
            const original = (yield* run(input.cwd, ["rev-parse", "ORIG_HEAD"])).stdout.trim();
            if (original !== pending.head)
              return yield* fail(
                input.cwd,
                "The rebase no longer matches the pending push. Resolve it manually.",
              );
          }
          yield* write(input.cwd, ["-c", "core.editor=true", "rebase", `--${input.action}`]);
          if (pending) {
            yield* intent.clear();
            if (input.action === "continue" && !(yield* rebaseState(input.cwd)).inProgress) {
              const branch = (yield* run(input.cwd, [
                "symbolic-ref",
                "--short",
                "HEAD",
              ])).stdout.trim();
              if (branch !== pending.branch)
                return yield* fail(input.cwd, "Branch changed; push was not resumed.");
              yield* git.pushCurrentBranch(input.cwd, branch);
            }
          }
        }
      }),
    ignorePaths: (cwd: string, paths: readonly string[]) =>
      Effect.gen(function* () {
        const root = (yield* run(cwd, ["rev-parse", "--show-toplevel"])).stdout.trim();
        const prefix = (yield* run(cwd, ["rev-parse", "--show-prefix"])).stdout.trim();
        const rules: string[] = [];
        for (const file of new Set(paths)) {
          if (!isWorkspaceRelativePathSafe(file) || file.includes("\0") || /[\r\n]/.test(file))
            return yield* fail(cwd, "This path cannot be represented safely in .gitignore.");
          const relative = `${prefix}${file}`;
          if (relative === ".gitignore")
            return yield* fail(cwd, "The root .gitignore cannot ignore itself.");
          const tracked = yield* git.execute({
            operation: "SourceControl.ignore",
            cwd: root,
            args: ["ls-files", "-z", "--", `:(literal)${relative}`],
          });
          if (tracked.stdout)
            return yield* fail(
              cwd,
              "Only untracked files can be ignored. This action does not remove tracked files from Git.",
            );
          const ignored = yield* git.execute({
            operation: "SourceControl.ignore",
            cwd: root,
            args: ["check-ignore", "--quiet", "--", relative],
            allowNonZeroExit: true,
          });
          if (ignored.code === 0) continue;
          if (ignored.code !== 1)
            return yield* fail(cwd, ignored.stderr || "Could not inspect ignore rules.");

          rules.push("/" + relative.replace(/[\\*?[\] !#]/g, "\\$&"));
        }
        if (!rules.length) return;
        yield* io(cwd, async () => {
          const ignorePath = path.join(root, ".gitignore");
          const before = await fs.lstat(ignorePath).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
          if (before && (!before.isFile() || before.nlink !== 1))
            throw new Error(".gitignore must be a regular file without links.");
          const handle = await fs.open(
            ignorePath,
            constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
            0o666,
          );
          try {
            const stat = await handle.stat();
            const current = await fs.lstat(ignorePath);
            if (
              !current.isFile() ||
              current.ino !== stat.ino ||
              current.dev !== stat.dev ||
              (before && (before.ino !== stat.ino || before.dev !== stat.dev))
            ) {
              throw new Error(".gitignore changed while opening it. Try again.");
            }
            if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1_000_000)
              throw new Error(".gitignore must be a regular file smaller than 1 MB without links.");
            const content = await handle.readFile("utf8");
            if (content.includes("\0")) throw new Error(".gitignore is not a text file.");
            const eol = content.includes("\r\n") ? "\r\n" : "\n";
            await handle.writeFile(
              (content && !content.endsWith("\n") ? eol : "") + rules.join(eol) + eol,
            );
          } finally {
            await handle.close();
          }
        });
      }),
  };
}
