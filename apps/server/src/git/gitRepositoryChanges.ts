import { type FSWatcher, watch } from "node:fs";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Cause, Duration, Effect, Queue, Schedule, Stream } from "effect";

import { watchDirectoryTree } from "./directoryTreeWatch";
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
// Node's recursive fs.watch on Linux walks the tree synchronously and opens an inotify watch per
// file, stalling the event loop for seconds on large repositories; watch directories instead.
const WATCH_PER_DIRECTORY = process.platform === "linux";
// Over this the listing fails and the worktree watcher backs off, rather than watching part of it.
const WORKTREE_LISTING_MAX_BYTES = 32 * 1024 * 1024;
// Failed watches back off instead of rescanning every 5s; recursive watches can exhaust inotify
// limits on Linux.
export const WATCH_RETRY = Schedule.either(
  Schedule.exponential("5 seconds"),
  Schedule.spaced("5 minutes"),
);
// `git init` or `git clone` in place is seen at once through `.git` appearing; a repository created
// in a parent directory is only found by this slower recheck.
const NON_REPOSITORY_RECHECK = Duration.minutes(5);

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

function isMissing(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function watchError(cwd: string, directory: string, cause: unknown): GitCommandError {
  return new GitCommandError({
    operation: "watch repository",
    cwd,
    command: "fs.watch",
    detail:
      (cause as NodeJS.ErrnoException | null)?.code === "ENOSPC"
        ? `Could not watch ${directory}: the inotify watch limit (fs.inotify.max_user_watches) is exhausted.`
        : `Could not watch ${directory}.`,
    cause,
  });
}

function watchDirectory(
  cwd: string,
  directory: string,
  accept: (name: string | null) => boolean,
): Stream.Stream<void, GitCommandError> {
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
              Queue.failCauseUnsafe(queue, Cause.fail(watchError(cwd, directory, cause)));
            watcher.on("error", onError);
            // Revalidate after establishing the watcher to close the snapshot-before-watch race.
            Queue.offerUnsafe(queue, undefined);
            return { watcher, onError };
          },
          catch: (cause) => watchError(cwd, directory, cause),
        }),
        ({ watcher, onError }) =>
          Effect.sync(() => {
            watcher.off("error", onError);
            watcher.close();
          }),
      ).pipe(
        Effect.asVoid,
        // A failure inside the forked callback effect does not reach the stream on its own.
        Effect.catch((error) => Queue.fail(queue, error)),
      ),
    { bufferSize: 1, strategy: "sliding" },
  );
}

function worktreeDirectories(paths: ReadonlyArray<string>): Set<string> {
  const directories = new Set([""]);
  for (const file of paths) {
    if (file === "" || `/${file}`.includes("/.git/")) continue;
    let directory = file.endsWith("/")
      ? file.slice(0, -1)
      : file.slice(0, Math.max(0, file.lastIndexOf("/")));
    while (directory !== "" && !directories.has(directory)) {
      directories.add(directory);
      directory = directory.slice(0, Math.max(0, directory.lastIndexOf("/")));
    }
  }
  return directories;
}

function watchWorktreeDirectories(
  cwd: string,
  execute: GitCoreShape["execute"],
  accept: (name: string | null) => boolean,
): Stream.Stream<void, GitCommandError> {
  if (!WATCH_PER_DIRECTORY) return watchDirectory(cwd, cwd, accept);
  return watchDirectoryTree({
    root: cwd,
    // Git skips ignored trees such as node_modules without walking them. Files only reveal the
    // directories holding them; `--directory` adds empty untracked ones as `dir/`.
    listDirectories: Effect.all(
      [["--cached"], ["--directory"]].map((mode) =>
        execute({
          operation: "watch repository",
          cwd,
          args: ["ls-files", "-z", "--others", "--exclude-standard", ...mode],
          priority: "background",
          maxOutputBytes: WORKTREE_LISTING_MAX_BYTES,
        }),
      ),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map((results) =>
        worktreeDirectories(results.flatMap((result) => result.stdout.split("\0"))),
      ),
    ),
    accept,
    affectsListing: (name) => name.split("/").at(-1) === ".gitignore",
    watchError: (directory, cause) => watchError(cwd, directory, cause),
  });
}

