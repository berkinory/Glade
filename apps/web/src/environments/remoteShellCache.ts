import { OrchestrationShellSnapshot } from "@glade/contracts/orchestration/snapshots";
import { Schema } from "effect";
import type { StoreApi } from "zustand";
import type { AppStore } from "../appStore";
import { appStorage } from "../lib/storage";
import { initialState } from "../storeState";
import type { EnvironmentKey } from "./environmentKey";

const decodeSnapshot = Schema.decodeUnknownSync(OrchestrationShellSnapshot);

// Persist only navigation metadata. Sessions, approvals, messages and resume cursors must come
// from the live host, never from a previous launch.
function navigationSnapshot(state: AppStore): OrchestrationShellSnapshot {
  return decodeSnapshot({
    snapshotSequence: 0,
    spaces: [],
    projects: state.projects.map((project) => ({
      id: project.id,
      kind: project.kind,
      title: project.remoteName,
      workspaceRoot: project.cwd,
      defaultModelSelection: project.defaultModelSelection,
      isPinned: project.isPinned,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })),
    threads: Object.values(state.threadShellById ?? {}).map((thread) => ({
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      envMode: thread.envMode,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      workingDirectory: thread.workingDirectory,
      isPinned: thread.isPinned,
      parentThreadId: thread.parentThreadId,
      creationSource: thread.creationSource,
      archivedAt: thread.archivedAt,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      latestUserMessageAt: thread.latestUserMessageAt,
      latestHumanMessageAt: thread.latestHumanMessageAt,
      session: null,
      latestTurn: null,
      handoff: null,
    })),
    updatedAt: new Date().toISOString(),
  });
}

export interface RemoteShellCache {
  clear(): void;
  dispose(): void;
}

export function attachRemoteShellCache(
  environmentKey: EnvironmentKey,
  store: StoreApi<AppStore>,
): RemoteShellCache {
  const key = `glade:remote-shell:v1:${environmentKey}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  function remove(): void {
    try {
      appStorage.removeItem(key);
    } catch (error) {
      console.warn("Could not remove cached remote project list", error);
    }
  }

  try {
    const raw = appStorage.getItem(key);
    if (raw !== null) {
      const cached = decodeSnapshot(JSON.parse(raw));
      store.getState().syncServerShellSnapshot({ ...cached, snapshotSequence: 0 });
      // A cache is not hydration: authoritative snapshots (including an empty host) must still
      // replace it, and missing cached threads must not prune local pins or drafts.
      store.setState({ threadsHydrated: false, shellSnapshotSequence: 0 });
    }
  } catch (error) {
    console.warn("Could not restore cached remote project list", error);
    remove();
  }

  function flush(): void {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    const state = store.getState();
    if (!state.threadsHydrated) return;
    try {
      appStorage.setItem(key, JSON.stringify(navigationSnapshot(state)));
    } catch (error) {
      console.warn("Could not cache remote project list", error);
    }
  }

  const unsubscribe = store.subscribe((state, previous) => {
    if (
      !state.threadsHydrated ||
      (state.projects === previous.projects &&
        state.threadShellById === previous.threadShellById &&
        state.threadsHydrated === previous.threadsHydrated)
    )
      return;
    dirty = true;
    // Bound writes even during continuous updates, without serializing on every streamed token.
    timer ??= setTimeout(flush, 500);
  });
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush();
  };
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
  document.addEventListener("visibilitychange", onVisibility);

  return {
    clear() {
      clearTimeout(timer);
      timer = undefined;
      dirty = false;
      remove();
      store.setState(initialState);
    },
    dispose() {
      flush();
      unsubscribe();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
