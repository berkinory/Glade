import { type CuaReply } from "@glade/shared/computer/cuaDriverProtocol";
import { log } from "./cuaHostPolicy";
import { type CuaHostRuntime } from "./cuaHostRuntimeTypes";

export function createCuaDesktopAdmission(
  hostRuntime: Pick<
    CuaHostRuntime,
    | "suspended"
    | "stop"
    | "closed"
    | "observedNativeRevision"
    | "generation"
    | "options"
    | "inputInterruptCooldownUntil"
    | "updateInputMonitorArmed"
    | "closeTransport"
  >,
) {
  const desktopPauses = new Set<string>();
  let desktopEpoch = 0;
  let desktopInterruptionCount = 0;
  let desktopObservationRequired = false;
  let browserObservationRequired = false;

  function admissionState() {
    return {
      epoch: desktopEpoch,
      paused: desktopPauses.size > 0,
      desktopObservationRequired,
      browserObservationRequired,
    };
  }

  function advanceDesktopEpoch(): void {
    desktopEpoch += 1;
  }

  function requireFreshObservation(): void {
    desktopObservationRequired = true;
    browserObservationRequired = true;
  }

  function requireDesktopObservation(): void {
    desktopObservationRequired = true;
  }

  function clearDesktopObservation(): void {
    desktopObservationRequired = false;
  }

  function suspend(): Promise<void> {
    hostRuntime.suspended = true;
    return hostRuntime.stop();
  }

  function resume(): void {
    if (!hostRuntime.closed) hostRuntime.suspended = false;
  }

  function desktopState(): Pick<
    CuaReply,
    | "desktopEpoch"
    | "desktopPauses"
    | "desktopInterruptions"
    | "driverNativeRevision"
    | "driverBrowserInputControl"
    | "hostPlatform"
  > {
    return {
      desktopEpoch,
      desktopPauses: [...desktopPauses].toSorted(),
      desktopInterruptions: desktopInterruptionCount,
      hostPlatform: process.platform,
      ...(hostRuntime.observedNativeRevision !== undefined
        ? { driverNativeRevision: hostRuntime.observedNativeRevision }
        : {}),
      ...(process.platform === "linux"
        ? {
            driverBrowserInputControl:
              hostRuntime.generation?.browserInputControl === true &&
              !hostRuntime.generation.retired &&
              !hostRuntime.generation.didExit,
          }
        : {}),
    };
  }

  function pauseDesktop(reason: string): Promise<void> {
    desktopPauses.add(reason);
    desktopInterruptionCount += 1;
    requireFreshObservation();
    log(`desktop input paused (${reason}); requiring fresh desktop observation`);
    return hostRuntime.stop();
  }

  function resumeDesktop(reason: string): void {
    if (desktopPauses.delete(reason))
      log(`desktop pause "${reason}" lifted; ${desktopPauses.size} pause(s) remain`);
  }

  function desktopPauseReply(): CuaReply {
    const message =
      desktopPauses.size > 0
        ? "Computer input is paused because the desktop is locked, asleep or inactive. Return to the desktop, then read fresh state before continuing."
        : "Computer input was interrupted or the user changed the controlled window. Read fresh computer state and inspect it before continuing; do not replay an uncertain action.";
    return {
      ok: true,
      result: {
        isError: true,
        content: [{ type: "text", text: message }],
        structuredContent: {
          effect: "refused",
          code: "computer_input_paused",
          layer: "driver-host",
          message,
          requery_hint:
            "After physical input stops, observe a usable window of the affected app with computer_get_state and its exact window_id. Do not replay an uncertain action.",
        },
      },
    };
  }

  function inputMonitorUnavailableReply(
    monitor = hostRuntime.options.inputMonitorState?.(),
  ): CuaReply {
    const message =
      process.platform === "linux"
        ? "A working global Escape stop is unavailable in this Linux desktop session. Computer browser actions remain paused; browser observation is still available."
        : monitor?.error === "input-monitoring-required"
          ? "Allow Input Monitoring in System Settings, then wait for the computer input listener to reconnect before continuing."
          : "The computer input listener is unavailable. Input remains paused until the listener reconnects.";
    return {
      ok: true,
      result: {
        isError: true,
        content: [{ type: "text", text: message }],
        structuredContent: {
          effect: "refused",
          code: "input_monitor_unavailable",
          message,
          ...(monitor?.error ? { input_monitor_error: monitor.error } : {}),
        },
      },
    };
  }

  function inputInterruptedReply(): CuaReply {
    const message =
      "Computer input was interrupted by physical input. Wait for the user to finish, then read fresh computer state before continuing. Do not replay an uncertain action.";
    return {
      ok: true,
      result: {
        isError: true,
        content: [{ type: "text", text: message }],
        structuredContent: {
          effect: "refused",
          code: "computer_input_paused",
          layer: "driver-host",
          message,
          wait_seconds: Math.max(0, (hostRuntime.inputInterruptCooldownUntil - Date.now()) / 1000),
          requery_hint:
            "Wait, then observe the affected target before deciding the next action. Waiting alone does not resume input.",
        },
      },
    };
  }

  async function dispose(): Promise<void> {
    hostRuntime.closed = true;
    hostRuntime.updateInputMonitorArmed();
    try {
      await hostRuntime.stop();
    } finally {
      await hostRuntime.options.frameTap?.dispose().catch(() => undefined);
      await hostRuntime.options.shield?.dispose().catch(() => undefined);
      await hostRuntime.closeTransport(hostRuntime.generation !== undefined);
    }
  }

  return {
    admissionState,
    advanceDesktopEpoch,
    requireFreshObservation,
    requireDesktopObservation,
    clearDesktopObservation,
    suspend,
    resume,
    desktopState,
    pauseDesktop,
    resumeDesktop,
    desktopPauseReply,
    inputMonitorUnavailableReply,
    inputInterruptedReply,
    dispose,
  };
}
