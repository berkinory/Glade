import { watch } from "node:fs";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Cause, Duration, Effect, Queue, Schedule, Stream } from "effect";

import { GitCommandError } from "./Errors";
import type { GitCoreShape } from "./Services/GitCore";

const METADATA_FILES = new Set([
  "HEAD",
  "index",
  "config",
  "config.worktree",
  "packed-refs",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "sequencer",
  "glade-push.json",
]);
const WORKTREE_BATCH_MAX_PATHS = 20_000;
// Recursive watches can exhaust inotify limits on Linux; back off instead of rescanning every 5s.
const WORKTREE_WATCH_RETRY = Schedule.either(
  Schedule.exponential("5 seconds"),
  Schedule.spaced("5 minutes"),
);

/** Resolves true only when Git would ignore every listed worktree path. */
export type WorktreeIgnoreCheck = (
  cwd: string,
  relativePaths: ReadonlyArray<string>,
) => Effect.Effect<boolean>;

function isMetadataChange(name: string | null): boolean {
  if (name === null) return true;
  // Bun can report only the source lock name for an atomic rename.
  const file = name.replace(/\.lock$/, "");
  return (
    METADATA_FILES.has(file) ||
    file.startsWith("refs/") ||
    file.startsWith("rebase-") ||
    file.startsWith("sequencer/")
  );
}

function watchDirectory(
  cwd: string,
  directory: string,
  accept: (name: string | null) => boolean,
): Stream.Stream<void, GitCommandError> {
  const watchError = (cause: unknown) =>
    new GitCommandError({
      operation: "watch repository",
      cwd,
      command: "fs.watch",
      detail:
        (cause as NodeJS.ErrnoException | null)?.code === "ENOSPC"
          ? `Could not watch ${directory}: the inotify watch limit (fs.inotify.max_user_watches) is exhausted.`
          : `Could not watch ${directory}.`,
      cause,
    });
  return Stream.callback<void, GitCommandError>(
    (queue) =>
      Effect.acquireRelease(
        Effect.try({
          try: () => {
            const watcher = watch(directory, { recursive: true }, (_event, filename) => {
              const name = filename == null ? null : filename.toString().split(path.sep).join("/");
              if (accept(name)) Queue.offerUnsafe(queue, undefined);
            });
            const onError = (cause: Error) =>
              Queue.failCauseUnsafe(queue, Cause.fail(watchError(cause)));
            watcher.on("error", onError);
            // Revalidate after establishing the watcher to close the snapshot-before-watch race.
            Queue.offerUnsafe(queue, undefined);
            return { watcher, onError };
          },
          catch: watchError,
        }),
        ({ watcher, onError }) =>
          Effect.sync(() => {
            watcher.off("error", onError);
            watcher.close();
          }),
      ).pipe(Effect.asVoid),
    { bufferSize: 1, strategy: "sliding" },
  );
}

function watchWorktree(cwd: string, isEveryPathIgnored: WorktreeIgnoreCheck) {
  return Stream.suspend(() => {
    // null forces a refresh: unnamed events, overflow, and the revalidation after (re)watching.
    let pending: Set<string> | null = null;
    return watchDirectory(cwd, cwd, (name) => {
      if (name?.split("/").includes(".git")) return false;
      if (name === null || pending === null || pending.size >= WORKTREE_BATCH_MAX_PATHS)
        pending = null;
      else pending.add(name);
      return true;
    }).pipe(
      Stream.throttle({ units: 1, duration: Duration.millis(300), cost: () => 1 }),
      Stream.filterEffect(() => {
        const batch = pending;
        pending = new Set();
        if (batch === null) return Effect.succeed(true);
        if (batch.size === 0) return Effect.succeed(false);
        return isEveryPathIgnored(cwd, [...batch]).pipe(Effect.map((ignored) => !ignored));
      }),
    );
  });
}

async function metadataFingerprint(
  directories: readonly string[],
): Promise<{ local: string; repository: string }> {
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
  const records = await Promise.all(
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
  );
  return {
    local: records.join("\0"),
    repository: records
      .filter(
        (record) =>
          !directories.some((directory) => record.startsWith(`${path.join(directory, "index")}:`)),
      )
      .join("\0"),
  };
}

export function watchGitRepository(
  cwd: string,
  execute: GitCoreShape["execute"],
  isEveryPathIgnored: WorktreeIgnoreCheck,
) {
  return Stream.unwrap(
    execute({
      operation: "watch repository",
      cwd,
      args: ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
      priority: "background",
    }).pipe(
      Effect.map((result) => {
        const directories = [...new Set(result.stdout.trim().split("\n"))];
        let previousRepository: string | null = null;
        const metadata = Stream.mergeAll(
          directories.map((directory) => watchDirectory(cwd, directory, isMetadataChange)),
          { concurrency: "unbounded" },
        ).pipe(
          Stream.throttle({ units: 1, duration: Duration.millis(150), cost: () => 1 }),
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
          Stream.changesWith((a, b) => a.local === b.local),
          Stream.map((fingerprint) => {
            const repositoryChanged = fingerprint.repository !== previousRepository;
            previousRepository = fingerprint.repository;
            return { repositoryChanged };
          }),
        );
        // Worktree watch failures must not stop the metadata watcher, so they retry on their own.
        const worktree = watchWorktree(cwd, isEveryPathIgnored).pipe(
          Stream.tapError((error) =>
            Effect.logWarning(
              "Worktree watcher failed; Git status follows only Git metadata until it recovers",
              error,
            ),
          ),
          Stream.retry(WORKTREE_WATCH_RETRY),
          Stream.map(() => ({ repositoryChanged: false })),
        );
        return Stream.merge(metadata, worktree);
      }),
    ),
  );
}
