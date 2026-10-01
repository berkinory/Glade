import { type BrowserTabId } from "@glade/contracts/browser/automation/browserAutomationIds";
import type {
  BrowserAutomationVisibleRuntime,
  BrowserAutomationWindowOpenEvent,
} from "../browserTabState";
import {
  TabToolExecution,
  waitForWindowOpenEvent,
  waitOneTurnForWindowOpenEvent,
  WINDOW_OPEN_RECONCILIATION_TIMEOUT_MS,
  WindowOpenObservation,
} from "./automationHostPolicy";
import { type BrowserAutomationHostRuntime } from "./automationHostRuntimeTypes";
import { browserHostError } from "./hostErrors";

export function createAutomationWindowOpen(
  hostRuntime: Pick<BrowserAutomationHostRuntime, "browserManager">,
) {
  function observeWindowOpen(runtime: BrowserAutomationVisibleRuntime): WindowOpenObservation {
    let pageAnnouncedWindowOpen = false;
    let observedEvent: BrowserAutomationWindowOpenEvent | null = null;
    let resolveEvent!: (event: BrowserAutomationWindowOpenEvent) => void;
    const eventPromise = new Promise<BrowserAutomationWindowOpenEvent>((resolve) => {
      resolveEvent = resolve;
    });
    const onDebuggerMessage = (...args: unknown[]) => {
      if (args[1] === "Page.windowOpen") pageAnnouncedWindowOpen = true;
    };
    runtime.webContents.debugger.on("message", onDebuggerMessage);
    const releaseManagerTracking = hostRuntime.browserManager.trackAutomationWindowOpen(
      { threadId: runtime.threadId, tabId: runtime.tabId },
      (event) => {
        if (observedEvent) return;
        observedEvent = event;
        resolveEvent(event);
      },
    );
    let disposed = false;
    return {
      reconcile: (timeoutMs, signal) => {
        if (observedEvent) return Promise.resolve(observedEvent);

        if (!pageAnnouncedWindowOpen) {
          return waitOneTurnForWindowOpenEvent(eventPromise, signal);
        }
        return waitForWindowOpenEvent(eventPromise, timeoutMs, signal);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        runtime.webContents.debugger.off("message", onDebuggerMessage);
        releaseManagerTracking();
      },
    };
  }

  async function reconcileWindowOpen(
    observation: WindowOpenObservation,
    timeoutMs: number | undefined,
    targetTabId: string,
    signal: AbortSignal,
  ): Promise<Pick<TabToolExecution, "openedTabId" | "oauthPopup">> {
    const event = await observation.reconcile(
      Math.min(
        timeoutMs ?? WINDOW_OPEN_RECONCILIATION_TIMEOUT_MS,
        WINDOW_OPEN_RECONCILIATION_TIMEOUT_MS,
      ),
      signal,
    );
    if (event?.kind === "tab") {
      return { openedTabId: event.openedTabId, oauthPopup: false };
    }
    if (event?.kind === "popup") {
      return { openedTabId: null, oauthPopup: true };
    }
    if (event?.kind === "blocked") {
      browserHostError({
        code: "BrowserPopupBlocked",
        retryable: false,
        phase: "navigation",
        effectMayHaveCommitted: true,
        tabId: targetTabId as BrowserTabId,
      });
    }
    return { openedTabId: null, oauthPopup: false };
  }

  return { observeWindowOpen, reconcileWindowOpen };
}
