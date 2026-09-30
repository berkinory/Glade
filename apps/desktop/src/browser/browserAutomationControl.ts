import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { BrowserTabInput } from "@glade/contracts/ipc/ipc";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import {
  BROWSER_AUTOMATION_INPUT_RELEASE_GRACE_MS,
  BrowserAutomationDownloadEvent,
  BrowserAutomationDownloadLease,
  BrowserAutomationDownloadListener,
  BrowserAutomationExpectedInput,
  browserAutomationInputMatches,
  BrowserAutomationWindowOpenEvent,
  BrowserAutomationWindowOpenListener,
  buildRuntimeKey,
  PendingBrowserAutomationInput,
} from "./browserTabState";

export function createBrowserAutomationControl(
  hostRuntime: Pick<
    BrowserRuntime,
    | "automationWindowOpenListenersByRuntimeKey"
    | "commitPendingAutomationWindowOpen"
    | "automationDownloadListenersByRuntimeKey"
    | "getAutomationHumanControlEpoch"
    | "automationSideEffectProvenanceByRuntimeKey"
    | "automationGestureDepthByRuntimeKey"
    | "options"
    | "states"
    | "getActiveTab"
    | "runtimeLastActiveAtByKey"
    | "humanControlEpochByThreadId"
    | "humanControlListenersByThreadId"
    | "runtimes"
    | "expectedAutomationInputsByRuntimeKey"
  >,
) {
  function trackAutomationWindowOpen(
    input: BrowserTabInput,
    listener: BrowserAutomationWindowOpenListener,
  ): () => void {
    const key = buildRuntimeKey(input.threadId, input.tabId);
    const listeners = hostRuntime.automationWindowOpenListenersByRuntimeKey.get(key) ?? new Set();
    listeners.add(listener);
    hostRuntime.automationWindowOpenListenersByRuntimeKey.set(key, listeners);
    beginAutomationGesture(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      listeners.delete(listener);
      if (listeners.size === 0) hostRuntime.automationWindowOpenListenersByRuntimeKey.delete(key);
      endAutomationGesture(key);
      if (listeners.size === 0) hostRuntime.commitPendingAutomationWindowOpen(key);
    };
  }

  function trackAutomationDownload(
    input: BrowserTabInput,
    listener: BrowserAutomationDownloadListener,
  ): () => void {
    const key = buildRuntimeKey(input.threadId, input.tabId);
    const listeners = hostRuntime.automationDownloadListenersByRuntimeKey.get(key) ?? new Set();
    const humanControlEpoch = hostRuntime.getAutomationHumanControlEpoch(input.threadId);
    const lease: BrowserAutomationDownloadLease = {
      listener,
      humanControlEpoch,
    };
    listeners.add(lease);
    hostRuntime.automationDownloadListenersByRuntimeKey.set(key, listeners);

    hostRuntime.automationSideEffectProvenanceByRuntimeKey.set(key, {
      threadId: input.threadId,
      humanControlEpoch,
    });
    beginAutomationGesture(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      listeners.delete(lease);
      if (listeners.size === 0) hostRuntime.automationDownloadListenersByRuntimeKey.delete(key);
      endAutomationGesture(key);
    };
  }

  function beginAutomationGesture(key: string): void {
    hostRuntime.automationGestureDepthByRuntimeKey.set(
      key,
      (hostRuntime.automationGestureDepthByRuntimeKey.get(key) ?? 0) + 1,
    );
  }

  function endAutomationGesture(key: string): void {
    const nextDepth = Math.max(
      0,
      (hostRuntime.automationGestureDepthByRuntimeKey.get(key) ?? 1) - 1,
    );
    if (nextDepth === 0) {
      hostRuntime.automationGestureDepthByRuntimeKey.delete(key);
      return;
    }
    hostRuntime.automationGestureDepthByRuntimeKey.set(key, nextDepth);
  }

  function markHumanControl(threadId: ThreadId): void {
    hostRuntime.options.onHumanControl?.(threadId);
    const state = hostRuntime.states.get(threadId);
    const activeTab = state ? hostRuntime.getActiveTab(state) : null;
    if (activeTab) {
      hostRuntime.runtimeLastActiveAtByKey.set(buildRuntimeKey(threadId, activeTab.id), Date.now());
    }
    hostRuntime.humanControlEpochByThreadId.set(
      threadId,
      (hostRuntime.humanControlEpochByThreadId.get(threadId) ?? 0) + 1,
    );
    for (const [key, provenance] of hostRuntime.automationSideEffectProvenanceByRuntimeKey) {
      if (provenance.threadId === threadId) {
        hostRuntime.automationSideEffectProvenanceByRuntimeKey.delete(key);
      }
    }
    for (const listener of [...(hostRuntime.humanControlListenersByThreadId.get(threadId) ?? [])]) {
      try {
        listener();
      } catch {
        // Input delivery must never be disrupted by an automation observer.
      }
    }
  }

  function expectAutomationInput(
    threadId: ThreadId,
    tabId: string,
    signal: BrowserAutomationExpectedInput,
  ): () => void {
    const key = buildRuntimeKey(threadId, tabId);
    const now = Date.now();

    const zoom = hostRuntime.runtimes.get(key)?.webContents.getZoomFactor() ?? 1;
    const pending: PendingBrowserAutomationInput = {
      signal:
        signal.kind === "mouse" ? { ...signal, x: signal.x * zoom, y: signal.y * zoom } : signal,
      expiresAt: now + 1_000,
    };
    const current = (hostRuntime.expectedAutomationInputsByRuntimeKey.get(key) ?? [])
      .filter((entry) => entry.expiresAt > now)
      .slice(-63);
    hostRuntime.expectedAutomationInputsByRuntimeKey.set(key, [...current, pending]);
    beginAutomationGesture(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const releaseTime = Date.now();
      const remaining = (hostRuntime.expectedAutomationInputsByRuntimeKey.get(key) ?? []).filter(
        (entry) => entry.expiresAt > releaseTime,
      );
      if (remaining.includes(pending)) {
        // Gesture/window-open correlation still ends immediately below, so unrelated agent attribution
        // cannot leak.
        pending.expiresAt = Math.min(
          pending.expiresAt,
          releaseTime + BROWSER_AUTOMATION_INPUT_RELEASE_GRACE_MS,
        );
      }
      if (remaining.length === 0) hostRuntime.expectedAutomationInputsByRuntimeKey.delete(key);
      else hostRuntime.expectedAutomationInputsByRuntimeKey.set(key, remaining);
      endAutomationGesture(key);
    };
  }

  function isAutomationGestureActive(threadId: ThreadId, tabId: string): boolean {
    return (
      (hostRuntime.automationGestureDepthByRuntimeKey.get(buildRuntimeKey(threadId, tabId)) ?? 0) >
      0
    );
  }

  function emitAutomationWindowOpen(event: BrowserAutomationWindowOpenEvent): void {
    const key = buildRuntimeKey(event.threadId, event.sourceTabId);
    for (const listener of [
      ...(hostRuntime.automationWindowOpenListenersByRuntimeKey.get(key) ?? []),
    ]) {
      try {
        listener(event);
      } catch {
        // Window creation must not be disrupted by an automation observer.
      }
    }
  }

  function emitAutomationDownload(event: BrowserAutomationDownloadEvent): void {
    const key = buildRuntimeKey(event.threadId, event.sourceTabId);
    const humanControlEpoch = hostRuntime.getAutomationHumanControlEpoch(event.threadId);
    for (const lease of [...(hostRuntime.automationDownloadListenersByRuntimeKey.get(key) ?? [])]) {
      if (lease.humanControlEpoch !== humanControlEpoch) continue;
      try {
        lease.listener(event);
      } catch {
        // The download was already prevented. Observer failures must never destabilize the shared browser
        // session or re-enable the side effect.
      }
    }
  }

  function consumeExpectedAutomationInput(
    threadId: ThreadId,
    tabId: string,
    signal: BrowserAutomationExpectedInput,
  ): boolean {
    const key = buildRuntimeKey(threadId, tabId);
    const now = Date.now();
    const pending = (hostRuntime.expectedAutomationInputsByRuntimeKey.get(key) ?? []).filter(
      (entry) => entry.expiresAt > now,
    );
    const matchedIndex = pending.findIndex((entry) =>
      browserAutomationInputMatches(entry.signal, signal),
    );
    if (matchedIndex < 0) {
      if (pending.length === 0) hostRuntime.expectedAutomationInputsByRuntimeKey.delete(key);
      else hostRuntime.expectedAutomationInputsByRuntimeKey.set(key, pending);
      return false;
    }
    pending.splice(matchedIndex, 1);
    if (pending.length === 0) hostRuntime.expectedAutomationInputsByRuntimeKey.delete(key);
    else hostRuntime.expectedAutomationInputsByRuntimeKey.set(key, pending);
    return true;
  }

  return {
    trackAutomationWindowOpen,
    trackAutomationDownload,
    markHumanControl,
    expectAutomationInput,
    isAutomationGestureActive,
    emitAutomationWindowOpen,
    emitAutomationDownload,
    consumeExpectedAutomationInput,
  };
}
