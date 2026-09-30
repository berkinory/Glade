import {
  CUA_ACTION_TOOLS,
  CUA_BROWSER_MUTATION_TOOLS,
  CUA_BROWSER_TOOLS,
  CUA_READ_TOOLS,
  cuaComputerTaskKey,
  cuaRequest,
  type CuaComputerTask,
  type CuaReply,
} from "@glade/shared/computer/cuaDriverProtocol";
import {
  CUA_DEFAULT_OWN_PIDS,
  ESCAPE_INPUT_COOLDOWN_MS,
  Generation,
  log,
  safeNativeId,
} from "./cuaHostPolicy";
import { type CuaHostRuntime } from "./cuaHostRuntimeTypes";
import type { ComputerInputMonitorState, PhysicalComputerInput } from "./escapeKillSwitchMonitor";
import { linuxBrowserCallIsReadOnly } from "./linuxCuaAdmission";
import type { Socket } from "node:net";

export function createCuaInputInterruption(
  hostRuntime: Pick<
    CuaHostRuntime,
    | "inputMonitorRequested"
    | "inputMonitorArmed"
    | "options"
    | "controlledTargets"
    | "takeoverTargets"
    | "browserTargets"
    | "browserRecoveryObservations"
    | "monitoredTasks"
    | "epoch"
    | "cancelPermissionChecks"
    | "operations"
    | "stopping"
    | "generation"
    | "retire"
    | "starting"
    | "retiring"
    | "inFlightInputInterrupts"
    | "nativeInputCleanupPending"
    | "closed"
    | "suspended"
    | "inputInterruptCooldownUntil"
    | "activeForegroundInput"
    | "activeInputTaskKey"
    | "inputMonitorEpochChanges"
    | "rememberTask"
    | "userStoppedTasks"
    | "stopMatchingTasks"
    | "activeTaskCalls"
    | "endTask"
    | "inputMonitorUnavailableReply"
    | "admissionState"
    | "advanceDesktopEpoch"
    | "requireFreshObservation"
  >,
) {
  function beginInputTeardown() {
    hostRuntime.epoch += 1;
    // Reads admitted before teardown must fail the freshness check after it.
    hostRuntime.advanceDesktopEpoch();
    hostRuntime.cancelPermissionChecks();
    const admitted = hostRuntime.operations;
    const frameTapStopped = hostRuntime.options.frameTap?.stop();
    const shieldStopped = hostRuntime.options.shield?.stop();
    void frameTapStopped?.catch(() => undefined);
    void shieldStopped?.catch(() => undefined);
    return { admitted, frameTapStopped, shieldStopped };
  }

  async function activateInputMonitor(
    request: Record<string, unknown>,
    connection: Socket,
    task: CuaComputerTask | undefined,
    taskStopped: () => boolean | undefined,
  ): Promise<CuaReply | undefined> {
    const activeComputerWork =
      request.method === "call" &&
      typeof request.name === "string" &&
      request.name !== "check_permissions" &&
      (process.platform !== "linux" || task !== undefined) &&
      (CUA_ACTION_TOOLS.has(request.name) ||
        (CUA_BROWSER_MUTATION_TOOLS.has(request.name) &&
          (process.platform !== "linux" ||
            !linuxBrowserCallIsReadOnly(request.name, request.args))) ||
        (task !== undefined &&
          request.modelObservation === true &&
          (CUA_READ_TOOLS.has(request.name) || CUA_BROWSER_TOOLS.has(request.name))));
    if (!activeComputerWork) return;
    hostRuntime.inputMonitorRequested = true;
    const activationEpoch = hostRuntime.epoch;
    const activationMonitorEpochChanges = hostRuntime.inputMonitorEpochChanges;
    await hostRuntime.options.activateInputMonitor?.();
    if (
      activationEpoch !== hostRuntime.epoch ||
      connection.destroyed ||
      hostRuntime.closed ||
      hostRuntime.suspended ||
      taskStopped()
    ) {
      const monitor = hostRuntime.options.inputMonitorState?.();
      if (
        !connection.destroyed &&
        !hostRuntime.closed &&
        !hostRuntime.suspended &&
        monitor?.ready === false &&
        hostRuntime.epoch - activationEpoch ===
          hostRuntime.inputMonitorEpochChanges - activationMonitorEpochChanges
      )
        return hostRuntime.inputMonitorUnavailableReply(monitor);
      return {
        ok: false,
        error: "Cancelled before listener activation completed.",
        effect: "not-dispatched",
      };
    }
    if (hostRuntime.options.activateInputMonitor) hostRuntime.inputMonitorArmed = true;
    if (task) {
      hostRuntime.monitoredTasks.set(cuaComputerTaskKey(task), task.threadId);
      while (hostRuntime.monitoredTasks.size > 256)
        hostRuntime.monitoredTasks.delete(hostRuntime.monitoredTasks.keys().next().value!);
    }
  }

  function stop(): Promise<void> {
    hostRuntime.inputMonitorRequested = false;
    if (hostRuntime.inputMonitorArmed) {
      hostRuntime.inputMonitorArmed = false;
      hostRuntime.options.onInputMonitorArmedChange?.(false);
    }
    hostRuntime.controlledTargets.clear();
    hostRuntime.takeoverTargets.clear();
    hostRuntime.browserTargets.clear();
    hostRuntime.browserRecoveryObservations.clear();
    hostRuntime.monitoredTasks.clear();
    const { admitted, frameTapStopped, shieldStopped } = beginInputTeardown();
    const stopping = hostRuntime.stopping.then(async () => {
      if (hostRuntime.generation) await hostRuntime.retire(hostRuntime.generation);
      await hostRuntime.starting?.catch(() => undefined);
      if (hostRuntime.generation) await hostRuntime.retire(hostRuntime.generation);
      await admitted;
      await hostRuntime.retiring;
      await frameTapStopped;
      await shieldStopped;
    });
    // Same discipline as `retiring`: the caller sees the failure but the chain must not — one
    // admission-closed stop must not refuse every later stop() for the host's lifetime.
    hostRuntime.stopping = stopping.then(
      () => undefined,
      () => undefined,
    );
    return stopping;
  }

  function interruptInput(): Promise<void> {
    const { admitted, frameTapStopped, shieldStopped } = beginInputTeardown();
    for (const interrupt of hostRuntime.inFlightInputInterrupts) interrupt.abort();
    const interrupting = hostRuntime.stopping.then(async () => {
      await hostRuntime.starting?.catch(() => undefined);
      if (hostRuntime.generation) await interruptNativeInput(hostRuntime.generation);
      await admitted;
      await hostRuntime.retiring;
      await frameTapStopped;
      await shieldStopped;
    });
    // Same discipline as `retiring`/`stopping` everywhere else: the caller sees the failure but the
    // chain must not — one failed interrupt must not refuse every later one for the host's lifetime.
    hostRuntime.stopping = interrupting.then(
      () => undefined,
      () => undefined,
    );
    return interrupting;
  }

  async function interruptNativeInput(generation: Generation): Promise<void> {
    if (generation.retired || generation.didExit) return;

    if (hostRuntime.options.nativeRevision === null && !generation.browserInputControl) return;
    hostRuntime.nativeInputCleanupPending = generation;
    let confirmed = false;
    try {
      const reply = await cuaRequest<CuaReply>(
        generation.socket,
        { method: "interrupt_input", args: { expected_pid: generation.child.pid } },
        { timeoutMs: 5_000 },
      );
      const state = reply.result;
      confirmed =
        reply.ok === true &&
        state !== undefined &&
        state.pid === generation.child.pid &&
        state.input_interrupted === true &&
        state.input_admission_open === true &&
        state.cleanup_complete === true &&
        state.pending_input === 0 &&
        typeof state.input_epoch === "number" &&
        Number.isSafeInteger(state.input_epoch) &&
        state.input_epoch > generation.nativeInputEpoch;
      if (confirmed) generation.nativeInputEpoch = state!.input_epoch as number;
    } catch {
      confirmed = false;
    }
    if (generation.retired || generation.didExit) return;
    if (!confirmed) {
      // The native barrier stays closed. OS releases are only a fallback for unconfirmed cleanup, never
      // proof that the old input loop has stopped.
      if (!generation.browserInputInFlight)
        await hostRuntime.options.releaseHeldInput?.().catch((error: unknown) => {
          log(`interrupted held-input release failed: ${String(error)}`);
        });
      throw new Error(
        "Cua Driver has not confirmed input interruption and cleanup. Input remains paused; a later attempt will recheck the native drain.",
      );
    }
    generation.inputInFlight = false;
    generation.browserInputInFlight = false;
    generation.inputTask = undefined;
    if (hostRuntime.nativeInputCleanupPending === generation)
      hostRuntime.nativeInputCleanupPending = undefined;
  }

  function emergencyStopInput(): boolean {
    if (hostRuntime.closed) return false;
    if (hostRuntime.generation === undefined && hostRuntime.starting === undefined) return false;
    log("physical Escape: interrupting computer input");
    hostRuntime.requireFreshObservation();
    hostRuntime.inputInterruptCooldownUntil = Date.now() + ESCAPE_INPUT_COOLDOWN_MS;
    void interruptInput().catch((error: unknown) => {
      log(`emergency input interrupt failed: ${String(error)}`);
    });
    return true;
  }

  function physicalInput(event: PhysicalComputerInput): boolean {
    if (hostRuntime.closed || !hostRuntime.generation || hostRuntime.generation.retired)
      return false;
    if (
      !hostRuntime.activeForegroundInput &&
      !hostRuntime.admissionState().desktopObservationRequired &&
      hostRuntime.takeoverTargets.size === 0
    )
      return false;
    const affected = [...hostRuntime.controlledTargets].filter(
      ([key]) => hostRuntime.activeForegroundInput && key === hostRuntime.activeInputTaskKey,
    );
    const alreadyPaused =
      hostRuntime.admissionState().desktopObservationRequired ||
      hostRuntime.admissionState().browserObservationRequired ||
      hostRuntime.takeoverTargets.size > 0;
    if (!alreadyPaused) {
      log(
        JSON.stringify({
          event: "computer_physical_input",
          ts: new Date().toISOString(),
          pid: safeNativeId(event.pid),
          windowId: safeNativeId(event.windowId),
          targets: affected.map(([, target]) => ({
            thread: target.threadId,
            pid: target.pid,
            windowId: target.windowId,
          })),
          foreground: true,
        }),
      );
    }
    for (const [key, target] of affected) hostRuntime.takeoverTargets.set(key, { ...target });
    if (hostRuntime.activeForegroundInput && affected.length === 0) {
      hostRuntime.requireFreshObservation();
    }
    const affectedInputInFlight =
      hostRuntime.activeForegroundInput &&
      [...hostRuntime.inFlightInputInterrupts].some((input) => !input.signal.aborted);
    hostRuntime.inputInterruptCooldownUntil = Date.now() + ESCAPE_INPUT_COOLDOWN_MS;
    if (alreadyPaused && !affectedInputInFlight) {
      // Repeated typing keeps observations stale without sending one native cancellation RPC per key. No
      // new mutation can enter this paused gate.
      hostRuntime.epoch += 1;
      hostRuntime.advanceDesktopEpoch();
      return true;
    }
    void interruptInput().catch((error: unknown) =>
      log(`human takeover interrupt failed: ${String(error)}`),
    );
    return true;
  }

  function inputMonitorStateChanged(state: ComputerInputMonitorState): void {
    if (
      state.ready ||
      state.error === "input_monitor_idle" ||
      state.error === "input_monitor_starting" ||
      hostRuntime.closed ||
      !hostRuntime.generation ||
      hostRuntime.generation.retired
    )
      return;
    hostRuntime.requireFreshObservation();
    hostRuntime.inputMonitorEpochChanges += 1;
    void interruptInput().catch((error: unknown) =>
      log(`input listener interruption failed: ${String(error)}`),
    );
  }

  function updateInputMonitorArmed(): void {
    const armed =
      !hostRuntime.closed &&
      hostRuntime.generation !== undefined &&
      !hostRuntime.generation.retired &&
      (!hostRuntime.options.activateInputMonitor || hostRuntime.inputMonitorRequested);
    if (armed === hostRuntime.inputMonitorArmed) return;
    hostRuntime.inputMonitorArmed = armed;
    try {
      hostRuntime.options.onInputMonitorArmedChange?.(armed);
    } catch {
      // Monitor plumbing must never take input admission down with it.
    }
  }

  function ownPids(): ReadonlySet<number> {
    return hostRuntime.options.ownPids?.() ?? CUA_DEFAULT_OWN_PIDS;
  }

  async function stopTaskByUser(task: CuaComputerTask): Promise<void> {
    await stopTaskInput(task);
  }

  async function stopTaskInput(task: CuaComputerTask): Promise<"task" | "generation"> {
    const key = cuaComputerTaskKey(task);
    const matches = (candidate: CuaComputerTask) =>
      candidate.threadId === task.threadId &&
      (task.turnId === undefined || candidate.turnId === task.turnId);
    const stoppedKeys = new Set([key]);
    hostRuntime.rememberTask(hostRuntime.userStoppedTasks, task);
    for (const matched of hostRuntime.stopMatchingTasks(task)) {
      stoppedKeys.add(cuaComputerTaskKey(matched));
      hostRuntime.rememberTask(hostRuntime.userStoppedTasks, matched);
    }
    hostRuntime.cancelPermissionChecks(stoppedKeys);
    for (const [cancel, owner] of hostRuntime.activeTaskCalls) {
      if (stoppedKeys.has(owner)) cancel.abort();
    }
    // Idle/queued tasks and observations need only their own revocation; they must not interrupt
    // another task. A thread-wide Stop matches its admitted/known turns. It must not interrupt another
    // thread just because the caller omitted a turn id.
    const scope =
      hostRuntime.generation?.inputInFlight &&
      hostRuntime.generation.inputTask !== undefined &&
      matches(hostRuntime.generation.inputTask)
        ? "generation"
        : "task";
    const interrupted = scope === "generation" ? interruptInput() : Promise.resolve();
    await Promise.all([interrupted, hostRuntime.endTask(task, task.turnId === undefined, false)]);
    log(
      JSON.stringify({
        event: "computer_task_stop",
        thread: task.threadId,
        turn: task.turnId,
        scope,
      }),
    );
    return scope;
  }

  return {
    activateInputMonitor,
    stop,
    interruptInput,
    interruptNativeInput,
    emergencyStopInput,
    physicalInput,
    inputMonitorStateChanged,
    updateInputMonitorArmed,
    ownPids,
    stopTaskByUser,
    stopTaskInput,
  };
}
