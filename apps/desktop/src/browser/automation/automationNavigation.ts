import { type BrowserTabId } from "@glade/contracts/browser/automation/browserAutomationIds";
import {
  type BrowserResizeInput,
  type BrowserToolNavigateInput,
  type BrowserToolOpenInput,
} from "@glade/contracts/browser/automation/browserAutomationToolInputs";
import {
  type BrowserCloseOutput,
  type BrowserNavigateOutput,
  type BrowserOpenOutput,
  type BrowserResizeOutput,
} from "@glade/contracts/browser/automation/browserAutomationToolOutputs";
import { type ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import type { BrowserAutomationVisibleRuntime } from "../browserTabState";
import { SessionAffinity, validateWebUrl } from "./automationHostPolicy";
import { type BrowserAutomationHostRuntime } from "./automationHostRuntimeTypes";
import { abortReason, observePage, sendCdpCommand, throwIfAborted } from "./cdpRuntime";
import { withDialogHandling } from "./dialogHandling";
import { BrowserAutomationHostError, browserHostError } from "./hostErrors";
import {
  beginBrowserNavigation,
  getBrowserNavigationTracker,
  stopBrowserNavigation,
  type BrowserNavigationMark,
  type BrowserNavigationObservation,
} from "./navigationTracker";
import { waitForLoadMilestone } from "./waitAndEvaluate";

export function createAutomationNavigation(
  hostRuntime: Pick<
    BrowserAutomationHostRuntime,
    | "browserManager"
    | "withVisibilityLock"
    | "withLock"
    | "withHumanControlGuard"
    | "resolveAutomationRuntime"
    | "requestPanelReveal"
    | "withDownloadGuard"
  >,
) {
  async function open(
    affinity: SessionAffinity,
    input: BrowserToolOpenInput,
    signal: AbortSignal,
    abortError: BrowserAutomationHostError,
    interruptByHuman: (error: BrowserAutomationHostError) => void,
    markActionStarted: () => void,
  ): Promise<BrowserOpenOutput> {
    throwIfAborted(signal);
    const url = input.url === undefined ? undefined : validateWebUrl(input.url);
    const show = input.show ?? true;
    const before = hostRuntime.browserManager.getState({ threadId: affinity.threadId });
    const hiddenTabId = !show && (input.reuse ?? true) ? before.activeTabId : null;
    if (!show) {
      if (!hiddenTabId) {
        browserHostError({
          code: "BrowserHostUnavailable",
          retryable: true,
          phase: "runtime",
          effectMayHaveCommitted: false,
        });
      }
    }
    throwIfAborted(signal);

    const prepared = show
      ? await hostRuntime.withVisibilityLock(affinity.threadId, signal, abortError, async () => {
          markActionStarted();
          return hostRuntime.browserManager.prepareAutomationTab({
            threadId: affinity.threadId,
            reuse: input.reuse ?? true,
          });
        })
      : before;
    const selected = show ? prepared.activeTabId : hiddenTabId;
    if (!selected) throw new Error("Browser open did not create a tab.");
    const disposition = before.tabs.some((tab) => tab.id === selected) ? "reused" : "created";
    return hostRuntime.withLock(
      `tab:${affinity.threadId}:${selected}`,
      () =>
        hostRuntime.withHumanControlGuard(
          affinity.threadId,
          selected,
          true,
          signal,
          interruptByHuman,
          async () => {
            throwIfAborted(signal);
            if (!show) {
              await hostRuntime.resolveAutomationRuntime(affinity, selected, signal, false);
            }
            const executeOpen = async (): Promise<BrowserOpenOutput> => {
              markActionStarted();
              if (!show) {
                const visibleState = hostRuntime.browserManager.getState({
                  threadId: affinity.threadId,
                });
                if (
                  visibleState.activeTabId !== selected ||
                  !visibleState.tabs.some((tab) => tab.id === selected)
                ) {
                  browserHostError({
                    code: "BrowserHostUnavailable",
                    retryable: true,
                    phase: "runtime",
                    effectMayHaveCommitted: false,
                    tabId: selected as BrowserTabId,
                  });
                }
              } else if (!url) {
                hostRuntime.browserManager.selectAutomationTab({
                  threadId: affinity.threadId,
                  tabId: selected,
                });
              }
              affinity.tabId = selected;
              if (!url) {
                if (show) hostRuntime.requestPanelReveal(affinity.threadId);
                throwIfAborted(signal);
                const tab = prepared.tabs.find((candidate) => candidate.id === selected);
                return {
                  tabId: selected as BrowserTabId,
                  finalUrl: tab?.lastCommittedUrl ?? tab?.url ?? "about:blank",
                  redirects: [],
                  loadState: "load" as const,
                  disposition,
                };
              }
              return hostRuntime.withDownloadGuard(
                affinity.threadId,
                selected,
                signal,
                interruptByHuman,
                async () => {
                  hostRuntime.browserManager.prepareAutomationNavigation({
                    threadId: affinity.threadId,
                    tabId: selected,
                    url,
                  });
                  const runtime = await hostRuntime.resolveAutomationRuntime(
                    affinity,
                    selected,
                    signal,
                    show,
                    false,
                  );
                  return withDialogs(runtime, signal, async () => {
                    const loaded = await navigateOrObserve(
                      runtime,
                      url,
                      "domcontentloaded",
                      input.timeoutMs ?? 15_000,
                      signal,
                    );
                    return {
                      tabId: selected as BrowserTabId,
                      finalUrl: validateWebUrl(loaded.url, true),
                      redirects: loaded.redirects
                        .map((redirect) => validateWebUrl(redirect, true))
                        .slice(0, 20),
                      loadState: loaded.state,
                      disposition,
                    };
                  });
                },
              );
            };
            return hostRuntime.withVisibilityLock(
              affinity.threadId,
              signal,
              abortError,
              executeOpen,
            );
          },
        ),
      signal,
      abortError,
    );
  }

  async function navigate(
    runtime: BrowserAutomationVisibleRuntime,
    input: BrowserToolNavigateInput,
    url: string,
    signal: AbortSignal,
  ): Promise<BrowserNavigateOutput> {
    throwIfAborted(signal);
    const loaded = await navigateOrObserve(
      runtime,
      url,
      input.waitUntil ?? "domcontentloaded",
      input.timeoutMs ?? 15_000,
      signal,
    );
    return {
      tabId: runtime.tabId as BrowserTabId,
      finalUrl: validateWebUrl(loaded.url, true),
      redirects: loaded.redirects.map((redirect) => validateWebUrl(redirect, true)).slice(0, 20),
      loadState: loaded.state,
    };
  }

  async function navigateOrObserve(
    runtime: BrowserAutomationVisibleRuntime,
    url: string,
    expected: "commit" | "domcontentloaded" | "load" | "networkidle",
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<BrowserNavigationObservation> {
    if (runtime.webContents.getURL() !== url) {
      const navigation = await beginBrowserNavigation(runtime, url, signal);
      return waitForNavigation(
        runtime,
        navigation.tracker,
        navigation.mark,
        expected,
        timeoutMs,
        signal,
      );
    }
    return waitForLoadMilestone(runtime, expected, timeoutMs, signal);
  }

  async function waitForNavigation(
    runtime: BrowserAutomationVisibleRuntime,
    tracker: Awaited<ReturnType<typeof getBrowserNavigationTracker>>,
    mark: BrowserNavigationMark,
    expected: "commit" | "domcontentloaded" | "load" | "networkidle",
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<BrowserNavigationObservation> {
    try {
      return await tracker.wait(runtime, expected, timeoutMs, signal, mark);
    } catch (error) {
      if (signal.aborted) {
        // The public call is already rejected by executeTool's abort race, but hold the tab lock until
        // Chromium has acknowledged stopLoading.
        await stopBrowserNavigation(runtime);
        throw abortReason(signal);
      }
      throw error;
    }
  }

  async function withDialogs<T>(
    runtime: BrowserAutomationVisibleRuntime,
    signal: AbortSignal,
    operation: () => Promise<T>,
  ): Promise<T> {
    const handled = await withDialogHandling(runtime, operation, signal);
    if (handled.dialogs.length === 0 || !handled.value || typeof handled.value !== "object") {
      return handled.value;
    }
    const value = handled.value as Record<string, unknown>;
    const structured = value.structuredContent;
    if (structured && typeof structured === "object" && !Array.isArray(structured)) {
      return {
        ...value,
        structuredContent: {
          ...(structured as Record<string, unknown>),
          dialogs: [...handled.dialogs],
        },
      } as T;
    }
    return { ...value, dialogs: [...handled.dialogs] } as T;
  }

  async function resize(
    runtime: BrowserAutomationVisibleRuntime,
    input: BrowserResizeInput,
    _sessionId: string,
    signal: AbortSignal,
  ): Promise<BrowserResizeOutput> {
    const page = await observePage(runtime, signal);
    await sendCdpCommand(
      runtime,
      "Emulation.setDeviceMetricsOverride",
      {
        width: input.width,
        height: input.height,
        deviceScaleFactor: page.viewport.deviceScaleFactor,
        mobile: false,
        screenWidth: input.width,
        screenHeight: input.height,
      },
      signal,
      { effectMayHaveCommitted: true },
    );
    const observed = await observePage(runtime, signal);
    return {
      tabId: runtime.tabId as BrowserTabId,
      requested: { width: input.width, height: input.height },
      observed: observed.viewport,
    };
  }

  function close(affinity: SessionAffinity, tabId: string): BrowserCloseOutput {
    const state: ThreadBrowserState = hostRuntime.browserManager.closeAutomationTab({
      threadId: affinity.threadId,
      tabId,
    });
    affinity.tabId = state.activeTabId;
    return {
      closedTabId: tabId as BrowserTabId,
      activeTabId: state.activeTabId as BrowserTabId | null,
    };
  }

  return { open, navigate, withDialogs, resize, close };
}
