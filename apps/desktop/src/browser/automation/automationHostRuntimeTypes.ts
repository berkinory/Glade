import { type BrowserToolName } from "@glade/contracts/browser/automation/browserAutomationToolCatalogue";
import {
  type BrowserResizeInput,
  type BrowserToolNavigateInput,
  type BrowserToolOpenInput,
  type BrowserUploadInput,
} from "@glade/contracts/browser/automation/browserAutomationToolInputs";
import type { BrowserUploadOutput } from "@glade/contracts/browser/automation/browserAutomationToolOutputs";
import {
  type BrowserCloseOutput,
  type BrowserNavigateOutput,
  type BrowserOpenOutput,
  type BrowserResizeOutput,
} from "@glade/contracts/browser/automation/browserAutomationToolOutputs";
import { type ThreadId } from "@glade/contracts/core/baseSchemas";
import type { DesktopBrowserManager } from "../browserManager";
import type { BrowserAutomationVisibleRuntime } from "../browserTabState";
import {
  BrowserAutomationToolRequest,
  DesktopBrowserAutomationHostOptions,
  IdempotencyEntry,
  IdempotencyTombstone,
  SessionAffinity,
  TabToolExecution,
  WindowOpenObservation,
} from "./automationHostPolicy";
import { BrowserDiagnosticsStore } from "./browserDiagnostics";
import { BrowserAutomationHostError } from "./hostErrors";

export interface BrowserAutomationHostRuntime {
  readonly options: DesktopBrowserAutomationHostOptions;
  readonly browserManager: DesktopBrowserManager;
  readonly affinities: Map<string, SessionAffinity>;
  readonly idempotency: Map<string, IdempotencyEntry>;
  readonly idempotencyTombstones: Map<string, IdempotencyTombstone>;
  readonly lockTails: Map<string, Promise<void>>;
  readonly activeOperations: Set<Promise<unknown>>;
  readonly diagnostics: BrowserDiagnosticsStore;
  readonly uploadBrowserFiles: (
    runtime: BrowserAutomationVisibleRuntime,
    input: BrowserUploadInput,
    workspaceRoot: string | null | undefined,
    signal?: AbortSignal,
  ) => Promise<BrowserUploadOutput>;
  readonly requestOpenPanel: ((threadId: ThreadId) => void | Promise<void>) | undefined;
  disposed: boolean;
  disposal: Promise<void> | null;
  dispose: () => Promise<void>;
  waitForIdle: () => Promise<void>;
  executeTool: (request: BrowserAutomationToolRequest) => Promise<unknown>;
  trimIdempotencyCache: () => void;
  reconcileIdempotentReplay: (
    _request: BrowserAutomationToolRequest,
    affinity: SessionAffinity,
    result: Promise<unknown>,
  ) => Promise<unknown>;
  bindSession: (request: BrowserAutomationToolRequest) => SessionAffinity;
  withLock: <T>(
    key: string,
    action: () => Promise<T>,
    signal?: AbortSignal,
    abortError?: BrowserAutomationHostError,
  ) => Promise<T>;
  withVisibilityLock: <T>(
    threadId: ThreadId,
    signal: AbortSignal,
    abortError: BrowserAutomationHostError,
    action: () => Promise<T>,
  ) => Promise<T>;
  withHumanControlGuard: <T>(
    threadId: ThreadId,
    tabId: string,
    effectMayHaveCommitted: boolean,
    signal: AbortSignal,
    interrupt: (error: BrowserAutomationHostError) => void,
    action: () => Promise<T> | T,
  ) => Promise<T>;
  withDownloadGuard: <T>(
    threadId: ThreadId,
    tabId: string,
    signal: AbortSignal,
    interrupt: (error: BrowserAutomationHostError) => void,
    action: () => Promise<T> | T,
  ) => Promise<T>;
  withDownloadGuardIfEffecting: <T>(
    toolName: BrowserToolName,
    threadId: ThreadId,
    tabId: string,
    signal: AbortSignal,
    interrupt: (error: BrowserAutomationHostError) => void,
    action: () => Promise<T> | T,
  ) => Promise<T>;
  resolveTabId: (affinity: SessionAffinity, requested: unknown) => string;
  resolveAutomationRuntime: (
    affinity: SessionAffinity,
    tabId: string,
    signal: AbortSignal,
    reveal: boolean,
    restore?: boolean,
  ) => Promise<BrowserAutomationVisibleRuntime>;
  requestPanelReveal: (threadId: ThreadId) => void;
  observeWindowOpen: (runtime: BrowserAutomationVisibleRuntime) => WindowOpenObservation;
  reconcileWindowOpen: (
    observation: WindowOpenObservation,
    timeoutMs: number | undefined,
    targetTabId: string,
    signal: AbortSignal,
  ) => Promise<Pick<TabToolExecution, "openedTabId" | "oauthPopup">>;
  dispatch: (
    request: BrowserAutomationToolRequest,
    input: Record<string, unknown>,
    affinity: SessionAffinity,
    signal: AbortSignal,
    abortError: BrowserAutomationHostError,
    interruptByHuman: (error: BrowserAutomationHostError) => void,
    markActionStarted: () => void,
  ) => Promise<unknown>;
  open: (
    affinity: SessionAffinity,
    input: BrowserToolOpenInput,
    signal: AbortSignal,
    abortError: BrowserAutomationHostError,
    interruptByHuman: (error: BrowserAutomationHostError) => void,
    markActionStarted: () => void,
  ) => Promise<BrowserOpenOutput>;
  navigate: (
    runtime: BrowserAutomationVisibleRuntime,
    input: BrowserToolNavigateInput,
    url: string,
    signal: AbortSignal,
  ) => Promise<BrowserNavigateOutput>;
  withDialogs: <T>(
    runtime: BrowserAutomationVisibleRuntime,
    signal: AbortSignal,
    operation: () => Promise<T>,
  ) => Promise<T>;
  resize: (
    runtime: BrowserAutomationVisibleRuntime,
    input: BrowserResizeInput,
    _sessionId: string,
    signal: AbortSignal,
  ) => Promise<BrowserResizeOutput>;
  close: (affinity: SessionAffinity, tabId: string) => BrowserCloseOutput;
}
