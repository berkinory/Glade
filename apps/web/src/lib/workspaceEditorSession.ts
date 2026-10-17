import type { ProjectReadFileResult } from "@glade/contracts/workspace/project";
import { isWorkspaceFileWriteConflictError } from "@glade/shared/workspace/workspaceFileWrite";
import type { QueryClient } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";
import { refreshGitAfterFileWrite } from "./gitQueryOptions";
import { projectQueryKeys, projectReadFileQueryOptions } from "./projectReactQuery";
import {
  INITIAL_WORKSPACE_FILE_EDITOR_STATE,
  isWorkspaceFileEditorDirty,
  resolveWorkspaceFileEditorFormat,
  workspaceFileEditorKey,
  workspaceFileEditorReducer,
  type WorkspaceFileEditorAction,
} from "./workspaceFileEditor";

const sessions = new WeakMap<QueryClient, Map<string, WorkspaceEditorSession>>();
const dirtyListeners = new WeakMap<QueryClient, Set<() => void>>();
const dirtyRevisions = new WeakMap<QueryClient, number>();

function notifyDirtyEditors(client: QueryClient) {
  dirtyRevisions.set(client, (dirtyRevisions.get(client) ?? 0) + 1);
  for (const listener of dirtyListeners.get(client) ?? []) listener();
}

export function subscribeDirtyWorkspaceEditors(client: QueryClient, listener: () => void) {
  let listeners = dirtyListeners.get(client);
  if (!listeners) {
    listeners = new Set();
    dirtyListeners.set(client, listeners);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dirtyWorkspaceEditorRevision(client: QueryClient) {
  return dirtyRevisions.get(client) ?? 0;
}

export function dirtyWorkspaceEditorPaths(client: QueryClient, cwd: string): ReadonlySet<string> {
  return new Set(
    [...(sessions.get(client)?.values() ?? [])]
      .filter((session) => session.cwd === cwd && session.dirty)
      .map((session) => session.relativePath),
  );
}

class WorkspaceEditorSession {
  private state = INITIAL_WORKSPACE_FILE_EDITOR_STATE;
  private listeners = new Set<() => void>();
  private writing: Promise<boolean> | undefined;
  private paused = false;
  private editGeneration = 0;

  constructor(
    private readonly client: QueryClient,
    readonly cwd: string,
    readonly relativePath: string,
    private readonly release: () => void,
  ) {}

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      queueMicrotask(() => this.releaseIfUnused());
    };
  };

  private releaseIfUnused() {
    if (this.listeners.size === 0 && !this.writing && !this.dirty) this.release();
  }

  get saving() {
    return this.writing !== undefined;
  }

  get dirty() {
    return isWorkspaceFileEditorDirty(this.state);
  }

  private dispatch(action: WorkspaceFileEditorAction) {
    const next = workspaceFileEditorReducer(this.state, action);
    if (next === this.state) return;
    const wasDirty = this.dirty;
    this.state = next;
    for (const listener of this.listeners) listener();
    if (wasDirty !== this.dirty) notifyDirtyEditors(this.client);
  }

  load(file: ProjectReadFileResult) {
    const format = resolveWorkspaceFileEditorFormat(file);
    if (!format || this.writing) return;
    this.dispatch({
      type: "loaded",
      key: workspaceFileEditorKey(this.cwd, this.relativePath)!,
      contents: file.contents,
      format,
    });
  }

  change = (value: string) => {
    this.editGeneration += 1;
    this.dispatch({ type: "changed", value });
  };

  pause = () => {
    this.paused = true;
  };

  resume = () => {
    this.paused = false;
  };

  flush = (overwrite = false): Promise<boolean> => {
    if (this.writing) return this.writing;
    if (this.paused) return Promise.resolve(!this.dirty);
    if (!this.dirty) return Promise.resolve(true);
    this.writing = Promise.resolve()
      .then(async () => {
        let guarded = !overwrite;
        while (this.dirty) {
          const { value, format } = this.state;
          if (!format) return false;
          this.dispatch({ type: "saveStarted" });
          try {
            const result = await ensureNativeApi().projects.writeFile({
              cwd: this.cwd,
              relativePath: this.relativePath,
              contents: value,
              encoding: format.encoding,
              lineEnding: format.lineEnding,
              ...(guarded ? { expectedVersion: format.expectedVersion } : {}),
            });

            this.client.removeQueries({
              queryKey: projectQueryKeys.prefetchFile(this.cwd, this.relativePath),
              exact: true,
            });
            const queries = this.client.getQueryCache().findAll({
              queryKey: ["projects", "read-file", this.cwd],
              predicate: (query) =>
                query.queryKey[3] === this.relativePath ||
                (query.state.data as ProjectReadFileResult | undefined)?.relativePath ===
                  this.relativePath,
            });
            await Promise.all(
              queries.map((query) =>
                this.client.cancelQueries({ queryKey: query.queryKey, exact: true }),
              ),
            );
            for (const query of queries) {
              this.client.setQueryData<ProjectReadFileResult>(query.queryKey, (previous) =>
                previous ? { ...previous, contents: value, version: result.version } : previous,
              );
            }
            this.dispatch({
              type: "saveSucceeded",
              contents: value,
              expectedVersion: result.version,
            });
            // Git latency or refresh failure must never change a successful save into a failed write. Existing
            // refresh queues serialize detail reads.
            void refreshGitAfterFileWrite(this.client, this.cwd).catch(() => undefined);
            guarded = true;
          } catch (error) {
            this.dispatch({
              type: "saveFailed",
              message: error instanceof Error ? error.message : "Could not save the file.",
              conflict: isWorkspaceFileWriteConflictError(error),
            });
            return false;
          }
        }
        return true;
      })
      .finally(() => {
        this.writing = undefined;
        this.releaseIfUnused();
      });
    return this.writing;
  };

  reload = async () => {
    this.pause();
    if (this.writing) await this.writing;
    const generation = this.editGeneration;
    try {
      const queryKey = projectQueryKeys.readFile(this.cwd, this.relativePath);
      await this.client.cancelQueries({ queryKey, exact: true });
      const file = await this.client.fetchQuery({
        ...projectReadFileQueryOptions({ cwd: this.cwd, relativePath: this.relativePath }),
        staleTime: 0,
      });
      const format = resolveWorkspaceFileEditorFormat(file);
      if (generation === this.editGeneration && format) {
        this.dispatch({
          type: "reloaded",
          key: workspaceFileEditorKey(this.cwd, this.relativePath)!,
          contents: file.contents,
          format,
        });
      }
    } catch (error) {
      this.dispatch({
        type: "saveFailed",
        message: error instanceof Error ? error.message : "Could not reload the file.",
        conflict: false,
      });
    } finally {
      this.resume();
    }
  };

  save = () => {
    this.paused = false;
    void this.flush();
  };

  overwrite = () => {
    this.paused = false;
    void this.flush(true);
  };

  revert = () => {
    this.editGeneration += 1;
    this.dispatch({ type: "reverted" });
    this.releaseIfUnused();
  };

  discard = () => {
    this.dispatch({ type: "closed" });
    this.releaseIfUnused();
  };
}

