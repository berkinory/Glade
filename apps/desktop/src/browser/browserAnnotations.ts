import type {
  BrowserAnnotationCancelInput,
  BrowserAnnotationEvent,
  BrowserAnnotationSession,
  BrowserAnnotationStartInput,
  BrowserAnnotationSyncMarkersInput,
} from "@glade/contracts/browser/browserAnnotations";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { WebContents } from "electron";
import { BrowserWindow } from "electron";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import { BrowserCopyLinkListener, BrowserStateListener } from "./browserTabState";

export function createBrowserAnnotations(
  hostRuntime: Pick<
    BrowserRuntime,
    | "services"
    | "tabs"
    | "view"
    | "detachAttachedRuntime"
    | "destroyAllRuntimes"
    | "closeAllPopupWindows"
    | "getVisibleBoundsForThread"
    | "attachActiveTab"
  >,
) {
  function setWindow(window: BrowserWindow | null): void {
    const previousWindow = hostRuntime.view.window;
    if (previousWindow && previousWindow !== window) {
      hostRuntime.detachAttachedRuntime();
      hostRuntime.destroyAllRuntimes();
      hostRuntime.closeAllPopupWindows();
    }
    hostRuntime.view.window = window;
    if (window) {
      const bounds = hostRuntime.view.activeThreadId
        ? hostRuntime.getVisibleBoundsForThread(hostRuntime.view.activeThreadId)
        : null;
      if (hostRuntime.view.activeThreadId && bounds) {
        hostRuntime.attachActiveTab(hostRuntime.view.activeThreadId, bounds);
      }
      return;
    }
  }

  function isWebMcpCompatibilityAllowed(webContentsId: number): boolean {
    return hostRuntime.services.sessionPolicy.isWebMcpCompatibilityAllowed(webContentsId);
  }

  function subscribe(listener: BrowserStateListener): () => void {
    hostRuntime.tabs.listeners.add(listener);
    return () => {
      hostRuntime.tabs.listeners.delete(listener);
    };
  }

  function subscribeCopyLink(listener: BrowserCopyLinkListener): () => void {
    hostRuntime.tabs.copyLinkListeners.add(listener);
    return () => {
      hostRuntime.tabs.copyLinkListeners.delete(listener);
    };
  }

  function subscribeAnnotationEvents(
    listener: (event: BrowserAnnotationEvent) => void,
  ): () => void {
    return hostRuntime.services.annotations.subscribe(listener);
  }

  function startAnnotation(input: BrowserAnnotationStartInput): BrowserAnnotationSession {
    return hostRuntime.services.annotations.start(input);
  }

  function cancelAnnotation(input: BrowserAnnotationCancelInput): void {
    hostRuntime.services.annotations.cancel(input);
  }

  function syncAnnotationMarkers(input: BrowserAnnotationSyncMarkersInput): void {
    const state = hostRuntime.tabs.states.get(input.threadId);
    if (!state?.tabs.some((tab) => tab.id === input.tabId)) {
      throw new Error("The requested browser tab is not available in this thread.");
    }
    hostRuntime.services.annotations.syncMarkers(input);
  }

  function resolveAnnotationNavigationTarget(input: {
    threadId: ThreadId;
    tabId?: string;
    annotationId: string;
  }): { readonly tabId: string; readonly url: string } | null {
    const state = hostRuntime.tabs.states.get(input.threadId);
    if (!state) {
      return null;
    }
    const target = hostRuntime.services.annotations.resolveNavigationTarget(
      input.threadId,
      input.annotationId,
      input.tabId,
    );
    if (!target || !state.tabs.some((tab) => tab.id === target.tabId)) {
      return null;
    }
    return { tabId: target.tabId, url: target.liveUrl };
  }

  function handleAnnotationGuestMessage(sender: WebContents, payload: unknown): void {
    hostRuntime.services.annotations.handleGuestMessage(sender, payload);
  }

  function isAnnotationInteractive(threadId: ThreadId): boolean {
    return hostRuntime.services.annotations.isInteractive(threadId);
  }

  function isTrustedRenderer(webContentsId: number): boolean {
    return Boolean(
      hostRuntime.view.window &&
      !hostRuntime.view.window.isDestroyed() &&
      hostRuntime.view.window.webContents.id === webContentsId,
    );
  }

  return {
    setWindow,
    isWebMcpCompatibilityAllowed,
    subscribe,
    subscribeCopyLink,
    subscribeAnnotationEvents,
    startAnnotation,
    cancelAnnotation,
    syncAnnotationMarkers,
    resolveAnnotationNavigationTarget,
    handleAnnotationGuestMessage,
    isAnnotationInteractive,
    isTrustedRenderer,
  };
}