async function metadataDirectories(gitDirectory: string): Promise<Set<string>> {
  const directories = new Set([""]);
  const visit = async (relative: string): Promise<void> => {
    const entries = await fs
      .readdir(path.join(gitDirectory, relative), { withFileTypes: true })
      .catch((cause: unknown) => (isMissing(cause) ? [] : Promise.reject(cause)));
    const children = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => (relative === "" ? entry.name : `${relative}/${entry.name}`))
      // Objects, logs, hooks and other bulk content can never hold a metadata change.
      .filter((child) => isMetadataChange(`${child}/`));
    for (const child of children) directories.add(child);
    await Promise.all(children.map(visit));
  };
  await visit("");
  return directories;
}

function watchMetadataDirectory(cwd: string, directory: string) {
  if (!WATCH_PER_DIRECTORY) return watchDirectory(cwd, directory, isMetadataChange);
  return watchDirectoryTree({
    root: directory,
    listDirectories: Effect.tryPromise({
      try: () => metadataDirectories(directory),
      catch: (cause) =>
        new GitCommandError({
          operation: "watch repository",
          cwd,
          command: "readdir",
          detail: `Could not list Git metadata directories in ${directory}.`,
          cause,
        }),
    }),
    accept: isMetadataChange,
    affectsListing: () => false,
    watchError: (watched, cause) => watchError(cwd, watched, cause),
  });
}

function watchWorktree(
  cwd: string,
  execute: GitCoreShape["execute"],
  isEveryPathIgnored: WorktreeIgnoreCheck,
) {
  return Stream.suspend(() => {
    // null forces a refresh: unnamed events, overflow, and the revalidation after (re)watching.
    let pending: Set<string> | null = null;
    return watchWorktreeDirectories(cwd, execute, (name) => {
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
      .catch((cause: unknown) => (isMissing(cause) ? [] : Promise.reject(cause)));
    for (const entry of refs) {
      paths.push(path.join(entry.parentPath, entry.name));
    }
  }
  const records = await Promise.all(
    paths.map(async (file) => {
      const stat = await fs
        .stat(file, { bigint: true })
        .catch((cause: unknown) => (isMissing(cause) ? null : Promise.reject(cause)));
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

function awaitRepositoryCandidate(cwd: string): Effect.Effect<void> {
  const appeared = Effect.callback<void>((resume) => {
    let watcher: FSWatcher | undefined;
    const close = () => watcher?.close();
    try {
      watcher = watch(cwd, (_event, name) => {
        if (name?.toString() !== ".git") return;
        close();
        resume(Effect.void);
      });
      // A failed watch leaves the timed recheck in charge.
      watcher.on("error", close);
    } catch {
      return;
    }
    return Effect.sync(close);
  });
  return appeared.pipe(
    Effect.timeoutOrElse({ duration: NON_REPOSITORY_RECHECK, onTimeout: () => Effect.void }),
  );
}

function isNotRepositoryError(error: GitCommandError): boolean {
  return error.detail.toLowerCase().includes("not a git repository");
}

export function watchGitRepository(
  cwd: string,
  execute: GitCoreShape["execute"],
  isEveryPathIgnored: WorktreeIgnoreCheck,
): Stream.Stream<{ readonly repositoryChanged: boolean }, GitCommandError> {
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
          directories.map((directory) => watchMetadataDirectory(cwd, directory)),
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
        const worktree = watchWorktree(cwd, execute, isEveryPathIgnored).pipe(
          Stream.tapError((error) =>
            Effect.logWarning(
              "Worktree watcher failed; Git status follows only Git metadata until it recovers",
              error,
            ),
          ),
          Stream.retry(WATCH_RETRY),
          Stream.map(() => ({ repositoryChanged: false })),
        );
        return Stream.merge(metadata, worktree);
      }),
      Effect.catchIf(isNotRepositoryError, () =>
        awaitRepositoryCandidate(cwd).pipe(
          Effect.as(watchGitRepository(cwd, execute, isEveryPathIgnored)),
        ),
      ),
    ),
  );
}
