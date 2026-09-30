import { type BrowserTabId } from "@glade/contracts/browser/automation/browserAutomationIds";
import {
  type BrowserBackInput,
  type BrowserForwardInput,
  type BrowserLogsInput,
  type BrowserReloadInput,
  type BrowserResizeInput,
  type BrowserRunInput,
  type BrowserScreenshotInput,
  type BrowserToolNavigateInput,
  type BrowserToolOpenInput,
  type BrowserUploadInput,
} from "@glade/contracts/browser/automation/browserAutomationToolInputs";
import {
  type BrowserStatusOutput,
  type BrowserTabsOutput,
} from "@glade/contracts/browser/automation/browserAutomationToolOutputs";
import { BROWSER_TOOL_DEFINITIONS_BY_NAME } from "@glade/shared/browser/browserAutomationCatalogue";
import { app } from "electron";
import { join } from "node:path";
import type { BrowserAutomationVisibleRuntime } from "../browserTabState";
import {
  BrowserAutomationToolRequest,
  browserHistoryDirection,
  browserTabLifecycleState,
  SessionAffinity,
  TabToolExecution,
  uncorrelatedExecution,
  validateWebUrl,
  WindowOpenObservation,
} from "./automationHostPolicy";
import { type BrowserAutomationHostRuntime } from "./automationHostRuntimeTypes";
import { runBetterwright } from "./betterwrightRuntime";
import { throwIfAborted } from "./cdpRuntime";
import { BrowserAutomationHostError, browserHostError } from "./hostErrors";
import { navigateBrowserHistory } from "./navigationHistory";
import { captureBrowserScreenshot } from "./screenshotCapture";
import { browserEvaluationOutput } from "./waitAndEvaluate";

