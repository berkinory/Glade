import * as fs from "node:fs/promises";
import { Effect } from "effect";
import { GitCommandError } from "./Errors";
import type { GitCoreShape } from "./Services/GitCore";

export function readGitOperation(cwd: string, execute: GitCoreShape["execute"]) {
  return Effect.gen(function* () {
    const names = [
      "rebase-merge",
      "rebase-apply",
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "sequencer",
    ];
    const result = yield* execute({
      cwd,
      operation: "read operation",
      args: [
        "rev-parse",
        "--path-format=absolute",
        ...names.flatMap((name) => ["--git-path", name]),
      ],
    });
    const exists = yield* Effect.tryPromise({
      try: () =>
        Promise.all(
          result.stdout
            .trim()
            .split("\n")
            .map(async (file) => {
              try {
                await fs.stat(file);
                return true;
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
                throw error;
              }
            }),
        ),
      catch: (cause) =>
        new GitCommandError({
          cwd,
          operation: "read operation",
          command: "stat",
          detail: "Could not read Git operation state.",
          cause,
        }),
    });
    const kind =
      exists[0] || exists[1]
        ? ("rebase" as const)
        : exists[2]
          ? ("merge" as const)
          : exists[3]
            ? ("cherry-pick" as const)
            : exists[4]
              ? ("revert" as const)
              : exists[5]
                ? ("sequencer" as const)
                : null;
    const conflicts = yield* execute({
      cwd,
      operation: "read conflicts",
      args: ["diff", "--name-only", "--diff-filter=U", "-z"],
    });
    return { kind, conflicts: conflicts.stdout.split("\0").filter(Boolean) };
  });
}
