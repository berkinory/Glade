import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import { type BrowserAnnotationRuntime } from "./annotations/coordinator";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import {
  buildRuntimeKey,
  cloneThreadState,
  defaultThreadBrowserState,
  LiveTabRuntime,
  PendingRuntimeSync,
} from "./browserTabState";

export function createBrowserRuntimeTeardown(
  hostRuntime: Pick<
    BrowserRuntime,
    | "pendingRuntimeSyncs"
    | "runtimeSyncFlushScheduled"
    | "perfCounters"
    | "syncRuntimeState"
    | "states"
    | "runtimes"
    | "closeEmbeddedPopup"
    | "automationDownloadListenersByRuntimeKey"
    | "automationSideEffectProvenanceByRuntimeKey"
    | "clearPendingWindowOpenTask"
    | "clearTabSuspendTimer"
    | "runtimeLastActiveAtByKey"
    | "automationRuntimeProtectedUntilByKey"
    | "expectedAutomationInputsByRuntimeKey"
    | "automationWindowOpenListenersByRuntimeKey"
    | "automationGestureDepthByRuntimeKey"
    | "setRuntimePageZoomFactor"
    | "annotations"
    | "attachedRuntimeKey"
    | "detachAttachedRuntime"
    | "window"
    | "setRuntimeViewHidden"
    | "runtimePageZoomFactors"
    | "threadVersionById"
    | "snapshotCacheByThreadId"
  >,
) {
  function queueRuntimeStateSync(threadId: ThreadId, tabId: string, faviconUrls?: string[]): void {
    const key = buildRuntimeKey(threadId, tabId);
    const existing = hostRuntime.pendingRuntimeSyncs.get(key);
    const nextPendingSync: PendingRuntimeSync = {
      threadId,
      tabId,
    };
    const nextFaviconUrls = faviconUrls ?? existing?.faviconUrls;
    if (nextFaviconUrls !== undefined) {
      nextPendingSync.faviconUrls = nextFaviconUrls;
    }
    hostRuntime.pendingRuntimeSyncs.set(key, nextPendingSync);

    if (hostRuntime.runtimeSyncFlushScheduled) {
      return;
    }

    hostRuntime.runtimeSyncFlushScheduled = true;
    queueMicrotask(() => {
      hostRuntime.runtimeSyncFlushScheduled = false;
      if (hostRuntime.pendingRuntimeSyncs.size === 0) {
        return;
      }

      hostRuntime.perfCounters.runtimeSyncQueueFlushes += 1;
      const pendingSyncs = [...hostRuntime.pendingRuntimeSyncs.values()];
      hostRuntime.pendingRuntimeSyncs.clear();
      for (const pendingSync of pendingSyncs) {
        hostRuntime.syncRuntimeState(
          pendingSync.threadId,
          pendingSync.tabId,
          pendingSync.faviconUrls,
        );
      }
    });
  }

  function destroyThreadRuntimes(threadId: ThreadId): void {
    const state = hostRuntime.states.get(threadId);
    if (!state) {
      return;
    }

    for (const tab of state.tabs) {
      destroyRuntime(threadId, tab.id);
    }
  }

  function destroyAllRuntimes(): void {
    for (const runtime of hostRuntime.runtimes.values()) {
      destroyRuntime(runtime.threadId, runtime.tabId);
    }
  }

  function destroyRuntime(
    threadId: ThreadId,
    tabId: string,
    options: {
      readonly preserveRendererDebugger?: boolean;
      readonly preserveAutomationDownloadTracking?: boolean;
      readonly annotationReason?: "detached" | "destroyed" | "replaced";
    } = {},
  ): void {
    const key = buildRuntimeKey(threadId, tabId);
    for (const child of [...hostRuntime.runtimes.values()]) {
      if (child.threadId === threadId && child.popupOpenerTabId === tabId) {
        hostRuntime.closeEmbeddedPopup(child);
      }
    }
    const preserveAutomationDownloadTracking =
      options.preserveAutomationDownloadTracking === true &&
      (hostRuntime.automationDownloadListenersByRuntimeKey.has(key) ||
        hostRuntime.automationSideEffectProvenanceByRuntimeKey.has(key));
    hostRuntime.clearPendingWindowOpenTask(threadId, tabId);
    hostRuntime.clearTabSuspendTimer(threadId, tabId);
    hostRuntime.pendingRuntimeSyncs.delete(key);
    hostRuntime.runtimeLastActiveAtByKey.delete(key);
    hostRuntime.automationRuntimeProtectedUntilByKey.delete(key);
    hostRuntime.expectedAutomationInputsByRuntimeKey.delete(key);
    hostRuntime.automationWindowOpenListenersByRuntimeKey.delete(key);
    if (!preserveAutomationDownloadTracking) {
      hostRuntime.automationGestureDepthByRuntimeKey.delete(key);
      hostRuntime.automationDownloadListenersByRuntimeKey.delete(key);
      hostRuntime.automationSideEffectProvenanceByRuntimeKey.delete(key);
    }
    const runtime = hostRuntime.runtimes.get(key);
    if (!runtime) {
      return;
    }

    hostRuntime.setRuntimePageZoomFactor(runtime, 1);
    hostRuntime.annotations.handleRuntimeDetached(
      threadId,
      tabId,
      runtime.webContents.id,
      options.annotationReason ?? (runtime.webContents.isDestroyed() ? "destroyed" : "detached"),
    );

    if (hostRuntime.attachedRuntimeKey === key) {
      hostRuntime.detachAttachedRuntime();
    }

    // Bookkeeping should normally identify the attached native view, but an interrupted renderer
    // transition must not be able to leave an untracked WebContentsView over the canonical renderer
    // WebView.
    if (runtime.view && hostRuntime.window) {
      hostRuntime.setRuntimeViewHidden(runtime, true);
      try {
        hostRuntime.window.contentView.removeChildView(runtime.view);
      } catch {}
    }

    hostRuntime.runtimes.delete(key);
    hostRuntime.runtimePageZoomFactors.delete(key);
    const webContents = runtime.webContents;
    for (const disposeListener of runtime.listenerDisposers.splice(0)) {
      disposeListener();
    }
    if (!webContents.isDestroyed()) {
      if (
        webContents.debugger.isAttached() &&
        (runtime.ownsWebContents || !options.preserveRendererDebugger)
      ) {
        try {
          webContents.debugger.detach();
        } catch {}
      }
      if (runtime.ownsWebContents) {
        webContents.close({ waitForBeforeUnload: false });
      }
    }
  }

  function findRendererRuntimeByWebContentsId(webContentsId: number): LiveTabRuntime | null {
    for (const runtime of hostRuntime.runtimes.values()) {
      if (!runtime.ownsWebContents && runtime.webContents.id === webContentsId) {
        return runtime;
      }
    }
    return null;
  }

  function findRuntimeByWebContentsId(webContentsId: number): LiveTabRuntime | null {
    for (const runtime of hostRuntime.runtimes.values()) {
      if (runtime.webContents.id === webContentsId) return runtime;
    }
    return null;
  }

  function toAnnotationRuntime(runtime: LiveTabRuntime | null): BrowserAnnotationRuntime | null {
    if (!runtime || runtime.webContents.isDestroyed()) return null;
    return {
      threadId: runtime.threadId,
      tabId: runtime.tabId,
      webContents: runtime.webContents,
    };
  }

  function getOrCreateState(threadId: ThreadId): ThreadBrowserState {
    const existing = hostRuntime.states.get(threadId);
    if (existing) {
      return existing;
    }

    const initial = defaultThreadBrowserState(threadId);
    hostRuntime.states.set(threadId, initial);
    hostRuntime.threadVersionById.set(threadId, 0);
    return initial;
  }

  function markThreadStateChanged(threadId: ThreadId): void {
    const nextVersion = (hostRuntime.threadVersionById.get(threadId) ?? 0) + 1;
    hostRuntime.threadVersionById.set(threadId, nextVersion);
    const state = hostRuntime.states.get(threadId);
    if (state) {
      state.version = nextVersion;
    }
  }

  function snapshotThreadState(
    threadId: ThreadId,
    state = getOrCreateState(threadId),
  ): ThreadBrowserState {
    const version = state.version;
    const cached = hostRuntime.snapshotCacheByThreadId.get(threadId);
    if (cached && cached.version === version) {
      return cached.snapshot;
    }

    const snapshot = cloneThreadState(state);
    hostRuntime.perfCounters.stateCloneCount += 1;
    hostRuntime.snapshotCacheByThreadId.set(threadId, {
      version,
      snapshot,
    });
    return snapshot;
  }

  return {
    queueRuntimeStateSync,
    destroyThreadRuntimes,
    destroyAllRuntimes,
    destroyRuntime,
    findRendererRuntimeByWebContentsId,
    findRuntimeByWebContentsId,
    toAnnotationRuntime,
    getOrCreateState,
    markThreadStateChanged,
    snapshotThreadState,
  };
}
