import {
  TerminalAckOutputInput,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalSessionStatus,
  TerminalWriteInput,
} from "@glade/contracts/terminal/terminal";
import type { TerminalActivityState, TerminalCliKind } from "@glade/shared/terminalThreads";
import { PtyProcess } from "./PTY";
import { Effect, Schema, ServiceMap } from "effect";
import type { TerminalModeReplayTracker } from "../terminalModeReplay";
import type { TerminalHistoryBuffer } from "../terminalHistory";

export class TerminalError extends Schema.TaggedErrorClass<TerminalError>()("TerminalError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface TerminalSessionState {
  threadId: string;
  terminalId: string;
  cwd: string;
  status: TerminalSessionStatus;
  pid: number | null;

  history: TerminalHistoryBuffer;
  pendingHistoryControlSequence: string;
  exitCode: number | null;
  exitSignal: number | null;
  updatedAt: string;

  lastOpenedAt: string;
  cols: number;
  rows: number;
  process: PtyProcess | null;
  unsubscribeData: (() => void) | null;
  unsubscribeExit: (() => void) | null;
  hasRunningSubprocess: boolean;
  detectedCliKind: TerminalCliKind | null;

  providerDescendantObserved: boolean;
  managedAgentRunning: boolean;
  managedAgentState: TerminalActivityState | null;

  managedAgentObserved: boolean;
  runtimeEnv: Record<string, string> | null;

  pendingInputBuffer: string;

  modeReplayTracker: TerminalModeReplayTracker | null;

  pendingOutputChunks: string[];

  pendingOutputLength: number;

  outputFlushTimer: ReturnType<typeof setTimeout> | null;

  streamOutput: boolean;

  outputPaused: boolean;

  outputBufferPauseRequested: boolean;

  outputAckPauseRequested: boolean;

  outputAckObserved: boolean;

  outputUnackedBytes: number;

  outputAckResumeTimer: ReturnType<typeof setTimeout> | null;

  lastInputAt: number | null;

  lastOutputAt: number | null;

  lastOutputSignature: string | null;
}

export interface ShellCandidate {
  shell: string;
  args?: string[];
}

export interface TerminalStartInput extends TerminalOpenInput {
  cols: number;
  rows: number;
}

export interface TerminalCloseOpenedAtOrBeforeInput {
  readonly threadId: string;
  readonly openedAtOrBefore: string;
}

export interface TerminalManagerShape {
  readonly open: (
    input: TerminalOpenInput,
  ) => Effect.Effect<TerminalSessionSnapshot, TerminalError>;

  readonly write: (input: TerminalWriteInput) => Effect.Effect<void, TerminalError>;

  readonly ackOutput: (input: TerminalAckOutputInput) => Effect.Effect<void, TerminalError>;

  readonly resize: (input: TerminalResizeInput) => Effect.Effect<void, TerminalError>;

  readonly clear: (input: TerminalClearInput) => Effect.Effect<void, TerminalError>;

  readonly restart: (
    input: TerminalRestartInput,
  ) => Effect.Effect<TerminalSessionSnapshot, TerminalError>;

  readonly close: (input: TerminalCloseInput) => Effect.Effect<void, TerminalError>;

  readonly closeSessionsOpenedAtOrBefore: (
    input: TerminalCloseOpenedAtOrBeforeInput,
  ) => Effect.Effect<void, TerminalError>;

  readonly subscribe: (listener: (event: TerminalEvent) => void) => Effect.Effect<() => void>;

  readonly dispose: Effect.Effect<void>;
}

export class TerminalManager extends ServiceMap.Service<TerminalManager, TerminalManagerShape>()(
  "glade/terminal/Services/Manager/TerminalManager",
) {}
