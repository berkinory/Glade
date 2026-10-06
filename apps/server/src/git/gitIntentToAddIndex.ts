import * as nodePath from "node:path";
import { Effect, FileSystem } from "effect";
import type { GitCommandError } from "./Errors.ts";
import type { GitCommandsShape } from "./Services/GitCommands.ts";
import { createGitCommandError } from "./Layers/GitCommands.ts";

interface IntentToAddGit {
  readonly fileSystem: FileSystem.FileSystem;
  readonly executeGit: GitCommandsShape["executeGit"];
}

// Lets one `git diff` report new files as additions without a process per file. The index holds
// only these intent-to-add entries, so the real index and object store stay untouched.
export function withIntentToAddIndex<A>(
  git: IntentToAddGit,
  cwd: string,
  files: ReadonlyArray<string>,
  operation: string,
  use: (env: NodeJS.ProcessEnv) => Effect.Effect<A, GitCommandError>,
): Effect.Effect<A, GitCommandError> {
  return Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* git.fileSystem
        .makeTempDirectoryScoped({ prefix: `glade-intent-index-${process.pid}-` })
        .pipe(
          Effect.mapError((cause) =>
            createGitCommandError(operation, cwd, ["add", "--intent-to-add"], cause.message),
          ),
        );
      const pathspecFile = nodePath.join(directory, "pathspecs");
      // A file keeps long path lists clear of the Windows command-line limit.
      yield* git.fileSystem
        .writeFileString(pathspecFile, files.join("\0"))
        .pipe(
          Effect.mapError((cause) =>
            createGitCommandError(operation, cwd, ["add", "--intent-to-add"], cause.message),
          ),
        );
      const env = { GIT_INDEX_FILE: nodePath.join(directory, "index") };
      // `--force`: paths added in the real index can match .gitignore once they are absent here.
      yield* git.executeGit(
        operation,
        cwd,
        [
          "--literal-pathspecs",
          "add",
          "--intent-to-add",
          "--force",
          `--pathspec-from-file=${pathspecFile}`,
          "--pathspec-file-nul",
        ],
        { env, fallbackErrorMessage: "git add --intent-to-add failed" },
      );
      return yield* use(env);
    }),
  );
}
