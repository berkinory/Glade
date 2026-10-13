import { type FSWatcher, watch } from "node:fs";
import * as path from "node:path";
import { Cause, Duration, Effect, Queue, Stream } from "effect";

// Gathers a burst of create/delete/move events into one relisting.
const RESYNC_DELAY = Duration.seconds(1);

export interface DirectoryTreeWatch<E> {
  readonly root: string;
  /** Directories to watch relative to the root with `/` separators; "" is the root itself. */
  readonly listDirectories: Effect.Effect<ReadonlySet<string>, E>;
  /** Receives the changed path relative to the root, or null when unknown. */
  readonly accept: (name: string | null) => boolean;
  /** Whether editing this file can change the listing, beyond directories appearing or vanishing. */
  readonly affectsListing: (name: string) => boolean;
  readonly watchError: (directory: string, cause: unknown) => E;
}

function isVanished(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Watches every listed directory without recursion and relists after structural changes. Emits
 * once after the initial watchers are in place, then whenever `accept` takes an event.
 */
export function watchDirectoryTree<E>(options: DirectoryTreeWatch<E>): Stream.Stream<void, E> {
  const { root, listDirectories, accept, affectsListing, watchError } = options;
  return Stream.callback<void, E>(
    (queue) =>
      Effect.gen(function* () {
        const watchers = new Map<string, FSWatcher>();
        const resync = yield* Queue.sliding<void>(1);
        const unwatch = (directory: string, watcher = watchers.get(directory)) => {
          if (watcher === undefined || watchers.get(directory) !== watcher) return;
          watcher.close();
          watchers.delete(directory);
        };
        // A watch dies with its directory, so a recreated directory needs a new one.
        const unwatchTree = (directory: string) => {
          for (const watched of [...watchers.keys()]) {
            if (watched === directory || watched.startsWith(`${directory}/`)) unwatch(watched);
          }
        };
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            for (const directory of [...watchers.keys()]) unwatch(directory);
          }),
        );

        const open = (directory: string): FSWatcher | null => {
          const absolute = path.join(root, directory);
          const prefix = directory === "" ? "" : `${directory}/`;
          let watcher: FSWatcher;
          try {
            watcher = watch(absolute, (event, filename) => {
              const name = filename === null ? null : prefix + filename;
              if (event === "rename" && name !== null && watchers.has(name)) unwatchTree(name);
              if (event === "rename" || name === null || affectsListing(name))
                Queue.offerUnsafe(resync, undefined);
              if (accept(name)) Queue.offerUnsafe(queue, undefined);
            });
          } catch (cause) {
            // Listings race deletions; only the root must exist.
            if (directory !== "" && isVanished(cause)) return null;
            throw cause;
          }
          watcher.on("error", (cause) => {
            if (directory === "" || !isVanished(cause)) {
              Queue.failCauseUnsafe(queue, Cause.fail(watchError(absolute, cause)));
              return;
            }
            unwatch(directory, watcher);
            Queue.offerUnsafe(resync, undefined);
          });
          return watcher;
        };

        const synchronize = Effect.gen(function* () {
          const directories = yield* listDirectories;
          for (const directory of [...watchers.keys()]) {
            if (!directories.has(directory)) unwatch(directory);
          }
          let added = false;
          for (const directory of directories) {
            if (watchers.has(directory)) continue;
            const watcher = yield* Effect.try({
              try: () => open(directory),
              catch: (cause) => watchError(path.join(root, directory), cause),
            });
            if (watcher === null) continue;
            watchers.set(directory, watcher);
            added = true;
          }
          return added;
        });

        yield* synchronize;
        // Revalidate after establishing the watchers to close the snapshot-before-watch race.
        Queue.offerUnsafe(queue, undefined);
        return yield* Queue.take(resync).pipe(
          Effect.andThen(Effect.sleep(RESYNC_DELAY)),
          Effect.andThen(Queue.clear(resync)),
          Effect.andThen(synchronize),
          // Changes inside a new directory before its watcher existed were never reported.
          Effect.tap((added) =>
            Effect.sync(() => {
              if (added && accept(null)) Queue.offerUnsafe(queue, undefined);
            }),
          ),
          Effect.forever,
        );
        // A failure inside the forked callback effect does not reach the stream on its own.
      }).pipe(Effect.catch((error) => Queue.fail(queue, error))),
    { bufferSize: 1, strategy: "sliding" },
  );
}
