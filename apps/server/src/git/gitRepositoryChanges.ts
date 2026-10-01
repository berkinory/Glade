import { watch } from "node:fs";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Cause, Duration, Effect, Queue, Stream } from "effect";

import { GitCommandError } from "./Errors";
import type { GitCoreShape } from "./Services/GitCore";

function watchGitDirectory(
  cwd: string,
  directory: string,
  worktree = false,
): Stream.Stream<void, GitCommandError> {
  return Stream.callback<void, GitCommandError>((queue) =>
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          const watcher = watch(directory, { recursive: true }, (_event, filename) => {
            // Bun can report only the source lock name for an atomic rename.
            const name = filename
              ?.toString()
              .split(path.sep)
              .join("/")
              .replace(/\.lock$/, "");
            if (
              worktree &&
              name
                ?.split("/")
                .some((part) => [".git", "node_modules", "dist", ".turbo"].includes(part))
            )
              return;
            if (
              !worktree &&
              name &&
              !["HEAD", "index", "config", "config.worktree", "packed-refs"].includes(name) &&
              !name.startsWith("refs/") &&
              !name.startsWith("rebase-") &&
              !name.startsWith("sequencer/") &&
              ![
                "MERGE_HEAD",
                "CHERRY_PICK_HEAD",
                "REVERT_HEAD",
                "sequencer",
                "glade-push.json",
              ].includes(name)
            )
              return;
            Queue.offerUnsafe(queue, undefined);
          });
          const onError = (cause: Error) =>
            Queue.failCauseUnsafe(
              queue,
              Cause.fail(
                new GitCommandError({
                  operation: "watch repository",
                  cwd,
                  command: "fs.watch",
                  detail: `Could not watch ${directory}.`,
                  cause,
                }),
              ),
            );
          watcher.on("error", onError);
          // Revalidate after establishing the watcher to close the snapshot-before-watch race.
          Queue.offerUnsafe(queue, undefined);
          return { watcher, onError };
        },
        catch: (cause) =>
          new GitCommandError({
            operation: "watch repository",
            cwd,
            command: "fs.watch",
            detail: `Could not watch ${directory}.`,
            cause,
          }),
      }),
      ({ watcher, onError }) =>
        Effect.sync(() => {
          watcher.off("error", onError);
          watcher.close();
        }),
    ).pipe(Effect.asVoid),
  );
}

async function metadataFingerprint(directories: readonly string[]): Promise<string> {
  const paths = directories.flatMap((directory) =>
    [
      "HEAD",
      "index",
      "config",
      "config.worktree",
      "packed-refs",
      "refs",
      "rebase-merge",
      "rebase-apply",
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "sequencer",
      "glade-push.json",
    ].map((name) => path.join(directory, name)),
  );
  for (const directory of directories.flatMap((directory) =>
    ["refs", "rebase-merge", "rebase-apply", "sequencer"].map((name) => path.join(directory, name)),
  )) {
    const refs = await fs
      .readdir(directory, { recursive: true, withFileTypes: true })
      .catch((cause: unknown) => {
        if (
          typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === "ENOENT"
        )
          return [];
        throw cause;
      });
    for (const entry of refs) {
      paths.push(path.join(entry.parentPath, entry.name));
    }
  }
  return (
    await Promise.all(
      paths.map(async (file) => {
        const stat = await fs.stat(file, { bigint: true }).catch((cause: unknown) => {
          if (
            typeof cause === "object" &&
            cause !== null &&
            "code" in cause &&
            cause.code === "ENOENT"
          )
            return null;
          throw cause;
        });
        return stat
          ? `${file}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
          : `${file}:missing`;
      }),
    )
  ).join("\0");
}

export function watchGitRepository(cwd: string, execute: GitCoreShape["execute"]) {
  return Stream.unwrap(
    execute({
      operation: "watch repository",
      cwd,
      args: ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
      priority: "background",
    }).pipe(
      Effect.map((result) => {
        const directories = [...new Set(result.stdout.trim().split("\n"))];
        const metadata = Stream.mergeAll(
          directories.map((directory) => watchGitDirectory(cwd, directory)),
          { concurrency: "unbounded" },
        ).pipe(
          Stream.debounce(Duration.millis(150)),
          Stream.mapEffect(() =>
            Effect.tryPromise({
              try: () => metadataFingerprint(directories),
              catch: (cause) =>
                new GitCommandError({
                  operation: "watch repository",
                  cwd,
                  command: "stat",
                  detail: "Could not inspect watched Git metadata.",
                  cause,
                }),
            }),
          ),
          Stream.changes,
          Stream.map(() => undefined),
        );
        return Stream.merge(
          metadata,
          watchGitDirectory(cwd, cwd, true).pipe(Stream.debounce(Duration.millis(300))),
        );
      }),
    ),
  );
}
