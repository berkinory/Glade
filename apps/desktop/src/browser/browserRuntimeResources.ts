import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import type { BrowserAnnotationRuntime } from "./annotations/coordinator";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import {
  BrowserPerformanceSnapshot,
  BROWSER_AUTOMATION_RUNTIME_USE_GRACE_MS,
  BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS,
  BROWSER_INACTIVE_TAB_SUSPEND_DELAY_PRESSURED_MS,
  BROWSER_MAX_BACKGROUND_AUTOMATION_RUNTIMES,
  BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD,
  BROWSER_THREAD_SUSPEND_DELAY_MS,
  cloneThreadState,
  defaultThreadBrowserState,
  LiveTabRuntime,
  PendingRuntimeSync,
  buildRuntimeKey,
  suspendTabState,
  syncThreadLastError,
} from "./browserTabState";

export function createBrowserRuntimeResources(
  hostRuntime: Pick<
    BrowserRuntime,
    | "lifecycle"
    | "budget"
    | "live"
    | "tabs"
    | "view"
    | "isEmbeddedPopupFamily"
    | "getTab"
    | "emitState"
    | "services"
    | "syncRuntimeState"
    | "closeEmbeddedPopup"
    | "clearPendingWindowOpenTask"
    | "setRuntimePageZoomFactor"
    | "hasAutomationDownloadTracking"
    | "clearAutomationRuntimeTracking"
    | "clearAutomationState"
    | "detachAttachedRuntime"
    | "setRuntimeViewHidden"
    | "closeAllPopupWindows"
    | "clearAllPendingWindowOpenTasks"
  >,
) {
  function dispose(): void {
    hostRuntime.lifecycle.disposed = true;
    hostRuntime.services.annotations.dispose();
    hostRuntime.services.sessionPolicy.dispose();
    hostRuntime.clearAllPendingWindowOpenTasks();
    for (const timer of hostRuntime.budget.suspendTimers.values()) {
      clearTimeout(timer);
    }
    hostRuntime.budget.suspendTimers.clear();
    for (const timer of hostRuntime.budget.tabSuspendTimers.values()) {
      clearTimeout(timer);
    }
    hostRuntime.budget.tabSuspendTimers.clear();
    if (hostRuntime.budget.backgroundAutomationEvictionTimer !== null) {
      clearTimeout(hostRuntime.budget.backgroundAutomationEvictionTimer);
      hostRuntime.budget.backgroundAutomationEvictionTimer = null;
    }
    hostRuntime.detachAttachedRuntime();
    destroyAllRuntimes();
    hostRuntime.closeAllPopupWindows();
    hostRuntime.live.pendingRuntimeSyncs.clear();
    hostRuntime.budget.runtimeLastActiveAtByKey.clear();
    hostRuntime.live.rendererOnlyRuntimeKeys.clear();
    hostRuntime.live.automationRuntimeKeys.clear();
    hostRuntime.budget.automationRuntimeProtectedUntilByKey.clear();
    hostRuntime.tabs.listeners.clear();
    hostRuntime.tabs.copyLinkListeners.clear();
    hostRuntime.tabs.states.clear();
    hostRuntime.tabs.previewThreadIds.clear();
    hostRuntime.tabs.threadVersionById.clear();
    hostRuntime.tabs.snapshotCacheByThreadId.clear();
    hostRuntime.tabs.lastEmittedVersionByThreadId.clear();
    hostRuntime.clearAutomationState();
    hostRuntime.live.runtimePageZoomFactors.clear();
    hostRuntime.view.window = null;
    hostRuntime.view.activeThreadId = null;
    hostRuntime.view.activeBounds = null;
    hostRuntime.view.activeBoundsThreadId = null;
    hostRuntime.view.activePageZoomFactor = 1;
    hostRuntime.view.activePageZoomThreadId = null;
    hostRuntime.view.attachedBoundsSignature = null;
    hostRuntime.live.runtimeSyncFlushScheduled = false;
  }

  function queueRuntimeStateSync(threadId: ThreadId, tabId: string, faviconUrls?: string[]): void {
    const key = buildRuntimeKey(threadId, tabId);
    const existing = hostRuntime.live.pendingRuntimeSyncs.get(key);
    const nextPendingSync: PendingRuntimeSync = {
      threadId,
      tabId,
    };
    const nextFaviconUrls = faviconUrls ?? existing?.faviconUrls;
    if (nextFaviconUrls !== undefined) {
      nextPendingSync.faviconUrls = nextFaviconUrls;
    }
    hostRuntime.live.pendingRuntimeSyncs.set(key, nextPendingSync);

    if (hostRuntime.live.runtimeSyncFlushScheduled) {
      return;
    }

    hostRuntime.live.runtimeSyncFlushScheduled = true;
    queueMicrotask(() => {
      hostRuntime.live.runtimeSyncFlushScheduled = false;
      if (hostRuntime.live.pendingRuntimeSyncs.size === 0) {
        return;
      }

      hostRuntime.budget.perfCounters.runtimeSyncQueueFlushes += 1;
      const pendingSyncs = [...hostRuntime.live.pendingRuntimeSyncs.values()];
      hostRuntime.live.pendingRuntimeSyncs.clear();
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
    const state = hostRuntime.tabs.states.get(threadId);
    if (!state) {
      return;
    }

    for (const tab of state.tabs) {
      destroyRuntime(threadId, tab.id);
    }
  }

  function destroyAllRuntimes(): void {
    for (const runtime of hostRuntime.live.runtimes.values()) {
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
    for (const child of [...hostRuntime.live.runtimes.values()]) {
      if (child.threadId === threadId && child.popupOpenerTabId === tabId) {
        hostRuntime.closeEmbeddedPopup(child);
      }
    }
    const preserveAutomationDownloadTracking =
      options.preserveAutomationDownloadTracking === true &&
      hostRuntime.hasAutomationDownloadTracking(key);
    hostRuntime.clearPendingWindowOpenTask(threadId, tabId);
    clearTabSuspendTimer(threadId, tabId);
    hostRuntime.live.pendingRuntimeSyncs.delete(key);
    hostRuntime.budget.runtimeLastActiveAtByKey.delete(key);
    hostRuntime.budget.automationRuntimeProtectedUntilByKey.delete(key);
    hostRuntime.clearAutomationRuntimeTracking(key, preserveAutomationDownloadTracking);
    const runtime = hostRuntime.live.runtimes.get(key);
    if (!runtime) {
      return;
    }

    hostRuntime.setRuntimePageZoomFactor(runtime, 1);
    hostRuntime.services.annotations.handleRuntimeDetached(
      threadId,
      tabId,
      runtime.webContents.id,
      options.annotationReason ?? (runtime.webContents.isDestroyed() ? "destroyed" : "detached"),
    );

    if (hostRuntime.view.attachedRuntimeKey === key) {
      hostRuntime.detachAttachedRuntime();
    }

    // Bookkeeping should normally identify the attached native view, but an interrupted renderer
    // transition must not be able to leave an untracked WebContentsView over the canonical renderer
    // WebView.
    if (runtime.view && hostRuntime.view.window) {
      hostRuntime.setRuntimeViewHidden(runtime, true);
      try {
        hostRuntime.view.window.contentView.removeChildView(runtime.view);
      } catch {}
    }

    hostRuntime.live.runtimes.delete(key);
    hostRuntime.live.runtimePageZoomFactors.delete(key);
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
    for (const runtime of hostRuntime.live.runtimes.values()) {
      if (!runtime.ownsWebContents && runtime.webContents.id === webContentsId) {
        return runtime;
      }
    }
    return null;
  }

  function findRuntimeByWebContentsId(webContentsId: number): LiveTabRuntime | null {
    for (const runtime of hostRuntime.live.runtimes.values()) {
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
    const existing = hostRuntime.tabs.states.get(threadId);
    if (existing) {
      return existing;
    }

    const initial = defaultThreadBrowserState(threadId);
    hostRuntime.tabs.states.set(threadId, initial);
    hostRuntime.tabs.threadVersionById.set(threadId, 0);
    return initial;
  }

  function markThreadStateChanged(threadId: ThreadId): void {
    const nextVersion = (hostRuntime.tabs.threadVersionById.get(threadId) ?? 0) + 1;
    hostRuntime.tabs.threadVersionById.set(threadId, nextVersion);
    const state = hostRuntime.tabs.states.get(threadId);
    if (state) {
      state.version = nextVersion;
    }
  }

  function snapshotThreadState(
    threadId: ThreadId,
    state = getOrCreateState(threadId),
  ): ThreadBrowserState {
    const version = state.version;
    const cached = hostRuntime.tabs.snapshotCacheByThreadId.get(threadId);
    if (cached && cached.version === version) {
      return cached.snapshot;
    }

    const snapshot = cloneThreadState(state);
    hostRuntime.budget.perfCounters.stateCloneCount += 1;
    hostRuntime.tabs.snapshotCacheByThreadId.set(threadId, {
      version,
      snapshot,
    });
    return snapshot;
  }

  function getPerformanceSnapshot(): BrowserPerformanceSnapshot {
    hostRuntime.budget.perfCounters.warmInactiveRuntimeCount = countWarmInactiveRuntimes();
    return {
      counters: { ...hostRuntime.budget.perfCounters },
      trackedProcessIds: getTrackedProcessIds(),
    };
  }

  function noteAutomationRuntimeUse(key: string): void {
    const now = Date.now();
    hostRuntime.budget.runtimeLastActiveAtByKey.set(key, now);
    hostRuntime.budget.automationRuntimeProtectedUntilByKey.set(
      key,
      now + BROWSER_AUTOMATION_RUNTIME_USE_GRACE_MS,
    );
    enforceBackgroundAutomationRuntimeBudget();
  }

  function enforceBackgroundAutomationRuntimeBudget(): void {
    if (hostRuntime.lifecycle.disposed) return;
    if (hostRuntime.budget.backgroundAutomationEvictionTimer !== null) {
      clearTimeout(hostRuntime.budget.backgroundAutomationEvictionTimer);
      hostRuntime.budget.backgroundAutomationEvictionTimer = null;
    }

    const popupOwnerRuntimeKeys = new Set(
      [...hostRuntime.live.popupRuntimes.values()].map((popup) =>
        buildRuntimeKey(popup.threadId, popup.tabId),
      ),
    );
    const backgroundRuntimes = [...hostRuntime.live.runtimes.values()].filter(
      (runtime) =>
        runtime.ownsWebContents &&
        runtime.key !== hostRuntime.view.attachedRuntimeKey &&
        !hostRuntime.isEmbeddedPopupFamily(runtime.threadId, runtime.tabId) &&
        !popupOwnerRuntimeKeys.has(runtime.key) &&
        hostRuntime.live.automationRuntimeKeys.has(runtime.key),
    );
    let excess = backgroundRuntimes.length - BROWSER_MAX_BACKGROUND_AUTOMATION_RUNTIMES;
    if (excess <= 0) return;

    const now = Date.now();
    const evictionCandidates = backgroundRuntimes
      .filter(
        (runtime) =>
          (hostRuntime.budget.automationRuntimeProtectedUntilByKey.get(runtime.key) ?? 0) <= now,
      )
      .toSorted(
        (left, right) =>
          (hostRuntime.budget.runtimeLastActiveAtByKey.get(left.key) ?? 0) -
          (hostRuntime.budget.runtimeLastActiveAtByKey.get(right.key) ?? 0),
      );
    const changedThreadIds = new Set<ThreadId>();

    for (const runtime of evictionCandidates) {
      if (excess <= 0) break;
      const state = hostRuntime.tabs.states.get(runtime.threadId);
      const tab = state ? hostRuntime.getTab(state, runtime.tabId) : null;
      destroyRuntime(runtime.threadId, runtime.tabId);
      if (state && tab) {
        const didChange = suspendTabState(tab);
        if (syncThreadLastError(state) || didChange) {
          changedThreadIds.add(runtime.threadId);
        }
      }
      excess -= 1;
      hostRuntime.budget.perfCounters.inactiveTabBudgetEvictions += 1;
    }

    for (const threadId of changedThreadIds) {
      markThreadStateChanged(threadId);
      hostRuntime.emitState(threadId);
    }

    if (excess <= 0) return;
    const nextProtectionExpiry = backgroundRuntimes
      .map(
        (runtime) => hostRuntime.budget.automationRuntimeProtectedUntilByKey.get(runtime.key) ?? 0,
      )
      .filter((protectedUntil) => protectedUntil > now)
      .toSorted((left, right) => left - right)[0];
    if (nextProtectionExpiry === undefined) return;

    hostRuntime.budget.backgroundAutomationEvictionTimer = setTimeout(
      () => {
        hostRuntime.budget.backgroundAutomationEvictionTimer = null;
        enforceBackgroundAutomationRuntimeBudget();
      },
      Math.max(1, nextProtectionExpiry - now + 1),
    );
    hostRuntime.budget.backgroundAutomationEvictionTimer.unref();
  }

  function suspendInactiveTabs(threadId: ThreadId, activeTabId: string | null): boolean {
    const state = hostRuntime.tabs.states.get(threadId);
    if (!state) {
      return false;
    }

    let didChange = false;
    const inactiveRuntimeTabIds = state.tabs
      .filter((tab) => tab.id !== activeTabId)
      .filter((tab) => hostRuntime.live.runtimes.has(buildRuntimeKey(threadId, tab.id)))
      .toSorted((left, right) => {
        const leftKey = buildRuntimeKey(threadId, left.id);
        const rightKey = buildRuntimeKey(threadId, right.id);
        return (
          (hostRuntime.budget.runtimeLastActiveAtByKey.get(rightKey) ?? 0) -
          (hostRuntime.budget.runtimeLastActiveAtByKey.get(leftKey) ?? 0)
        );
      });
    const warmRuntimeTabIds = new Set(
      inactiveRuntimeTabIds
        .slice(0, BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD)
        .map((tab) => tab.id),
    );

    for (const tab of state.tabs) {
      if (tab.id === activeTabId || hostRuntime.isEmbeddedPopupFamily(threadId, tab.id)) {
        clearTabSuspendTimer(threadId, tab.id);
        continue;
      }

      const runtime = hostRuntime.live.runtimes.get(buildRuntimeKey(threadId, tab.id));
      if (runtime) {
        if (warmRuntimeTabIds.has(tab.id)) {
          scheduleInactiveTabSuspend(threadId, tab.id);
          continue;
        }

        hostRuntime.budget.perfCounters.inactiveTabBudgetEvictions += 1;
        destroyRuntime(threadId, tab.id);
        didChange = suspendTabState(tab) || didChange;
        continue;
      }

      didChange = suspendTabState(tab) || didChange;
    }

    return didChange;
  }

  function scheduleThreadSuspend(threadId: ThreadId): void {
    const state = hostRuntime.tabs.states.get(threadId);
    if (!state?.open || hostRuntime.view.activeThreadId === threadId) {
      return;
    }

    clearSuspendTimer(threadId);
    const timer = setTimeout(() => {
      suspendThread(threadId);
      hostRuntime.budget.suspendTimers.delete(threadId);
    }, BROWSER_THREAD_SUSPEND_DELAY_MS);
    timer.unref();
    hostRuntime.budget.suspendTimers.set(threadId, timer);
  }

  function suspendThread(threadId: ThreadId): void {
    const state = hostRuntime.tabs.states.get(threadId);
    if (!state || hostRuntime.view.activeThreadId === threadId) {
      return;
    }

    let didChange = false;
    for (const tab of state.tabs) {
      if (hostRuntime.isEmbeddedPopupFamily(threadId, tab.id)) continue;
      if (
        tab.id === state.activeTabId &&
        hostRuntime.live.automationRuntimeKeys.has(buildRuntimeKey(threadId, tab.id))
      ) {
        continue;
      }
      destroyRuntime(threadId, tab.id);
      didChange = suspendTabState(tab) || didChange;
    }

    didChange = syncThreadLastError(state) || didChange;
    if (didChange) {
      markThreadStateChanged(threadId);
      hostRuntime.emitState(threadId);
    }
    enforceBackgroundAutomationRuntimeBudget();
  }

  function clearSuspendTimer(threadId: ThreadId): void {
    const existing = hostRuntime.budget.suspendTimers.get(threadId);
    if (!existing) {
      return;
    }
    clearTimeout(existing);
    hostRuntime.budget.suspendTimers.delete(threadId);
  }

  function scheduleInactiveTabSuspend(threadId: ThreadId, tabId: string): void {
    if (hostRuntime.isEmbeddedPopupFamily(threadId, tabId)) return;
    const key = buildRuntimeKey(threadId, tabId);
    if (hostRuntime.budget.tabSuspendTimers.has(key)) {
      return;
    }

    hostRuntime.budget.perfCounters.inactiveTabSuspendScheduled += 1;
    const delayMs = resolveInactiveTabSuspendDelay(threadId);
    const timer = setTimeout(() => {
      hostRuntime.budget.tabSuspendTimers.delete(key);
      const state = hostRuntime.tabs.states.get(threadId);
      const tab = state ? hostRuntime.getTab(state, tabId) : null;
      if (!state || !tab) {
        return;
      }

      destroyRuntime(threadId, tabId);
      const didChange = suspendTabState(tab) || syncThreadLastError(state);
      if (didChange) {
        markThreadStateChanged(threadId);
        hostRuntime.emitState(threadId);
      }
    }, delayMs);
    timer.unref();
    hostRuntime.budget.tabSuspendTimers.set(key, timer);
  }

  function clearTabSuspendTimer(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId);
    const existing = hostRuntime.budget.tabSuspendTimers.get(key);
    if (!existing) {
      return;
    }

    clearTimeout(existing);
    hostRuntime.budget.tabSuspendTimers.delete(key);
    hostRuntime.budget.perfCounters.inactiveTabSuspendCancelled += 1;
  }

  function getTrackedProcessIds(): number[] {
    const processIds = new Set<number>();
    for (const runtime of hostRuntime.live.runtimes.values()) {
      const webContents = runtime.webContents;
      if (webContents.isDestroyed()) {
        continue;
      }
      processIds.add(webContents.getProcessId());
    }
    return [...processIds];
  }

  function countWarmInactiveRuntimes(): number {
    let count = 0;
    for (const [key] of hostRuntime.budget.tabSuspendTimers) {
      if (hostRuntime.live.runtimes.has(key)) {
        count += 1;
      }
    }
    return count;
  }

  function resolveInactiveTabSuspendDelay(threadId: ThreadId): number {
    const threadRuntimeCount = [...hostRuntime.live.runtimes.values()].filter(
      (runtime) => runtime.threadId === threadId,
    ).length;
    if (
      threadRuntimeCount > BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD + 1 ||
      hostRuntime.live.runtimes.size > 4
    ) {
      return BROWSER_INACTIVE_TAB_SUSPEND_DELAY_PRESSURED_MS;
    }

    return BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS;
  }

  return {
    dispose,
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
    getPerformanceSnapshot,
    noteAutomationRuntimeUse,
    enforceBackgroundAutomationRuntimeBudget,
    suspendInactiveTabs,
    scheduleThreadSuspend,
    clearSuspendTimer,
    clearTabSuspendTimer,
    getTrackedProcessIds,
    countWarmInactiveRuntimes,
  };
}
