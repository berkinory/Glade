import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { BrowserPanelBounds, BrowserTabState } from "@glade/contracts/ipc/ipc";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import {
  BACKGROUND_AUTOMATION_BOUNDS,
  browserPresentationSignature,
  buildRuntimeKey,
  LiveTabRuntime,
  NativeBrowserViewVisibility,
  SUSPENDED_TAB_STATUS,
  suspendTabState,
  syncThreadLastError,
} from "./browserTabState";

export function createBrowserRuntimeAttachment(
  hostRuntime: Pick<
    BrowserRuntime,
    | "ensureWorkspace"
    | "getActiveTab"
    | "suspendInactiveTabs"
    | "rendererOnlyRuntimeKeys"
    | "runtimes"
    | "destroyRuntime"
    | "activateThreadForPendingRenderer"
    | "getVisiblePageZoomFactor"
    | "automationRuntimeKeys"
    | "loadTab"
    | "syncRuntimeState"
    | "window"
    | "setRuntimePageZoomFactor"
    | "previewThreadIds"
    | "attachedRuntimeKey"
    | "attachedBoundsSignature"
    | "runtimeLastActiveAtByKey"
    | "updatePopupWindowsForThread"
    | "enforceBackgroundAutomationRuntimeBudget"
    | "clearTabSuspendTimer"
    | "createLiveRuntime"
    | "getTab"
    | "markThreadStateChanged"
  >,
) {
  function attachActiveTab(
    threadId: ThreadId,
    bounds: BrowserPanelBounds,
    options: { forceLoad?: boolean; pageZoomFactor?: number } = {},
  ): void {
    const state = hostRuntime.ensureWorkspace(threadId);
    const activeTab = hostRuntime.getActiveTab(state);
    if (!activeTab) {
      return;
    }

    hostRuntime.suspendInactiveTabs(threadId, activeTab.id);
    const runtimeKey = buildRuntimeKey(threadId, activeTab.id);
    if (hostRuntime.rendererOnlyRuntimeKeys.has(runtimeKey)) {
      const rendererRuntime = hostRuntime.runtimes.get(runtimeKey);
      if (!rendererRuntime || rendererRuntime.ownsWebContents) {
        if (rendererRuntime?.ownsWebContents) hostRuntime.destroyRuntime(threadId, activeTab.id);
        hostRuntime.activateThreadForPendingRenderer(
          threadId,
          bounds,
          options.pageZoomFactor ?? hostRuntime.getVisiblePageZoomFactor(threadId),
        );
        return;
      }
    }
    const wasSuspended = activeTab.status === SUSPENDED_TAB_STATUS;
    const runtime = ensureLiveRuntime(threadId, activeTab.id);
    attachRuntime(
      runtime,
      bounds,
      options.pageZoomFactor ?? hostRuntime.getVisiblePageZoomFactor(threadId),
    );
    const shouldLoadProjectedUrl =
      options.forceLoad || (wasSuspended && !hostRuntime.automationRuntimeKeys.has(runtimeKey));
    if (shouldLoadProjectedUrl) {
      void hostRuntime.loadTab(threadId, activeTab.id, {
        force: true,
        runtime,
      });
    } else {
      hostRuntime.syncRuntimeState(threadId, activeTab.id);
    }
  }

  function attachRuntime(
    runtime: LiveTabRuntime,
    bounds: BrowserPanelBounds,
    pageZoomFactor = hostRuntime.getVisiblePageZoomFactor(runtime.threadId),
  ): void {
    const window = hostRuntime.window;
    hostRuntime.setRuntimePageZoomFactor(runtime, pageZoomFactor);
    if (!window) {
      return;
    }

    if (hostRuntime.previewThreadIds.has(runtime.threadId) && runtime.view) {
      if (hostRuntime.attachedRuntimeKey !== runtime.key) detachAttachedRuntime();
      parkHiddenRuntime(runtime, bounds);
      hostRuntime.attachedRuntimeKey = runtime.key;
      hostRuntime.attachedBoundsSignature = browserPresentationSignature(bounds, pageZoomFactor);
      return;
    }

    const nextBoundsSignature = browserPresentationSignature(bounds, pageZoomFactor);
    hostRuntime.runtimeLastActiveAtByKey.set(runtime.key, Date.now());

    if (!runtime.ownsWebContents) {
      if (hostRuntime.attachedRuntimeKey && hostRuntime.attachedRuntimeKey !== runtime.key) {
        detachAttachedRuntime();
      }
      hostRuntime.attachedRuntimeKey = runtime.key;
      hostRuntime.attachedBoundsSignature = nextBoundsSignature;
      hostRuntime.updatePopupWindowsForThread(runtime.threadId);
      hostRuntime.enforceBackgroundAutomationRuntimeBudget();
      return;
    }
    if (!runtime.view) {
      hostRuntime.attachedRuntimeKey = runtime.key;
      hostRuntime.attachedBoundsSignature = nextBoundsSignature;
      hostRuntime.updatePopupWindowsForThread(runtime.threadId);
      hostRuntime.enforceBackgroundAutomationRuntimeBudget();
      return;
    }
    runtime.view.setBorderRadius(0);
    if (hostRuntime.attachedRuntimeKey === runtime.key) {
      setRuntimeViewHidden(runtime, false);
      bringRuntimeViewToFront(runtime);
      if (hostRuntime.attachedBoundsSignature === nextBoundsSignature) {
        return;
      }
      runtime.view.setBounds(bounds);
      hostRuntime.attachedBoundsSignature = nextBoundsSignature;
      hostRuntime.updatePopupWindowsForThread(runtime.threadId);
      return;
    }

    detachAttachedRuntime();
    setRuntimeViewHidden(runtime, false);
    bringRuntimeViewToFront(runtime);
    runtime.view.setBounds(bounds);
    hostRuntime.attachedRuntimeKey = runtime.key;
    hostRuntime.attachedBoundsSignature = nextBoundsSignature;
    hostRuntime.updatePopupWindowsForThread(runtime.threadId);
    hostRuntime.enforceBackgroundAutomationRuntimeBudget();
  }

  function bringRuntimeViewToFront(runtime: LiveTabRuntime): void {
    const window = hostRuntime.window;
    if (!window || !runtime.view) {
      return;
    }

    try {
      window.contentView.removeChildView(runtime.view);
    } catch {}
    window.contentView.addChildView(runtime.view);
  }

  function detachAttachedRuntime(): void {
    if (!hostRuntime.window || !hostRuntime.attachedRuntimeKey) {
      hostRuntime.attachedRuntimeKey = null;
      hostRuntime.attachedBoundsSignature = null;
      return;
    }

    const runtime = hostRuntime.runtimes.get(hostRuntime.attachedRuntimeKey);
    if (runtime?.view) {
      setRuntimeViewHidden(runtime, true);
      if (!hostRuntime.automationRuntimeKeys.has(runtime.key)) {
        hostRuntime.window.contentView.removeChildView(runtime.view);
      }
    }
    hostRuntime.attachedRuntimeKey = null;
    hostRuntime.attachedBoundsSignature = null;
  }

  function setRuntimeViewHidden(runtime: LiveTabRuntime, hidden: boolean): void {
    if (!runtime.view) {
      return;
    }
    const keepRenderingInBackground = hidden && hostRuntime.automationRuntimeKeys.has(runtime.key);
    if (keepRenderingInBackground) {
      parkHiddenRuntime(runtime, BACKGROUND_AUTOMATION_BOUNDS);
      return;
    }
    const nativeView = runtime.view as typeof runtime.view & NativeBrowserViewVisibility;
    nativeView.setVisible?.(!hidden);
    if (hidden) {
      runtime.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }

  function parkHiddenRuntime(runtime: LiveTabRuntime, bounds: BrowserPanelBounds): void {
    const window = hostRuntime.window;
    if (!window || !runtime.view) return;

    runtime.view.setVisible(false);
    window.contentView.removeChildView(runtime.view);
    window.contentView.addChildView(runtime.view, 0);
    runtime.view.setBounds({ ...bounds, x: 0, y: 0 });
  }

  function ensureLiveRuntime(threadId: ThreadId, tabId: string): LiveTabRuntime {
    const key = buildRuntimeKey(threadId, tabId);
    hostRuntime.clearTabSuspendTimer(threadId, tabId);
    const existing = hostRuntime.runtimes.get(key);
    if (existing) {
      if (existing.webContents.isDestroyed()) {
        hostRuntime.destroyRuntime(threadId, tabId);
      } else {
        return existing;
      }
    }

    if (hostRuntime.rendererOnlyRuntimeKeys.has(key)) {
      throw new Error("This tab requires its renderer-owned browser webview.");
    }

    const runtime = hostRuntime.createLiveRuntime(threadId, tabId);
    hostRuntime.runtimes.set(key, runtime);
    const state = hostRuntime.ensureWorkspace(threadId);
    const tab = hostRuntime.getTab(state, tabId);
    if (tab) {
      const didChange = tab.status !== "live" || tab.lastError !== null;
      tab.status = "live";
      tab.lastError = null;
      syncThreadLastError(state);
      if (didChange) {
        hostRuntime.markThreadStateChanged(threadId);
      }
    }
    return runtime;
  }

  function claimAutomationTab(threadId: ThreadId, tab: BrowserTabState): boolean {
    const key = buildRuntimeKey(threadId, tab.id);
    hostRuntime.automationRuntimeKeys.add(key);

    const runtime = hostRuntime.runtimes.get(key);
    const rendererGuestAlive = Boolean(
      runtime && !runtime.ownsWebContents && !runtime.webContents.isDestroyed(),
    );
    if (rendererGuestAlive) {
      if (tab.runtimeSurface !== "renderer") {
        tab.runtimeSurface = "renderer";
        return true;
      }
      return false;
    }
    if (runtime?.ownsWebContents && !runtime.webContents.isDestroyed()) {
      return false;
    }

    hostRuntime.rendererOnlyRuntimeKeys.delete(key);
    let didChange = false;
    if (tab.runtimeSurface !== "native") {
      tab.runtimeSurface = "native";
      didChange = true;
    }

    if (runtime && !runtime.ownsWebContents) {
      hostRuntime.destroyRuntime(threadId, tab.id, {
        preserveAutomationDownloadTracking: true,
        annotationReason: "replaced",
      });
      didChange = suspendTabState(tab) || didChange;
    }
    return didChange;
  }

  return {
    attachActiveTab,
    attachRuntime,
    detachAttachedRuntime,
    setRuntimeViewHidden,
    parkHiddenRuntime,
    ensureLiveRuntime,
    claimAutomationTab,
  };
}
