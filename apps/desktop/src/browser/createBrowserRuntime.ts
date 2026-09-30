import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import { BrowserWindow } from "electron";
import { BrowserAnnotationCoordinator } from "./annotations/coordinator";
import { createBrowserAnnotations } from "./browserAnnotations";
import { createBrowserAutomationTabs } from "./browserAutomationTabs";
import { createBrowserCapture } from "./browserCapture";
import { createBrowserPanel } from "./browserPanel";
import { createBrowserPopupRuntime } from "./browserPopupRuntime";
import { createBrowserRuntimeAttachment } from "./browserRuntimeAttachment";
import { createBrowserRuntimeResources } from "./browserRuntimeResources";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import { BrowserSessionPolicy } from "./browserSessionPolicy";
import { createBrowserTabNavigation } from "./browserTabNavigation";
import {
  BrowserCopyLinkListener,
  BrowserStateListener,
  DesktopBrowserManagerOptions,
  LiveTabRuntime,
  OAuthPopupRuntime,
  PendingAutomationWindowOpenCommit,
  PendingRuntimeSync,
  PendingStatePublication,
  PendingWindowOpenTask,
} from "./browserTabState";
import { createBrowserWebviewRuntime } from "./browserWebviewRuntime";

export function createBrowserRuntime(options: DesktopBrowserManagerOptions = {}): BrowserRuntime {
  // Assemble callable operations before resources can invoke their callbacks.
  const hostRuntime = {} as { -readonly [Key in keyof BrowserRuntime]: BrowserRuntime[Key] };
  Object.assign(hostRuntime, createBrowserAnnotations(hostRuntime));
  Object.assign(hostRuntime, createBrowserPopupRuntime(hostRuntime));
  Object.assign(hostRuntime, createBrowserAutomationTabs(hostRuntime));
  Object.assign(hostRuntime, createBrowserPanel(hostRuntime));
  Object.assign(hostRuntime, createBrowserWebviewRuntime(hostRuntime));
  Object.assign(hostRuntime, createBrowserTabNavigation(hostRuntime));
  Object.assign(hostRuntime, createBrowserCapture(hostRuntime));
  Object.assign(hostRuntime, createBrowserRuntimeResources(hostRuntime));
  Object.assign(hostRuntime, createBrowserRuntimeAttachment(hostRuntime));
  hostRuntime.view = {
    window: null,
    activeThreadId: null,
    activeBounds: null,
    activeBoundsThreadId: null,
    activePageZoomFactor: 1,
    activePageZoomThreadId: null,
    attachedRuntimeKey: null,
    attachedBoundsSignature: null,
  };
  hostRuntime.tabs = {
    states: new Map<ThreadId, ThreadBrowserState>(),
    threadVersionById: new Map<ThreadId, number>(),
    snapshotCacheByThreadId: new Map<ThreadId, { version: number; snapshot: ThreadBrowserState }>(),
    lastEmittedVersionByThreadId: new Map<ThreadId, number>(),
    pendingStatePublicationsByKey: new Map<string, PendingStatePublication>(),
    listeners: new Set<BrowserStateListener>(),
    copyLinkListeners: new Set<BrowserCopyLinkListener>(),
    previewThreadIds: new Set<ThreadId>(),
  };
  hostRuntime.live = {
    runtimes: new Map<string, LiveTabRuntime>(),
    runtimePageZoomFactors: new Map<string, number>(),
    rendererOnlyRuntimeKeys: new Set<string>(),
    automationRuntimeKeys: new Set<string>(),
    pendingRuntimeSyncs: new Map<string, PendingRuntimeSync>(),
    runtimeSyncFlushScheduled: false,
    popupRuntimes: new Map<BrowserWindow, OAuthPopupRuntime>(),
  };
  hostRuntime.budget = {
    automationRuntimeProtectedUntilByKey: new Map<string, number>(),
    runtimeLastActiveAtByKey: new Map<string, number>(),
    tabSuspendTimers: new Map<string, ReturnType<typeof setTimeout>>(),
    suspendTimers: new Map<ThreadId, ReturnType<typeof setTimeout>>(),
    backgroundAutomationEvictionTimer: null,
    perfCounters: {
      setPanelBoundsCalls: 0,
      setPanelBoundsNoopSkips: 0,
      setPanelBoundsViewportUpdates: 0,
      stateEmitCalls: 0,
      stateEmitSkips: 0,
      stateCloneCount: 0,
      runtimeSyncQueueFlushes: 0,
      syncRuntimeStateCalls: 0,
      inactiveTabSuspendScheduled: 0,
      inactiveTabSuspendCancelled: 0,
      inactiveTabBudgetEvictions: 0,
      warmInactiveRuntimeCount: 0,
    },
  };
  hostRuntime.popup = {
    pendingWindowOpenTasksByRuntimeKey: new Map<string, PendingWindowOpenTask>(),
    pendingAutomationWindowOpenCommitsByRuntimeKey: new Map<
      string,
      PendingAutomationWindowOpenCommit
    >(),
  };
  hostRuntime.lifecycle = { disposed: false };

  const sessionPolicy = new BrowserSessionPolicy((event) => {
    hostRuntime.handleSessionDownload(event);
  });
  const annotations = new BrowserAnnotationCoordinator({
    resolveVisibleRuntime: (input) => {
      const runtime = hostRuntime.getVisibleAutomationRuntime(input);
      return {
        threadId: runtime.threadId,
        tabId: runtime.tabId,
        webContents: runtime.webContents,
      };
    },
    resolveRuntimeByWebContentsId: (webContentsId) =>
      hostRuntime.toAnnotationRuntime(hostRuntime.findRuntimeByWebContentsId(webContentsId)),
    markHumanControl: (threadId) => hostRuntime.markHumanControl(threadId),
  });
  hostRuntime.services = { options, sessionPolicy, annotations };

  return hostRuntime;
}
