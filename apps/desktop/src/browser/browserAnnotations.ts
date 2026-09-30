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
    | "window"
    | "detachAttachedRuntime"
    | "destroyAllRuntimes"
    | "closeAllPopupWindows"
    | "activeThreadId"
    | "getVisibleBoundsForThread"
    | "attachActiveTab"
    | "sessionPolicy"
    | "listeners"
    | "copyLinkListeners"
    | "annotations"
    | "states"
  >,
) {
  function setWindow(window: BrowserWindow | null): void {
    const previousWindow = hostRuntime.window;
    if (previousWindow && previousWindow !== window) {
      hostRuntime.detachAttachedRuntime();
      hostRuntime.destroyAllRuntimes();
      hostRuntime.closeAllPopupWindows();
    }
    hostRuntime.window = window;
    if (window) {
      const bounds = hostRuntime.activeThreadId
        ? hostRuntime.getVisibleBoundsForThread(hostRuntime.activeThreadId)
        : null;
      if (hostRuntime.activeThreadId && bounds) {
        hostRuntime.attachActiveTab(hostRuntime.activeThreadId, bounds);
      }
      return;
    }
  }

  function isWebMcpCompatibilityAllowed(webContentsId: number): boolean {
    return hostRuntime.sessionPolicy.isWebMcpCompatibilityAllowed(webContentsId);
  }

  function subscribe(listener: BrowserStateListener): () => void {
    hostRuntime.listeners.add(listener);
    return () => {
      hostRuntime.listeners.delete(listener);
    };
  }

  function subscribeCopyLink(listener: BrowserCopyLinkListener): () => void {
    hostRuntime.copyLinkListeners.add(listener);
    return () => {
      hostRuntime.copyLinkListeners.delete(listener);
    };
  }

  function subscribeAnnotationEvents(
    listener: (event: BrowserAnnotationEvent) => void,
  ): () => void {
    return hostRuntime.annotations.subscribe(listener);
  }

  function startAnnotation(input: BrowserAnnotationStartInput): BrowserAnnotationSession {
    return hostRuntime.annotations.start(input);
  }

  function cancelAnnotation(input: BrowserAnnotationCancelInput): void {
    hostRuntime.annotations.cancel(input);
  }

  function syncAnnotationMarkers(input: BrowserAnnotationSyncMarkersInput): void {
    const state = hostRuntime.states.get(input.threadId);
    if (!state?.tabs.some((tab) => tab.id === input.tabId)) {
      throw new Error("The requested browser tab is not available in this thread.");
    }
    hostRuntime.annotations.syncMarkers(input);
  }

  function resolveAnnotationNavigationTarget(input: {
    threadId: ThreadId;
    tabId?: string;
    annotationId: string;
  }): { readonly tabId: string; readonly url: string } | null {
    const state = hostRuntime.states.get(input.threadId);
    if (!state) {
      return null;
    }
    const target = hostRuntime.annotations.resolveNavigationTarget(
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
    hostRuntime.annotations.handleGuestMessage(sender, payload);
  }

  function isAnnotationInteractive(threadId: ThreadId): boolean {
    return hostRuntime.annotations.isInteractive(threadId);
  }

  function isTrustedRenderer(webContentsId: number): boolean {
    return Boolean(
      hostRuntime.window &&
      !hostRuntime.window.isDestroyed() &&
      hostRuntime.window.webContents.id === webContentsId,
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
