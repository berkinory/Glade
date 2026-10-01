import {
  type CuaComputerTask,
  type CuaPreviewTarget,
  type CuaReply,
  type CuaToolResult,
} from "@glade/shared/computer/cuaDriverProtocol";
import { type Socket } from "node:net";
import type { ComputerFrameTapHost } from "../computerFrameTap";
import type { ComputerShieldHost } from "../computerShield";
import {
  ControlledTarget,
  CuaCursorStyle,
  Generation,
  HostPermissions,
  TaskRequest,
} from "./cuaHostPolicy";
import type { ComputerInputMonitorState, PhysicalComputerInput } from "./escapeKillSwitchMonitor";

export type CuaDriverHostOptions = {
  binaryPath: string;
  bundleId: string;
  capability: string;
  setup: () => Promise<void>;
  checkPermissions?: (options?: { readonly force: boolean }) => Promise<HostPermissions>;
  releaseHeldInput?: () => Promise<void>;

  startupTimeoutMs?: number;
  normalizeOverview?: (result: CuaToolResult) => CuaToolResult;
  frameTap?: ComputerFrameTapHost;

  onInputMonitorArmedChange?: (armed: boolean) => void;
  // macOS listener health; omitted on hosts without this listener.
  inputMonitorState?: () => ComputerInputMonitorState;
  activateInputMonitor?: () => Promise<void>;
  // Absent means `engage` requests are refused as unavailable — the caller must never fall back to an
  // unmasked excursion under an armed flag.
  shield?: ComputerShieldHost;

  nativeRevision?: number | null;

  hostEndpoint?: string;
  // Browser calls carrying one as `args.pid` are refused: the integrated browser is a separate
  // surface and computer use must never bind the app that hosts it.
  ownPids?: () => ReadonlySet<number>;

  cursorStyle?: () => CuaCursorStyle | null | undefined;
};

export interface CuaPermissionCheckInput {
  connection: Socket;
  task: CuaComputerTask | undefined;
  cancelled: () => boolean | undefined;
  onChange: (previous: HostPermissions, next: HostPermissions) => Promise<void>;
  warm: () => void;
  monitorState: () => ComputerInputMonitorState | undefined;
  bundleId: string;
}

