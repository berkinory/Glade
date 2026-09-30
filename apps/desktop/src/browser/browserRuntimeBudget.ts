import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import {
  BROWSER_AUTOMATION_RUNTIME_USE_GRACE_MS,
  BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS,
  BROWSER_INACTIVE_TAB_SUSPEND_DELAY_PRESSURED_MS,
  BROWSER_MAX_BACKGROUND_AUTOMATION_RUNTIMES,
  BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD,
  BROWSER_THREAD_SUSPEND_DELAY_MS,
  buildRuntimeKey,
  suspendTabState,
  syncThreadLastError,
} from "./browserTabState";

export function createBrowserRuntimeBudget(
  hostRuntime: Pick<
    BrowserRuntime,
    | "runtimeLastActiveAtByKey"
    | "automationRuntimeProtectedUntilByKey"
    | "disposed"
    | "backgroundAutomationEvictionTimer"
    | "popupRuntimes"
    | "runtimes"
    | "attachedRuntimeKey"
    | "isEmbeddedPopupFamily"
    | "automationRuntimeKeys"
    | "states"
    | "getTab"
    | "destroyRuntime"
    | "perfCounters"
    | "markThreadStateChanged"
    | "emitState"
    | "activeThreadId"
    | "suspendTimers"
    | "tabSuspendTimers"
  >,
) {
  function noteAutomationRuntimeUse(key: string): void {
    const now = Date.now();
    hostRuntime.runtimeLastActiveAtByKey.set(key, now);
    hostRuntime.automationRuntimeProtectedUntilByKey.set(
      key,
      now + BROWSER_AUTOMATION_RUNTIME_USE_GRACE_MS,
    );
    enforceBackgroundAutomationRuntimeBudget();
  }

  function enforceBackgroundAutomationRuntimeBudget(): void {
    if (hostRuntime.disposed) return;
    if (hostRuntime.backgroundAutomationEvictionTimer !== null) {
      clearTimeout(hostRuntime.backgroundAutomationEvictionTimer);
      hostRuntime.backgroundAutomationEvictionTimer = null;
    }

    const popupOwnerRuntimeKeys = new Set(
      [...hostRuntime.popupRuntimes.values()].map((popup) =>
        buildRuntimeKey(popup.threadId, popup.tabId),
      ),
    );
    const backgroundRuntimes = [...hostRuntime.runtimes.values()].filter(
      (runtime) =>
        runtime.ownsWebContents &&
        runtime.key !== hostRuntime.attachedRuntimeKey &&
        !hostRuntime.isEmbeddedPopupFamily(runtime.threadId, runtime.tabId) &&
        !popupOwnerRuntimeKeys.has(runtime.key) &&
        hostRuntime.automationRuntimeKeys.has(runtime.key),
    );
    let excess = backgroundRuntimes.length - BROWSER_MAX_BACKGROUND_AUTOMATION_RUNTIMES;
    if (excess <= 0) return;

    const now = Date.now();
    const evictionCandidates = backgroundRuntimes
      .filter(
        (runtime) =>
          (hostRuntime.automationRuntimeProtectedUntilByKey.get(runtime.key) ?? 0) <= now,
      )
      .toSorted(
        (left, right) =>
          (hostRuntime.runtimeLastActiveAtByKey.get(left.key) ?? 0) -
          (hostRuntime.runtimeLastActiveAtByKey.get(right.key) ?? 0),
      );
    const changedThreadIds = new Set<ThreadId>();

    for (const runtime of evictionCandidates) {
      if (excess <= 0) break;
      const state = hostRuntime.states.get(runtime.threadId);
      const tab = state ? hostRuntime.getTab(state, runtime.tabId) : null;
      hostRuntime.destroyRuntime(runtime.threadId, runtime.tabId);
      if (state && tab) {
        const didChange = suspendTabState(tab);
        if (syncThreadLastError(state) || didChange) {
          changedThreadIds.add(runtime.threadId);
        }
      }
      excess -= 1;
      hostRuntime.perfCounters.inactiveTabBudgetEvictions += 1;
    }

    for (const threadId of changedThreadIds) {
      hostRuntime.markThreadStateChanged(threadId);
      hostRuntime.emitState(threadId);
    }

    if (excess <= 0) return;
    const nextProtectionExpiry = backgroundRuntimes
      .map((runtime) => hostRuntime.automationRuntimeProtectedUntilByKey.get(runtime.key) ?? 0)
      .filter((protectedUntil) => protectedUntil > now)
      .toSorted((left, right) => left - right)[0];
    if (nextProtectionExpiry === undefined) return;

    hostRuntime.backgroundAutomationEvictionTimer = setTimeout(
      () => {
        hostRuntime.backgroundAutomationEvictionTimer = null;
        enforceBackgroundAutomationRuntimeBudget();
      },
      Math.max(1, nextProtectionExpiry - now + 1),
    );
    hostRuntime.backgroundAutomationEvictionTimer.unref();
  }

  function suspendInactiveTabs(threadId: ThreadId, activeTabId: string | null): boolean {
    const state = hostRuntime.states.get(threadId);
    if (!state) {
      return false;
    }

    let didChange = false;
    const inactiveRuntimeTabIds = state.tabs
      .filter((tab) => tab.id !== activeTabId)
      .filter((tab) => hostRuntime.runtimes.has(buildRuntimeKey(threadId, tab.id)))
      .toSorted((left, right) => {
        const leftKey = buildRuntimeKey(threadId, left.id);
        const rightKey = buildRuntimeKey(threadId, right.id);
        return (
          (hostRuntime.runtimeLastActiveAtByKey.get(rightKey) ?? 0) -
          (hostRuntime.runtimeLastActiveAtByKey.get(leftKey) ?? 0)
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

      const runtime = hostRuntime.runtimes.get(buildRuntimeKey(threadId, tab.id));
      if (runtime) {
        if (warmRuntimeTabIds.has(tab.id)) {
          scheduleInactiveTabSuspend(threadId, tab.id);
          continue;
        }

        hostRuntime.perfCounters.inactiveTabBudgetEvictions += 1;
        hostRuntime.destroyRuntime(threadId, tab.id);
        didChange = suspendTabState(tab) || didChange;
        continue;
      }

      didChange = suspendTabState(tab) || didChange;
    }

    return didChange;
  }

  function scheduleThreadSuspend(threadId: ThreadId): void {
    const state = hostRuntime.states.get(threadId);
    if (!state?.open || hostRuntime.activeThreadId === threadId) {
      return;
    }

    clearSuspendTimer(threadId);
    const timer = setTimeout(() => {
      suspendThread(threadId);
      hostRuntime.suspendTimers.delete(threadId);
    }, BROWSER_THREAD_SUSPEND_DELAY_MS);
    timer.unref();
    hostRuntime.suspendTimers.set(threadId, timer);
  }

  function suspendThread(threadId: ThreadId): void {
    const state = hostRuntime.states.get(threadId);
    if (!state || hostRuntime.activeThreadId === threadId) {
      return;
    }

    let didChange = false;
    for (const tab of state.tabs) {
      if (hostRuntime.isEmbeddedPopupFamily(threadId, tab.id)) continue;
      if (
        tab.id === state.activeTabId &&
        hostRuntime.automationRuntimeKeys.has(buildRuntimeKey(threadId, tab.id))
      ) {
        continue;
      }
      hostRuntime.destroyRuntime(threadId, tab.id);
      didChange = suspendTabState(tab) || didChange;
    }

    didChange = syncThreadLastError(state) || didChange;
    if (didChange) {
      hostRuntime.markThreadStateChanged(threadId);
      hostRuntime.emitState(threadId);
    }
    enforceBackgroundAutomationRuntimeBudget();
  }

  function clearSuspendTimer(threadId: ThreadId): void {
    const existing = hostRuntime.suspendTimers.get(threadId);
    if (!existing) {
      return;
    }
    clearTimeout(existing);
    hostRuntime.suspendTimers.delete(threadId);
  }

  function scheduleInactiveTabSuspend(threadId: ThreadId, tabId: string): void {
    if (hostRuntime.isEmbeddedPopupFamily(threadId, tabId)) return;
    const key = buildRuntimeKey(threadId, tabId);
    if (hostRuntime.tabSuspendTimers.has(key)) {
      return;
    }

    hostRuntime.perfCounters.inactiveTabSuspendScheduled += 1;
    const delayMs = resolveInactiveTabSuspendDelay(threadId);
    const timer = setTimeout(() => {
      hostRuntime.tabSuspendTimers.delete(key);
      const state = hostRuntime.states.get(threadId);
      const tab = state ? hostRuntime.getTab(state, tabId) : null;
      if (!state || !tab) {
        return;
      }

      hostRuntime.destroyRuntime(threadId, tabId);
      const didChange = suspendTabState(tab) || syncThreadLastError(state);
      if (didChange) {
        hostRuntime.markThreadStateChanged(threadId);
        hostRuntime.emitState(threadId);
      }
    }, delayMs);
    timer.unref();
    hostRuntime.tabSuspendTimers.set(key, timer);
  }

  function clearTabSuspendTimer(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId);
    const existing = hostRuntime.tabSuspendTimers.get(key);
    if (!existing) {
      return;
    }

    clearTimeout(existing);
    hostRuntime.tabSuspendTimers.delete(key);
    hostRuntime.perfCounters.inactiveTabSuspendCancelled += 1;
  }

  function getTrackedProcessIds(): number[] {
    const processIds = new Set<number>();
    for (const runtime of hostRuntime.runtimes.values()) {
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
    for (const [key] of hostRuntime.tabSuspendTimers) {
      if (hostRuntime.runtimes.has(key)) {
        count += 1;
      }
    }
    return count;
  }

  function resolveInactiveTabSuspendDelay(threadId: ThreadId): number {
    const threadRuntimeCount = [...hostRuntime.runtimes.values()].filter(
      (runtime) => runtime.threadId === threadId,
    ).length;
    if (
      threadRuntimeCount > BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD + 1 ||
      hostRuntime.runtimes.size > 4
    ) {
      return BROWSER_INACTIVE_TAB_SUSPEND_DELAY_PRESSURED_MS;
    }

    return BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS;
  }

  return {
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
