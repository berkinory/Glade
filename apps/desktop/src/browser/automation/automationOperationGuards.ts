import { type BrowserTabId } from "@glade/contracts/browser/automation/browserAutomationIds";
import { type BrowserToolName } from "@glade/contracts/browser/automation/browserAutomationToolCatalogue";
import { type ThreadId } from "@glade/contracts/core/baseSchemas";
import { BROWSER_TOOL_DEFINITIONS_BY_NAME } from "@glade/shared/browser/browserAutomationCatalogue";
import type { BrowserAutomationVisibleRuntime } from "../browserTabState";
import {
  abortHostError,
  raceWithAbort,
  raceWithSignal,
  SessionAffinity,
  sleep,
} from "./automationHostPolicy";
import { type BrowserAutomationHostRuntime } from "./automationHostRuntimeTypes";
import { abortReason, throwIfAborted } from "./cdpRuntime";
import { BrowserAutomationHostError, browserHostError } from "./hostErrors";

export function createAutomationOperationGuards(
  hostRuntime: Pick<
    BrowserAutomationHostRuntime,
    "lockTails" | "browserManager" | "diagnostics" | "requestOpenPanel"
  >,
) {
  async function withLock<T>(
    key: string,
    action: () => Promise<T>,
    signal?: AbortSignal,
    abortError?: BrowserAutomationHostError,
  ): Promise<T> {
    const previous = hostRuntime.lockTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => tail);
    hostRuntime.lockTails.set(key, chain);
    try {
      if (signal && abortError) await raceWithAbort(previous, signal, abortError);
      else await previous;
      if (signal?.aborted && abortError) throw abortHostError(signal, abortError);
      // Do not race the action here. executeTool already races the public result, while this internal
      // promise must drain before releasing the lock so a late Electron/CDP completion can never overlap
      // the next browser action.
      return await action();
    } finally {
      release();
      void chain.finally(() => {
        if (hostRuntime.lockTails.get(key) === chain) hostRuntime.lockTails.delete(key);
      });
    }
  }

  function withVisibilityLock<T>(
    threadId: ThreadId,
    signal: AbortSignal,
    abortError: BrowserAutomationHostError,
    action: () => Promise<T>,
  ): Promise<T> {
    return withLock(`visibility:${threadId}`, action, signal, abortError);
  }

  async function withHumanControlGuard<T>(
    threadId: ThreadId,
    tabId: string,
    effectMayHaveCommitted: boolean,
    signal: AbortSignal,
    interrupt: (error: BrowserAutomationHostError) => void,
    action: () => Promise<T> | T,
  ): Promise<T> {
    const epoch = hostRuntime.browserManager.getAutomationHumanControlEpoch(threadId);
    const humanError = new BrowserAutomationHostError({
      code: "BrowserInterruptedByHuman",
      retryable: true,
      phase: "runtime",
      effectMayHaveCommitted,
      tabId: tabId as BrowserTabId,
    });
    try {
      if (
        hostRuntime.browserManager.isHumanBrowserOperationActive() ||
        hostRuntime.browserManager.getAutomationHumanControlEpoch(threadId) !== epoch
      ) {
        interrupt(humanError);
      }
      throwIfAborted(signal);
      const result = await action();
      if (hostRuntime.browserManager.getAutomationHumanControlEpoch(threadId) !== epoch) {
        interrupt(humanError);
      }
      throwIfAborted(signal);
      return result;
    } catch (error) {
      if (hostRuntime.browserManager.getAutomationHumanControlEpoch(threadId) !== epoch) {
        interrupt(humanError);
      }
      if (signal.aborted) throw abortReason(signal);
      throw error;
    }
  }

  async function withDownloadGuard<T>(
    threadId: ThreadId,
    tabId: string,
    signal: AbortSignal,
    interrupt: (error: BrowserAutomationHostError) => void,
    action: () => Promise<T> | T,
  ): Promise<T> {
    const downloadError = new BrowserAutomationHostError({
      code: "BrowserDownloadApprovalRequired",
      retryable: false,
      phase: "input",
      effectMayHaveCommitted: true,
      tabId: tabId as BrowserTabId,
    });
    const releaseTracking = hostRuntime.browserManager.trackAutomationDownload(
      { threadId, tabId },
      () => interrupt(downloadError),
    );
    try {
      const result = await action();
      // CDP acknowledges native input before Electron necessarily emits the resulting session event. Keep
      // the gesture lease through one main-loop turn so a download cannot escape between command
      // completion and cleanup.
      await sleep(0, signal);
      throwIfAborted(signal);
      return result;
    } catch (error) {
      if (signal.aborted) throw abortReason(signal);
      throw error;
    } finally {
      releaseTracking();
    }
  }

  function withDownloadGuardIfEffecting<T>(
    toolName: BrowserToolName,
    threadId: ThreadId,
    tabId: string,
    signal: AbortSignal,
    interrupt: (error: BrowserAutomationHostError) => void,
    action: () => Promise<T> | T,
  ): Promise<T> {
    if (BROWSER_TOOL_DEFINITIONS_BY_NAME[toolName].annotations.readOnlyHint) {
      return Promise.resolve().then(action);
    }
    return withDownloadGuard(threadId, tabId, signal, interrupt, action);
  }

  function resolveTabId(affinity: SessionAffinity, requested: unknown): string {
    const state = hostRuntime.browserManager.getState({ threadId: affinity.threadId });
    const tabId = typeof requested === "string" ? requested : (affinity.tabId ?? state.activeTabId);
    if (!tabId || !state.tabs.some((tab) => tab.id === tabId)) {
      browserHostError({
        code: "BrowserTabNotFound",
        retryable: false,
        phase: "routing",
        effectMayHaveCommitted: false,
      });
    }
    affinity.tabId = tabId;
    return tabId;
  }

  async function resolveAutomationRuntime(
    affinity: SessionAffinity,
    tabId: string,
    signal: AbortSignal,
    reveal: boolean,
    restore = true,
  ): Promise<BrowserAutomationVisibleRuntime> {
    throwIfAborted(signal);
    hostRuntime.browserManager.selectAutomationTab({ threadId: affinity.threadId, tabId });
    throwIfAborted(signal);
    if (reveal) requestPanelReveal(affinity.threadId);
    throwIfAborted(signal);
    try {
      const runtime = await raceWithSignal(
        hostRuntime.browserManager.getAutomationRuntime(
          { threadId: affinity.threadId, tabId },
          { restore },
        ),
        signal,
      );
      throwIfAborted(signal);
      await hostRuntime.diagnostics.observe(runtime, signal);
      return runtime;
    } catch {
      throwIfAborted(signal);
      browserHostError({
        code: "BrowserHostUnavailable",
        retryable: true,
        phase: "runtime",
        effectMayHaveCommitted: false,
        tabId: tabId as BrowserTabId,
      });
    }
  }

  function requestPanelReveal(threadId: ThreadId): void {
    if (!hostRuntime.requestOpenPanel) return;
    // Revealing is opportunistic UI feedback, not a prerequisite for browser execution. The renderer
    // opens the panel only when this thread is already active; a slow/backgrounded UI must never stall
    // the agent runtime.
    try {
      void Promise.resolve(hostRuntime.requestOpenPanel(threadId)).catch(() => undefined);
    } catch {}
  }

  return {
    withLock,
    withVisibilityLock,
    withHumanControlGuard,
    withDownloadGuard,
    withDownloadGuardIfEffecting,
    resolveTabId,
    resolveAutomationRuntime,
    requestPanelReveal,
  };
}