export interface CuaHostRuntime {
  readonly options: CuaDriverHostOptions;
  generation: Generation | undefined;
  starting: Promise<Generation> | undefined;
  retiring: Promise<void>;
  closed: boolean;
  suspended: boolean;
  inputMonitorArmed: boolean;
  inputMonitorRequested: boolean;
  nativeInputCleanupPending: Generation | undefined;
  activeForegroundInput: boolean;
  readonly controlledTargets: Map<string, ControlledTarget>;
  readonly takeoverTargets: Map<string, ControlledTarget>;
  readonly browserTargets: Map<string, ControlledTarget>;
  activeInputTaskKey: string | undefined;
  readonly monitoredTasks: Map<string, string>;
  inputInterruptCooldownUntil: number;
  readonly inFlightInputInterrupts: Set<AbortController>;
  readonly activeTaskCalls: Map<AbortController, string>;
  readonly browserRecoveryObservations: Map<string, number>;
  observedNativeRevision: number | undefined;
  operations: Promise<void>;
  stopping: Promise<void>;
  epoch: number;
  inputMonitorEpochChanges: number;
  readonly userStoppedTasks: Set<string>;
  listen: () => Promise<string>;
  admissionState: () => {
    epoch: number;
    paused: boolean;
    desktopObservationRequired: boolean;
    browserObservationRequired: boolean;
  };
  advanceDesktopEpoch: () => void;
  requireFreshObservation: () => void;
  requireDesktopObservation: () => void;
  clearDesktopObservation: () => void;
  runtimeDirectory: () => string;
  hasReplied: (socket: Socket) => boolean;
  stopMatchingTasks: (task: CuaComputerTask) => CuaComputerTask[];
  closeTransport: (hasGeneration: boolean) => Promise<void>;
  handleAuthenticatedRequest: (
    request: Record<string, unknown>,
    connection: Socket,
    task: CuaComputerTask | undefined,
    admitted: TaskRequest | undefined,
  ) => Promise<CuaReply>;
  checkPermissions: (
    connection: Socket,
    check: (options?: { readonly force: boolean }) => Promise<HostPermissions>,
    force?: boolean,
    task?: CuaComputerTask,
  ) => Promise<HostPermissions | undefined>;
  checkCurrentPermissions: (input: CuaPermissionCheckInput) => Promise<CuaReply>;
  cancelPermissionChecks: (stoppedKeys?: ReadonlySet<string>) => void;
  call: (
    name: string,
    input: unknown,
    connection: Socket,
    modelObservation: boolean,
    task?: CuaComputerTask,
    foregroundDelivery?: boolean,
  ) => Promise<CuaReply>;
  logCursorState: (
    generation: Generation,
    label: string,
    task: CuaComputerTask,
    stage: "session-created" | "first-action",
  ) => Promise<void>;
  endCursorSession: (generation: Generation, label: string) => Promise<boolean>;
  setTaskCursorEnabled: (
    generation: Generation,
    label: string,
    enabled: boolean,
  ) => Promise<boolean>;
  endTask: (task: CuaComputerTask, allTurns: boolean, waitForCursor?: boolean) => Promise<void>;
  setFrameTapTask: (task: CuaComputerTask) => void;
  isFrameTaskEnded: (task: CuaComputerTask) => boolean;
  endBrowserThread: (task: CuaComputerTask) => Promise<void>;
  warm: () => void;
  ensureControlSession: (generation: Generation) => Promise<void>;
  ensureSpawned: () => Promise<Generation>;
  ensureStarted: () => Promise<Generation>;
  retire: (generation: Generation) => Promise<void>;
  setCursorStyle: (style: CuaCursorStyle | null | undefined) => Promise<void>;
  applyCursorStyleForSession: (generation: Generation, session: string) => Promise<void>;
  stop: () => Promise<void>;
  interruptInput: () => Promise<void>;
  activateInputMonitor: (
    request: Record<string, unknown>,
    connection: Socket,
    task: CuaComputerTask | undefined,
    taskStopped: () => boolean | undefined,
  ) => Promise<CuaReply | undefined>;
  interruptNativeInput: (generation: Generation) => Promise<void>;
  emergencyStopInput: () => boolean;
  physicalInput: (event: PhysicalComputerInput) => boolean;
  inputMonitorStateChanged: (state: ComputerInputMonitorState) => void;
  updateInputMonitorArmed: () => void;
  ownPids: () => ReadonlySet<number>;
  stopTaskByUser: (task: CuaComputerTask) => Promise<void>;
  stopTaskInput: (task: CuaComputerTask) => Promise<"task" | "generation">;
  taskStoppedReply: () => CuaReply;
  rememberTask: (set: Set<string>, task: CuaComputerTask) => void;
  inputMonitorAvailable: (name: string, input: unknown) => boolean;
  isIsolatedBrowserSetup: (name: string, input: unknown) => boolean;
  browserRecoveryKey: (input: unknown, task: CuaComputerTask | undefined) => string | undefined;
  hasBrowserRecoveryObservation: (input: unknown, task: CuaComputerTask | undefined) => boolean;
  controlledTarget: (
    input: unknown,
    task: CuaComputerTask | undefined,
    browser: boolean,
  ) => ControlledTarget | undefined;
  rememberBrowserTarget: (
    input: unknown,
    result: CuaToolResult | undefined,
    task: CuaComputerTask,
  ) => void;
  isBrowserSnapshot: (input: unknown, result: CuaToolResult) => boolean;
  observationMatchesTarget: (
    name: string,
    input: unknown,
    target: ControlledTarget,
    result: CuaToolResult,
  ) => boolean;
  frameTapTarget: (task: CuaComputerTask, input: unknown) => CuaPreviewTarget | undefined;
  primeTapAfterLaunch: (
    task: CuaComputerTask,
    input: unknown,
    connection: Socket,
    epoch: number,
  ) => Promise<void>;
  suspend: () => Promise<void>;
  resume: () => void;
  desktopState: () => Pick<
    CuaReply,
    | "desktopEpoch"
    | "desktopPauses"
    | "desktopInterruptions"
    | "driverNativeRevision"
    | "driverBrowserInputControl"
    | "hostPlatform"
  >;
  pauseDesktop: (reason: string) => Promise<void>;
  resumeDesktop: (reason: string) => void;
  desktopPauseReply: () => CuaReply;
  inputMonitorUnavailableReply: (monitor?: ComputerInputMonitorState | undefined) => CuaReply;
  inputInterruptedReply: () => CuaReply;
  dispose: () => Promise<void>;
}