export function getWorkspaceEditorSession(client: QueryClient, cwd: string, relativePath: string) {
  let entries = sessions.get(client);
  if (!entries) {
    entries = new Map();
    sessions.set(client, entries);
  }
  const key = workspaceFileEditorKey(cwd, relativePath)!;
  let session = entries.get(key);
  if (!session) {
    const ownedEntries = entries;
    session = new WorkspaceEditorSession(client, cwd, relativePath, () => {
      if (ownedEntries.get(key) === session) ownedEntries.delete(key);
    });
    entries.set(key, session);
  }
  return session;
}

// `paths` narrows the scope to those entries and everything below them; omitted, every file under
// `cwd` (or in every workspace when `cwd` is null) counts.
export interface WorkspaceEditorScope {
  readonly cwd: string | null;
  readonly paths?: readonly string[] | undefined;
}

function unsavedSessions(client: QueryClient, scope: WorkspaceEditorScope) {
  return [...(sessions.get(client)?.values() ?? [])].filter(
    (session) =>
      (session.dirty || session.saving) &&
      (scope.cwd === null || session.cwd === scope.cwd) &&
      (scope.paths === undefined ||
        scope.paths.some(
          (path) => session.relativePath === path || session.relativePath.startsWith(`${path}/`),
        )),
  );
}

export function unsavedWorkspaceEditorPaths(
  client: QueryClient,
  scope: WorkspaceEditorScope,
): string[] {
  return unsavedSessions(client, scope).map((session) => session.relativePath);
}

export async function saveWorkspaceEditors(client: QueryClient, scope: WorkspaceEditorScope) {
  const results = await Promise.all(
    unsavedSessions(client, scope).map((session) => {
      session.resume();
      return session.flush();
    }),
  );
  return results.every(Boolean);
}

export function revertWorkspaceEditors(client: QueryClient, scope: WorkspaceEditorScope) {
  for (const session of unsavedSessions(client, scope)) session.revert();
}

export function discardWorkspaceEditors(client: QueryClient, scope: WorkspaceEditorScope) {
  for (const session of unsavedSessions(client, scope)) session.discard();
}

export function hasUnsavedWorkspaceEditors(client: QueryClient, cwd?: string | null) {
  return unsavedSessions(client, { cwd: cwd ?? null }).length > 0;
}
