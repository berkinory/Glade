import { createCuaDesktopAdmission } from "./cuaDesktopAdmission";
import { createCuaDriverGeneration } from "./cuaDriverGeneration";
import { createCuaHostDispatch } from "./cuaHostDispatch";
import { ControlledTarget } from "./cuaHostPolicy";
import { type CuaDriverHostOptions, type CuaHostRuntime } from "./cuaHostRuntimeTypes";
import { createCuaHostTransport } from "./cuaHostTransport";
import { createCuaInputInterruption } from "./cuaInputInterruption";
import { createCuaTargetObservation } from "./cuaTargetObservation";
import { createCuaTaskCursors } from "./cuaTaskCursors";
import { createCuaTaskExecution } from "./cuaTaskExecution";

export class CuaDriverHost {
  private readonly hostRuntime: CuaHostRuntime;
  readonly listen: CuaHostRuntime["listen"];
  readonly setCursorStyle: CuaHostRuntime["setCursorStyle"];
  readonly stop: CuaHostRuntime["stop"];
  readonly emergencyStopInput: CuaHostRuntime["emergencyStopInput"];
  readonly physicalInput: CuaHostRuntime["physicalInput"];
  readonly inputMonitorStateChanged: CuaHostRuntime["inputMonitorStateChanged"];
  readonly stopTaskByUser: CuaHostRuntime["stopTaskByUser"];
  readonly suspend: CuaHostRuntime["suspend"];
  readonly resume: CuaHostRuntime["resume"];
  readonly pauseDesktop: CuaHostRuntime["pauseDesktop"];
  readonly resumeDesktop: CuaHostRuntime["resumeDesktop"];
  readonly dispose: CuaHostRuntime["dispose"];

  constructor(options: CuaDriverHostOptions) {
    this.hostRuntime = createCuaHostRuntime(options);
    const runtime = this.hostRuntime;
    this.listen = runtime.listen;
    this.setCursorStyle = runtime.setCursorStyle;
    this.stop = runtime.stop;
    this.emergencyStopInput = runtime.emergencyStopInput;
    this.physicalInput = runtime.physicalInput;
    this.inputMonitorStateChanged = runtime.inputMonitorStateChanged;
    this.stopTaskByUser = runtime.stopTaskByUser;
    this.suspend = runtime.suspend;
    this.resume = runtime.resume;
    this.pauseDesktop = runtime.pauseDesktop;
    this.resumeDesktop = runtime.resumeDesktop;
    this.dispose = runtime.dispose;
  }

  get isInputMonitorRequested(): boolean {
    return this.hostRuntime.inputMonitorRequested;
  }
}

function createCuaHostRuntime(options: CuaDriverHostOptions): CuaHostRuntime {
  // Assemble callable operations before resources can invoke their callbacks.
  const hostRuntime = {} as { -readonly [Key in keyof CuaHostRuntime]: CuaHostRuntime[Key] };
  Object.assign(hostRuntime, createCuaHostTransport(hostRuntime));
  Object.assign(hostRuntime, createCuaHostDispatch(hostRuntime));
  Object.assign(hostRuntime, createCuaTaskExecution(hostRuntime));
  Object.assign(hostRuntime, createCuaTaskCursors(hostRuntime));
  Object.assign(hostRuntime, createCuaDriverGeneration(hostRuntime));
  Object.assign(hostRuntime, createCuaInputInterruption(hostRuntime));
  Object.assign(hostRuntime, createCuaTargetObservation(hostRuntime));
  Object.assign(hostRuntime, createCuaDesktopAdmission(hostRuntime));
  hostRuntime.generation = undefined;
  hostRuntime.starting = undefined;
  hostRuntime.retiring = Promise.resolve();
  hostRuntime.closed = false;
  hostRuntime.suspended = false;
  hostRuntime.inputMonitorArmed = false;
  hostRuntime.inputMonitorRequested = false;
  hostRuntime.nativeInputCleanupPending = undefined;
  hostRuntime.activeForegroundInput = false;
  hostRuntime.controlledTargets = new Map<string, ControlledTarget>();
  hostRuntime.takeoverTargets = new Map<string, ControlledTarget>();
  hostRuntime.browserTargets = new Map<string, ControlledTarget>();
  hostRuntime.activeInputTaskKey = undefined;
  hostRuntime.monitoredTasks = new Map<string, string>();
  hostRuntime.inputInterruptCooldownUntil = 0;
  hostRuntime.inFlightInputInterrupts = new Set<AbortController>();
  hostRuntime.activeTaskCalls = new Map<AbortController, string>();
  hostRuntime.browserRecoveryObservations = new Map<string, number>();
  hostRuntime.observedNativeRevision = undefined;
  hostRuntime.operations = Promise.resolve();
  hostRuntime.stopping = Promise.resolve();
  hostRuntime.epoch = 0;
  hostRuntime.inputMonitorEpochChanges = 0;
  hostRuntime.userStoppedTasks = new Set<string>();
  hostRuntime.options = options;

  return hostRuntime;
}
