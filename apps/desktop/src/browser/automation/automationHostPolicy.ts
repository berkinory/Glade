import {
  BROWSER_TOOL_NAMES,
  type BrowserToolName,
} from "@glade/contracts/browser/automation/browserAutomationToolCatalogue";
import { type BrowserTabsOutput } from "@glade/contracts/browser/automation/browserAutomationToolOutputs";
import { type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import type { BrowserAutomationWindowOpenEvent } from "../browserTabState";
import type { BrowserVault } from "./browserVault";
import type { BrowserVaultCapture } from "./browserVaultCapture";
import { abortReason, throwIfAborted } from "./cdpRuntime";
import { BrowserAutomationHostError, browserHostError } from "./hostErrors";
import { type BrowserHistoryDirection } from "./navigationHistory";
export const MAX_IDEMPOTENCY_ENTRIES = 512;

export const IDEMPOTENCY_TTL_MS = 15 * 60_000;

export const MAX_IDEMPOTENCY_TOMBSTONES = 4_096;

export const IDEMPOTENCY_TOMBSTONE_TTL_MS = 24 * 60 * 60_000;

export const WINDOW_OPEN_RECONCILIATION_TIMEOUT_MS = 2_000;

const WINDOW_OPEN_EVENT_LOOP_GRACE_MS = 16;

export interface BrowserAutomationToolRequest {
  readonly sessionId: string;
  readonly provider: string;
  readonly threadId: ThreadId;
  readonly name: BrowserToolName;
  readonly arguments: unknown;

  readonly workspaceRoot?: string;
  readonly signal?: AbortSignal;
}

export interface DesktopBrowserAutomationHostOptions {
  readonly requestOpenPanel?: (threadId: ThreadId) => void | Promise<void>;
  readonly vault?: BrowserVault;
  readonly vaultCapture?: BrowserVaultCapture;
}

export interface SessionAffinity {
  readonly provider: string;
  readonly threadId: ThreadId;
  tabId: string | null;
}

export interface IdempotencyEntry {
  readonly fingerprint: string;
  readonly result: Promise<unknown>;
  settled: boolean;
  expiresAt: number;
  readonly effecting: boolean;
}

export interface IdempotencyTombstone {
  readonly fingerprint: string;
  readonly expiresAt: number;
}

export const isToolName = (value: string): value is BrowserToolName =>
  (BROWSER_TOOL_NAMES as readonly string[]).includes(value);

export const validateWebUrl = (value: string, effectMayHaveCommitted = false): string => {
  if (effectMayHaveCommitted && value === "about:blank") return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("scheme");
    return url.href;
  } catch {
    browserHostError({
      code: "BrowserNavigationBlocked",
      retryable: false,
      phase: "navigation",
      effectMayHaveCommitted,
    });
  }
};

export const sleep = (milliseconds: number, signal: AbortSignal): Promise<void> => {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

export const raceWithSignal = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
};

export const waitForWindowOpenEvent = (
  operation: Promise<BrowserAutomationWindowOpenEvent>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<BrowserAutomationWindowOpenEvent | null> => {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: BrowserAutomationWindowOpenEvent | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(error);
    };
    const onAbort = () => {
      fail(abortReason(signal));
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then((event) => finish(event), fail);
  });
};

export const waitOneTurnForWindowOpenEvent = (
  operation: Promise<BrowserAutomationWindowOpenEvent>,
  signal: AbortSignal,
): Promise<BrowserAutomationWindowOpenEvent | null> => {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: BrowserAutomationWindowOpenEvent | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(error);
    };
    const onAbort = () => {
      fail(abortReason(signal));
    };
    const timer = setTimeout(() => finish(null), WINDOW_OPEN_EVENT_LOOP_GRACE_MS);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then((event) => finish(event), fail);
  });
};

export interface WindowOpenObservation {
  reconcile(
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<BrowserAutomationWindowOpenEvent | null>;
  dispose(): void;
}

export interface TabToolExecution {
  readonly output: unknown;
  readonly openedTabId: string | null;
  readonly oauthPopup: boolean;
}

export function uncorrelatedExecution(output: unknown): TabToolExecution {
  return {
    output,
    openedTabId: null,
    oauthPopup: false,
  };
}

export function browserHistoryDirection(toolName: BrowserToolName): BrowserHistoryDirection | null {
  switch (toolName) {
    case "browser_back":
      return "back";
    case "browser_forward":
      return "forward";
    case "browser_reload":
      return "reload";
    default:
      return null;
  }
}

export function browserTabLifecycleState(
  tab: ThreadBrowserState["tabs"][number],
): BrowserTabsOutput["tabs"][number]["state"] {
  if (tab.lastError) {
    return "crashed";
  }
  return tab.status === "live" ? "live" : "restore-held";
}

export const abortHostError = (
  signal: AbortSignal,
  fallback: BrowserAutomationHostError,
): BrowserAutomationHostError =>
  signal.reason instanceof BrowserAutomationHostError ? signal.reason : fallback;

export const raceWithAbort = <T>(
  operation: Promise<T>,
  signal: AbortSignal,
  abortError: BrowserAutomationHostError,
): Promise<T> => {
  if (signal.aborted) return Promise.reject(abortHostError(signal, abortError));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortHostError(signal, abortError));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
};
