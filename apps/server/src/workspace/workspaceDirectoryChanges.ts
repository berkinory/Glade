import { watch, type FSWatcher } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  ProjectFileChangeEvent,
  ProjectWatchFileInput,
} from "@glade/contracts/workspace/project";
import { Cause, Effect, Queue, Stream } from "effect";
import { resolveRealPathForCreateWithinRoot } from "./realPathContainment";
import { WorkspaceFileWatchError } from "./workspaceFileChanges";

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function watchDirectory(
  cwd: string,
  relativePath: string,
  emit: () => void,
  fail: (error: unknown) => void,
): Promise<() => void> {
  let disposed = false;
  let watchers: FSWatcher[] = [];
  let requested = false;
  let running: Promise<void> | null = null;
  const closeWatchers = () => {
    const previous = watchers;
    watchers = [];
    for (const watcher of previous) watcher.close();
  };
  const close = () => {
    disposed = true;
    closeWatchers();
  };
  const arm = async () => {
    closeWatchers();
    const target = await resolveRealPathForCreateWithinRoot(cwd, path.resolve(cwd, relativePath));
    if (target === null) throw new Error("Directory is outside the workspace.");
    let parent = path.dirname(target);
    while (
      !(await fs.stat(parent).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      }))
    ) {
      const ancestor = path.dirname(parent);
      if (ancestor === parent) throw new Error("Workspace parent is unavailable.");
      parent = ancestor;
    }
    if (disposed) return;
    const nextComponent = path.relative(parent, target).split(path.sep)[0];
    const parentWatcher = watch(parent, (_event, filename) => {
      if (filename !== null && filename.toString() !== nextComponent) return;
      emit();
      void rearm().catch(fail);
    });
    parentWatcher.on("error", fail);
    watchers.push(parentWatcher);
    const stat = await fs.stat(target).catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    });
    if (disposed) return;
    if (stat && !stat.isDirectory()) throw new Error("The watched entry is no longer a folder.");
    if (stat) {
      const watcher = watch(target, (_event, filename) => {
        if (filename?.toString() !== ".git") emit();
      });
      watcher.on("error", fail);
      watchers.push(watcher);
    }
    emit();
  };
  const rearm = (): Promise<void> => {
    requested = true;
    if (running) return running;
    running = (async () => {
      while (requested) {
        if (disposed) break;
        requested = false;
        await arm();
      }
    })().finally(() => {
      running = null;
    });
    return running;
  };
  try {
    await rearm();
    return close;
  } catch (error) {
    close();
    throw error;
  }
}

export function watchWorkspaceDirectories(input: ProjectWatchFileInput) {
  return Stream.callback<ProjectFileChangeEvent, WorkspaceFileWatchError>((queue) =>
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const cleanups: (() => void)[] = [];
          const timers = new Map<string, ReturnType<typeof setTimeout>>();
          let disposed = false;
          const close = () => {
            disposed = true;
            for (const timer of timers.values()) clearTimeout(timer);
            for (const cleanup of cleanups) cleanup();
          };
          const fail = (cause: unknown) => {
            if (!disposed)
              Queue.failCauseUnsafe(
                queue,
                Cause.fail(new WorkspaceFileWatchError("watch", input.cwd, cause)),
              );
          };
          const emit = (relativePath: string) => {
            if (disposed || timers.has(relativePath)) return;
            timers.set(
              relativePath,
              setTimeout(() => {
                timers.delete(relativePath);
                Queue.offerUnsafe(queue, { type: "changed", relativePath, mtimeMs: Date.now() });
              }, 100),
            );
          };
          try {
            for (const relativePath of new Set(input.directoryPaths)) {
              cleanups.push(
                await watchDirectory(input.cwd, relativePath, () => emit(relativePath), fail),
              );
            }
            return close;
          } catch (error) {
            close();
            throw error;
          }
        },
        catch: (cause) => new WorkspaceFileWatchError("watch", input.cwd, cause),
      }),
      (close) => Effect.sync(close),
    ).pipe(Effect.asVoid),
  );
}