export function createAutomationToolDispatch(
  hostRuntime: Pick<
    BrowserAutomationHostRuntime,
    | "open"
    | "browserManager"
    | "options"
    | "resolveTabId"
    | "withLock"
    | "withVisibilityLock"
    | "withHumanControlGuard"
    | "close"
    | "withDownloadGuardIfEffecting"
    | "resolveAutomationRuntime"
    | "withDialogs"
    | "navigate"
    | "observeWindowOpen"
    | "resize"
    | "diagnostics"
    | "uploadBrowserFiles"
    | "reconcileWindowOpen"
  >,
) {
  async function dispatch(
    request: BrowserAutomationToolRequest,
    input: Record<string, unknown>,
    affinity: SessionAffinity,
    signal: AbortSignal,
    abortError: BrowserAutomationHostError,
    interruptByHuman: (error: BrowserAutomationHostError) => void,
    markActionStarted: () => void,
  ): Promise<unknown> {
    switch (request.name) {
      case "browser_status":
        return status(affinity);
      case "browser_tabs":
        return tabs(affinity);
      case "browser_open":
        return hostRuntime.open(
          affinity,
          input as BrowserToolOpenInput,
          signal,
          abortError,
          interruptByHuman,
          markActionStarted,
        );
    }

    const annotationTarget =
      request.name === "browser_navigate" && typeof input.annotationId === "string"
        ? hostRuntime.browserManager.resolveAnnotationNavigationTarget({
            threadId: affinity.threadId,
            annotationId: input.annotationId,
            ...(typeof input.tabId === "string" ? { tabId: input.tabId } : {}),
          })
        : null;
    if (request.name === "browser_navigate" && typeof input.annotationId === "string") {
      if (!annotationTarget) {
        browserHostError({
          code: "BrowserNavigationBlocked",
          retryable: false,
          phase: "navigation",
          effectMayHaveCommitted: false,
        });
      }
      affinity.tabId = annotationTarget.tabId;
    }
    const targetTabId = annotationTarget?.tabId ?? hostRuntime.resolveTabId(affinity, input.tabId);
    return hostRuntime.withLock(
      `tab:${affinity.threadId}:${targetTabId}`,
      () =>
        hostRuntime.withVisibilityLock(affinity.threadId, signal, abortError, async () => {
          const execution = await hostRuntime.withHumanControlGuard(
            affinity.threadId,
            targetTabId,
            !BROWSER_TOOL_DEFINITIONS_BY_NAME[request.name].annotations.readOnlyHint,
            signal,
            interruptByHuman,
            () => {
              markActionStarted();
              return executeTabTool(
                request,
                input,
                affinity,
                targetTabId,
                signal,
                interruptByHuman,
              );
            },
          );
          return reconcileTabToolExecution(request, affinity, targetTabId, execution);
        }),
      signal,
      abortError,
    );
  }

  async function executeTabTool(
    request: BrowserAutomationToolRequest,
    input: Record<string, unknown>,
    affinity: SessionAffinity,
    targetTabId: string,
    signal: AbortSignal,
    interruptByHuman: (error: BrowserAutomationHostError) => void,
  ): Promise<TabToolExecution> {
    throwIfAborted(signal);
    if (request.name === "browser_close") {
      return uncorrelatedExecution(hostRuntime.close(affinity, targetTabId));
    }

    return hostRuntime.withDownloadGuardIfEffecting(
      request.name,
      affinity.threadId,
      targetTabId,
      signal,
      interruptByHuman,
      () => executeDownloadGuardedTabTool(request, input, affinity, targetTabId, signal),
    );
  }

  async function executeDownloadGuardedTabTool(
    request: BrowserAutomationToolRequest,
    input: Record<string, unknown>,
    affinity: SessionAffinity,
    targetTabId: string,
    signal: AbortSignal,
  ): Promise<TabToolExecution> {
    if (request.name === "browser_navigate") {
      const navigateInput = input as BrowserToolNavigateInput;
      const resolvedUrl =
        navigateInput.annotationId === undefined
          ? navigateInput.url
          : hostRuntime.browserManager.resolveAnnotationNavigationTarget({
              threadId: affinity.threadId,
              tabId: targetTabId,
              annotationId: navigateInput.annotationId,
            })?.url;
      if (!resolvedUrl) {
        browserHostError({
          code: "BrowserNavigationBlocked",
          retryable: false,
          phase: "navigation",
          tabId: targetTabId as BrowserTabId,
          effectMayHaveCommitted: false,
        });
      }
      const url = validateWebUrl(resolvedUrl);
      hostRuntime.browserManager.prepareAutomationNavigation({
        threadId: affinity.threadId,
        tabId: targetTabId,
        url,
      });
      const runtime = await hostRuntime.resolveAutomationRuntime(
        affinity,
        targetTabId,
        signal,
        true,
        false,
      );
      return uncorrelatedExecution(
        await hostRuntime.withDialogs(runtime, signal, () =>
          hostRuntime.navigate(runtime, navigateInput, url, signal),
        ),
      );
    }

    const historyDirection = browserHistoryDirection(request.name);
    if (historyDirection) {
      const runtime = await hostRuntime.resolveAutomationRuntime(
        affinity,
        targetTabId,
        signal,
        true,
      );
      return uncorrelatedExecution(
        await hostRuntime.withDialogs(runtime, signal, () =>
          navigateBrowserHistory(
            runtime,
            historyDirection,
            input as BrowserBackInput | BrowserForwardInput | BrowserReloadInput,
            signal,
          ),
        ),
      );
    }

    const runtime = await hostRuntime.resolveAutomationRuntime(affinity, targetTabId, signal, true);
    const windowOpen =
      request.name === "browser_run" ? hostRuntime.observeWindowOpen(runtime) : null;
    try {
      return await executeVisibleTool(
        request,
        input,
        affinity,
        targetTabId,
        runtime,
        windowOpen,
        signal,
      );
    } finally {
      windowOpen?.dispose();
    }
  }

  async function executeVisibleTool(
    request: BrowserAutomationToolRequest,
    input: Record<string, unknown>,
    _affinity: SessionAffinity,
    targetTabId: string,
    runtime: BrowserAutomationVisibleRuntime,
    windowOpen: WindowOpenObservation | null,
    signal: AbortSignal,
  ): Promise<TabToolExecution> {
    let openedTabId: string | null = null;
    let oauthPopup = false;
    if (!BROWSER_TOOL_DEFINITIONS_BY_NAME[request.name].annotations.readOnlyHint) {
      hostRuntime.options.vaultCapture?.noteAgentActivity(runtime);
    }
    const output = await hostRuntime.withDialogs(runtime, signal, async () => {
      switch (request.name) {
        case "browser_resize":
          return hostRuntime.resize(
            runtime,
            input as BrowserResizeInput,
            request.sessionId,
            signal,
          );
        case "browser_screenshot":
          return captureBrowserScreenshot(runtime, input as BrowserScreenshotInput, signal);
        case "browser_logs":
          return hostRuntime.diagnostics.read(runtime, input as BrowserLogsInput, signal);
        case "browser_upload":
          return hostRuntime.uploadBrowserFiles(
            runtime,
            input as BrowserUploadInput,
            request.workspaceRoot,
            signal,
          );
        case "browser_run": {
          let value: unknown;
          try {
            value = await runBetterwright({
              home: join(app.getPath("userData"), "browser-engine"),
              contents: runtime.webContents,
              expectAgentInput: runtime.expectAgentInput,
              code: (input as BrowserRunInput).code,
              timeoutMs: (input.timeoutMs as number | undefined) ?? 15_000,
              signal,
              ...(hostRuntime.options.vault
                ? { vault: hostRuntime.options.vault.agentAdapter(runtime.webContents, signal) }
                : {}),
            });
          } catch (error) {
            throwIfAborted(signal);
            if (error instanceof BrowserAutomationHostError) throw error;
            browserHostError({
              code: "BrowserEvaluationFailed",
              retryable: false,
              phase: "evaluate",
              effectMayHaveCommitted: true,
            });
          }
          const correlation = await hostRuntime.reconcileWindowOpen(
            windowOpen!,
            input.timeoutMs as number | undefined,
            targetTabId,
            signal,
          );
          openedTabId = correlation.openedTabId;
          oauthPopup = correlation.oauthPopup;
          return browserEvaluationOutput(runtime.tabId, value);
        }
        default:
          browserHostError({ code: "BrowserInputUnsupported" });
      }
    });
    return { output, openedTabId, oauthPopup };
  }

  function reconcileTabToolExecution(
    request: BrowserAutomationToolRequest,
    affinity: SessionAffinity,
    targetTabId: string,
    execution: TabToolExecution,
  ): unknown {
    const result = execution.output;
    if (request.name !== "browser_run") {
      return result;
    }

    const reconciledResult =
      execution.oauthPopup && result !== null && typeof result === "object"
        ? {
            ...result,
            humanActionRequired: {
              kind: "oauth_popup" as const,
              instruction: "Complete sign-in in the visible popup before continuing." as const,
            },
          }
        : result;
    const state = hostRuntime.browserManager.getState({ threadId: affinity.threadId });
    const openedTabId = execution.openedTabId ?? state.activeTabId;
    if (
      !openedTabId ||
      openedTabId === targetTabId ||
      !state.tabs.some((tab) => tab.id === openedTabId)
    ) {
      return reconciledResult;
    }

    affinity.tabId = openedTabId;
    return reconciledResult && typeof reconciledResult === "object"
      ? { ...reconciledResult, openedTabId: openedTabId as BrowserTabId }
      : reconciledResult;
  }

  function status(affinity: SessionAffinity): BrowserStatusOutput {
    return {
      available: true,
      physicalScope: "visible-shared-electron-webview",
      assignedTabId: affinity.tabId as BrowserTabId | null,
      authorization: "not-required",
    };
  }

  function tabs(affinity: SessionAffinity): BrowserTabsOutput {
    const state = hostRuntime.browserManager.getState({ threadId: affinity.threadId });
    return {
      tabs: state.tabs.slice(0, 24).map((tab) => ({
        tabId: tab.id as BrowserTabId,
        title: tab.title,
        url: tab.lastCommittedUrl ?? tab.url,
        active: state.activeTabId === tab.id,
        loading: tab.isLoading,
        routable: state.open,
        state: browserTabLifecycleState(tab),
      })),
      activeTabId: state.activeTabId as BrowserTabId | null,
      assignedTabId: affinity.tabId as BrowserTabId | null,
    };
  }

  return { dispatch };
}
