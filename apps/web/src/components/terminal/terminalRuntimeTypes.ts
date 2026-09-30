import type { TerminalSessionSnapshot } from "@glade/contracts/terminal/terminal";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  type TerminalActivityState,
  type TerminalCliKind,
} from "@glade/shared/threads/terminalThreads";
import { Terminal, type IDisposable } from "@xterm/xterm";
import type { TerminalLinkMatch } from "../../terminal-links";

import type { TerminalOutputWriter } from "./terminalImageWriter";

interface TerminalRuntimeCallbacks {
  onSessionExited: () => void;
  onTerminalMetadataChange: (
    terminalId: string,
    metadata: { cliKind: TerminalCliKind | null; label: string },
  ) => void;
  onTerminalActivityChange: (
    terminalId: string,
    activity: { hasRunningSubprocess: boolean; agentState: TerminalActivityState | null },
  ) => void;
  onTerminalRuntimeStatusChange?: (terminalId: string, status: TerminalRuntimeStatus) => void;
}

export function buildTerminalRuntimeKey(threadId: string, terminalId: string): string {
  return `${threadId}::${terminalId}`;
}

export interface TerminalRuntimeConfig {
  runtimeKey: string;
  threadId: string;
  terminalId: string;
  terminalLabel: string;
  terminalCliKind?: TerminalCliKind | null;
  cwd: string;
  runtimeEnv?: Record<string, string>;
  callbacks: TerminalRuntimeCallbacks;
}

export interface TerminalRuntimeViewState {
  autoFocus: boolean;
  isVisible: boolean;
}

interface TerminalPendingWrite {
  data: string;
  byteLength: number;
  queuedAt: number;
}

export type TerminalRuntimeStatus = "connecting" | "replaying" | "ready" | "exited" | "error";

export interface TerminalRuntimeEntry {
  runtimeKey: string;
  threadId: string;
  terminalId: string;
  terminalLabel: string;
  terminalCliKind: TerminalCliKind | null;
  cwd: string;
  runtimeEnv?: Record<string, string>;
  callbacks: TerminalRuntimeCallbacks;
  wrapper: HTMLDivElement;
  container: HTMLDivElement | null;
  terminal: Terminal;
  output: TerminalOutputWriter & { dispose: () => void };
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  webglAddon: WebglAddon | null;
  titleInputBuffer: string;
  hasHandledExit: boolean;
  runtimeStatus: TerminalRuntimeStatus;
  opened: boolean;
  openRetryTimer: number | null;
  disposed: boolean;
  resizeObserver: ResizeObserver | null;
  resizeDispatchTimer: number | null;
  visualResizeFrame: number | null;
  visualResizeTimer: number | null;
  lastVisualResizeAt: number;
  lastSentResize: { cols: number; rows: number } | null;
  pendingResize: { cols: number; rows: number } | null;
  writeRafHandle: number | null;
  writeFlushTimeout: number | null;
  pendingWrites: TerminalPendingWrite[];
  pendingWriteLength: number;
  pendingWriteBytes: number;
  linkMatchCache: Map<string, TerminalLinkMatch[]>;
  outputEventVersion: number;
  awaitingOpenSnapshot: boolean;
  applyOpenSnapshot: (snapshot: TerminalSessionSnapshot | null) => void;
  snapshotReconcileRequestId: number;
  webglLoadFrame: number | null;
  themeRefreshFrame: number;
  themeObserver: MutationObserver | null;
  visibilityCleanup: (() => void) | null;
  terminalDisposables: IDisposable[];
  attachDisposables: Array<() => void>;
  persistentDisposables: Array<() => void>;
  querySuppressionDispose: (() => void) | null;
  viewState: TerminalRuntimeViewState;
  unsubscribeTerminalEvents: (() => void) | null;
}
