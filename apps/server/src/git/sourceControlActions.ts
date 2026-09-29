import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Effect } from "effect";
import type { GitRebaseInput } from "@glade/contracts";
import { isWorkspaceRelativePathSafe } from "@glade/shared/path";
import { GitCommandError } from "./Errors.ts";
import type { GitCoreShape } from "./Services/GitCore.ts";

// These operations share GitCore's process boundary and repository mutation lock.
export function sourceControlActions(git: GitCoreShape) {
  const run = (cwd: string, args: readonly string[]) =>
    git.execute({ operation: "SourceControl", cwd, args, timeoutMs: 120_000 });
  const fail = (cwd: string, detail: string) =>
    new GitCommandError({ operation: "SourceControl", command: "git", cwd, detail });
  const io = <T>(cwd: string, operation: () => Promise<T>) =>
    Effect.tryPromise({ try: operation, catch: (cause) => fail(cwd, String(cause)) });

  const rebaseState = (cwd: string) =>
    Effect.gen(function* () {
      const result = yield* run(cwd, [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "rebase-merge",
        "--git-path",
        "rebase-apply",
      ]);
      const states = yield* io(cwd, () =>
        Promise.all(
          result.stdout
            .trim()
            .split("\n")
            .map(async (directory) => {
              try {
                return (await fs.stat(directory)).isDirectory();
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
                throw error;
              }
            }),
        ),
      );
      return { inProgress: states.some(Boolean) };
    });

  return {
    rebaseState,
    commitStaged: (cwd: string, message: string) =>
      Effect.gen(function* () {
        if ((yield* rebaseState(cwd)).inProgress)
          return yield* fail(cwd, "Finish or abort the rebase before committing.");
        yield* git.commit(cwd, message, "", { timeoutMs: 120_000 });
      }),
    fetch: (cwd: string) => run(cwd, ["fetch", "--all", "--prune"]).pipe(Effect.asVoid),
    rebase: (input: GitRebaseInput) =>
      Effect.gen(function* () {
        const active = (yield* rebaseState(input.cwd)).inProgress;
        if (input.action === "start") {
          if (active) return yield* fail(input.cwd, "A rebase is already in progress.");
          // Resolve the selected ref before passing it to rebase, so ref names cannot be options.
          const target = yield* run(input.cwd, [
            "rev-parse",
            "--verify",
            "--end-of-options",
            `${input.target}^{commit}`,
          ]);
          yield* run(input.cwd, [
            "-c",
            "core.editor=true",
            "rebase",
            "--no-autostash",
            target.stdout.trim(),
          ]);
        } else {
          if (!active) return yield* fail(input.cwd, "There is no rebase in progress.");
          yield* run(input.cwd, ["-c", "core.editor=true", "rebase", `--${input.action}`]);
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
          // Anchor exact paths at the root and escape glob syntax, including trailing spaces.
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
