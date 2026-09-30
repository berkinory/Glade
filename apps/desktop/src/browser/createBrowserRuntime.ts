import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import { BrowserWindow } from "electron";
import { BrowserAnnotationCoordinator } from "./annotations/coordinator";
import { createBrowserAnnotations } from "./browserAnnotations";
import { createBrowserAutomationControl } from "./browserAutomationControl";
import { createBrowserAutomationTabs } from "./browserAutomationTabs";
import { createBrowserCapture } from "./browserCapture";
import { createBrowserPanel } from "./browserPanel";
import { createBrowserPopupRuntime } from "./browserPopupRuntime";
import { createBrowserRuntimeAttachment } from "./browserRuntimeAttachment";
import { createBrowserRuntimeBudget } from "./browserRuntimeBudget";
import { createBrowserRuntimeTeardown } from "./browserRuntimeTeardown";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import { BrowserSessionPolicy } from "./browserSessionPolicy";
import { createBrowserTabNavigation } from "./browserTabNavigation";
import {
  BrowserAutomationDownloadLease,
  BrowserAutomationSideEffectProvenance,
  BrowserAutomationWindowOpenListener,
  BrowserCopyLinkListener,
  BrowserHumanControlListener,
  BrowserStateListener,
  DesktopBrowserManagerOptions,
  LiveTabRuntime,
  OAuthPopupRuntime,
  PendingAutomationWindowOpenCommit,
  PendingBrowserAutomationInput,
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
  Object.assign(hostRuntime, createBrowserAutomationControl(hostRuntime));
  Object.assign(hostRuntime, createBrowserAutomationTabs(hostRuntime));
  Object.assign(hostRuntime, createBrowserPanel(hostRuntime));
  Object.assign(hostRuntime, createBrowserWebviewRuntime(hostRuntime));
  Object.assign(hostRuntime, createBrowserTabNavigation(hostRuntime));
  Object.assign(hostRuntime, createBrowserCapture(hostRuntime));
  Object.assign(hostRuntime, createBrowserRuntimeBudget(hostRuntime));
  Object.assign(hostRuntime, createBrowserRuntimeAttachment(hostRuntime));
  Object.assign(hostRuntime, createBrowserRuntimeTeardown(hostRuntime));
  hostRuntime.window = null;
  hostRuntime.activeThreadId = null;
  hostRuntime.activeBounds = null;
  hostRuntime.activeBoundsThreadId = null;
  hostRuntime.activePageZoomFactor = 1;
  hostRuntime.activePageZoomThreadId = null;
  hostRuntime.attachedRuntimeKey = null;
  hostRuntime.attachedBoundsSignature = null;
  hostRuntime.states = new Map<ThreadId, ThreadBrowserState>();
  hostRuntime.threadVersionById = new Map<ThreadId, number>();
  hostRuntime.snapshotCacheByThreadId = new Map<
    ThreadId,
    { version: number; snapshot: ThreadBrowserState }
  >();
  hostRuntime.lastEmittedVersionByThreadId = new Map<ThreadId, number>();
  hostRuntime.humanControlEpochByThreadId = new Map<ThreadId, number>();
  hostRuntime.humanControlListenersByThreadId = new Map<
    ThreadId,
    Set<BrowserHumanControlListener>
  >();
  hostRuntime.expectedAutomationInputsByRuntimeKey = new Map<
    string,
    ReadonlyArray<PendingBrowserAutomationInput>
  >();
  hostRuntime.automationGestureDepthByRuntimeKey = new Map<string, number>();
  hostRuntime.automationWindowOpenListenersByRuntimeKey = new Map<
    string,
    Set<BrowserAutomationWindowOpenListener>
  >();
  hostRuntime.automationDownloadListenersByRuntimeKey = new Map<
    string,
    Set<BrowserAutomationDownloadLease>
  >();
  hostRuntime.automationSideEffectProvenanceByRuntimeKey = new Map<
    string,
    BrowserAutomationSideEffectProvenance
  >();
  hostRuntime.pendingWindowOpenTasksByRuntimeKey = new Map<string, PendingWindowOpenTask>();
  hostRuntime.pendingAutomationWindowOpenCommitsByRuntimeKey = new Map<
    string,
    PendingAutomationWindowOpenCommit
  >();
  hostRuntime.pendingStatePublicationsByKey = new Map<string, PendingStatePublication>();
  hostRuntime.runtimes = new Map<string, LiveTabRuntime>();
  hostRuntime.runtimePageZoomFactors = new Map<string, number>();
  hostRuntime.rendererOnlyRuntimeKeys = new Set<string>();
  hostRuntime.automationRuntimeKeys = new Set<string>();
  hostRuntime.automationRuntimeProtectedUntilByKey = new Map<string, number>();
  hostRuntime.runtimeLastActiveAtByKey = new Map<string, number>();
  hostRuntime.pendingRuntimeSyncs = new Map<string, PendingRuntimeSync>();
  hostRuntime.listeners = new Set<BrowserStateListener>();
  hostRuntime.copyLinkListeners = new Set<BrowserCopyLinkListener>();
  hostRuntime.popupRuntimes = new Map<BrowserWindow, OAuthPopupRuntime>();
  hostRuntime.previewThreadIds = new Set<ThreadId>();
  hostRuntime.tabSuspendTimers = new Map<string, ReturnType<typeof setTimeout>>();
  hostRuntime.suspendTimers = new Map<ThreadId, ReturnType<typeof setTimeout>>();
  hostRuntime.backgroundAutomationEvictionTimer = null;
  hostRuntime.runtimeSyncFlushScheduled = false;
  hostRuntime.disposed = false;
  hostRuntime.perfCounters = {
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
  };
  hostRuntime.humanBrowserOperations = 0;
  hostRuntime.options = options;

  hostRuntime.sessionPolicy = new BrowserSessionPolicy((event) => {
    hostRuntime.handleSessionDownload(event);
  });
  hostRuntime.annotations = new BrowserAnnotationCoordinator({
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

  return hostRuntime;
}
