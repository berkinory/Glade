import { type CuaComputerTask } from "@glade/shared/computer/cuaDriverProtocol";
import { createCuaHostRuntime } from "./createCuaHostRuntime";
import { CuaCursorStyle } from "./cuaHostPolicy";
import { type CuaDriverHostOptions, type CuaHostRuntime } from "./cuaHostRuntimeTypes";
import type { ComputerInputMonitorState } from "./escapeKillSwitchMonitor";
export class CuaDriverHost {
  private readonly hostRuntime: CuaHostRuntime;
  constructor(options: CuaDriverHostOptions) {
    this.hostRuntime = createCuaHostRuntime(options);
  }
  get isInputMonitorRequested(): boolean {
    return this.hostRuntime.inputMonitorRequested;
  }
  listen(): Promise<string> {
    return this.hostRuntime.listen();
  }
  setCursorStyle(style: CuaCursorStyle | null | undefined): Promise<void> {
    return this.hostRuntime.setCursorStyle(style);
  }
  stop(): Promise<void> {
    return this.hostRuntime.stop();
  }
  emergencyStopInput(): boolean {
    return this.hostRuntime.emergencyStopInput();
  }
  physicalInput(event: {
    type: "physical-input";
    kind: "keyboard" | "pointer";
    pid?: number;
    windowId?: number;
    capturedAt?: string;
  }): boolean {
    return this.hostRuntime.physicalInput(event);
  }
  inputMonitorStateChanged(state: ComputerInputMonitorState): void {
    return this.hostRuntime.inputMonitorStateChanged(state);
  }
  stopTaskByUser(task: CuaComputerTask): Promise<void> {
    return this.hostRuntime.stopTaskByUser(task);
  }
  suspend(): Promise<void> {
    return this.hostRuntime.suspend();
  }
  resume(): void {
    return this.hostRuntime.resume();
  }
  pauseDesktop(reason: string): Promise<void> {
    return this.hostRuntime.pauseDesktop(reason);
  }
  resumeDesktop(reason: string): void {
    return this.hostRuntime.resumeDesktop(reason);
  }
  dispose(): Promise<void> {
    return this.hostRuntime.dispose();
  }
}
