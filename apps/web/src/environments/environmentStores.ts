import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { StoreApi } from "zustand";
import type { AppStore } from "../appStore";
import { activeEnvironment } from "./activeEnvironment";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "./environmentKey";

// The data store of every environment the window shows. The local store is registered once at
// startup; SSH host stores come and go with saved hosts.
const stores = new Map<EnvironmentKey, StoreApi<AppStore>>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyArray<readonly [EnvironmentKey, StoreApi<AppStore>]> = [];

function publish(): void {
  snapshot = [...stores.entries()];
  for (const listener of listeners) listener();
}

export function registerEnvironmentStore(key: EnvironmentKey, store: StoreApi<AppStore>): void {
  stores.set(key, store);
  publish();
}

export function unregisterEnvironmentStore(key: EnvironmentKey): void {
  if (key === LOCAL_ENVIRONMENT || !stores.delete(key)) return;
  publish();
}

export function environmentStoreEntries(): ReadonlyArray<
  readonly [EnvironmentKey, StoreApi<AppStore>]
> {
  return snapshot;
}

export function environmentStore(key: EnvironmentKey): StoreApi<AppStore> | null {
  return stores.get(key) ?? null;
}

export function subscribeEnvironmentStores(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Thread and project ids are UUIDs, so at most one environment owns each.
export function environmentOfThread(threadId: ThreadId): EnvironmentKey | null {
  for (const [key, store] of snapshot) {
    if (store.getState().threadShellById?.[threadId] !== undefined) return key;
  }
  return null;
}

export function environmentOfProject(projectId: ProjectId): EnvironmentKey | null {
  for (const [key, store] of snapshot) {
    if (store.getState().projects.some((project) => project.id === projectId)) return key;
  }
  return null;
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
}

// A path belongs to the environment whose project or worktree root contains it most specifically.
// Two hosts can share a path such as ~/code/app, so ties go to the chat on screen.
export function environmentOfPath(path: unknown): EnvironmentKey {
  if (typeof path !== "string" || path.length === 0) return activeEnvironment();
  const active = activeEnvironment();
  let best: { key: EnvironmentKey; length: number } | null = null;
  for (const [key, store] of environmentStoreEntries()) {
    const state = store.getState();
    const roots = [
      ...state.projects.map((project) => project.cwd),
      ...Object.values(state.threadShellById ?? {}).flatMap((thread) =>
        thread.worktreePath ? [thread.worktreePath] : [],
      ),
    ];
    for (const root of roots) {
      if (!isWithin(path, root)) continue;
      const better =
        best === null ||
        root.length > best.length ||
        (root.length === best.length && key === active);
      if (better) best = { key, length: root.length };
    }
  }
  return best?.key ?? active;
}
