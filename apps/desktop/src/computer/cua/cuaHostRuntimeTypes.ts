import {
  type CuaComputerTask,
  type CuaPreviewTarget,
  type CuaReply,
  type CuaToolResult,
} from "@glade/shared/computer/cuaDriverProtocol";
import { type Server, type Socket } from "node:net";
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

export interface CuaHostRuntime {
  readonly options: CuaDriverHostOptions;
  directory: string;
  server: Server | undefined;
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
  readonly repliedConnections: WeakSet<Socket>;
  activeInputTaskKey: string | undefined;
  readonly monitoredTasks: Map<string, string>;
  inputInterruptCooldownUntil: number;
  readonly inFlightInputInterrupts: Set<AbortController>;
  readonly activeTaskCalls: Map<AbortController, string>;
  readonly desktopPauses: Set<string>;
  desktopObservationRequired: boolean;
  browserObservationRequired: boolean;
  readonly browserRecoveryObservations: Map<string, number>;
  desktopEpoch: number;
  desktopInterruptionCount: number;
  observedNativeRevision: number | undefined;
  operations: Promise<void>;
  stopping: Promise<void>;
  cursorStyleUpdates: Promise<void>;
  epoch: number;
  inputMonitorEpochChanges: number;
  readonly connections: Set<Socket>;
  permissions: HostPermissions | undefined;
  readonly pendingPermissionChecks: Map<() => void, string | undefined>;
  readonly userStoppedTasks: Set<string>;
  readonly admittedTaskRequests: Set<TaskRequest>;
  readonly knownTasks: Map<string, CuaComputerTask>;
  readonly endedFrameTasks: Set<string>;
  frameTapTask: CuaComputerTask | undefined;
  warmAttempted: boolean;
  listen: () => Promise<string>;
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
  warm: () => void;
  ensureControlSession: (generation: Generation) => Promise<void>;
  ensureSpawned: () => Promise<Generation>;
  ensureStarted: () => Promise<Generation>;
  retire: (generation: Generation) => Promise<void>;
  setCursorStyle: (style: CuaCursorStyle | null | undefined) => Promise<void>;
  applyCursorStyleForSession: (generation: Generation, session: string) => Promise<void>;
  stop: () => Promise<void>;
  interruptInput: () => Promise<void>;
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
