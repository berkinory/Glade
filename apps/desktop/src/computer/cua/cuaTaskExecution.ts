import { parseCuaActionDiagnostics } from "@glade/shared/computer/cuaActionDiagnostics";
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
import { type Socket } from "node:net";
import {
  Generation,
  HostPermissions,
  agentSessionLabel,
  browserSessionLabel,
  isDriverSessionDeath,
  log,
} from "./cuaHostPolicy";
import { type CuaHostRuntime } from "./cuaHostRuntimeTypes";
import { linuxCuaAdmissionRefusal } from "./linuxCuaAdmission";

export function createCuaTaskExecution(
  hostRuntime: Pick<
    CuaHostRuntime,
    | "pendingPermissionChecks"
    | "epoch"
    | "desktopEpoch"
    | "inFlightInputInterrupts"
    | "activeTaskCalls"
    | "repliedConnections"
    | "interruptInput"
    | "ensureStarted"
    | "desktopPauses"
    | "ensureControlSession"
    | "applyCursorStyleForSession"
    | "setTaskCursorEnabled"
    | "inputMonitorAvailable"
    | "inputMonitorUnavailableReply"
    | "controlledTarget"
    | "controlledTargets"
    | "activeInputTaskKey"
    | "activeForegroundInput"
    | "options"
    | "nativeInputCleanupPending"
    | "retire"
    | "desktopObservationRequired"
    | "takeoverTargets"
    | "desktopPauseReply"
    | "rememberBrowserTarget"
    | "inputInterruptCooldownUntil"
    | "isBrowserSnapshot"
    | "browserRecoveryKey"
    | "browserRecoveryObservations"
    | "observationMatchesTarget"
    | "logCursorState"
    | "endCursorSession"
  >,
) {
  function checkPermissions(
    connection: Socket,
    check: (options?: { readonly force: boolean }) => Promise<HostPermissions>,
    force = false,
    task?: CuaComputerTask,
  ): Promise<HostPermissions | undefined> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        hostRuntime.pendingPermissionChecks.delete(cancel);
        connection.removeListener("close", cancel);
      };
      const cancel = () => {
        cleanup();
        resolve(undefined);
      };
      hostRuntime.pendingPermissionChecks.set(cancel, task ? cuaComputerTaskKey(task) : undefined);
      connection.once("close", cancel);
      void Promise.resolve()
        .then(() => check({ force }))
        .then(
          (permissions) => {
            cleanup();
            resolve(permissions);
          },
          (error) => {
            cleanup();
            reject(error);
          },
        );
    });
  }

  async function call(
    name: string,
    input: unknown,
    connection: Socket,
    modelObservation: boolean,
    task?: CuaComputerTask,
    foregroundDelivery = false,
  ): Promise<CuaReply> {
    let generation: Generation | undefined;
    let dispatched = false;
    let cursorEnabled: boolean | undefined;
    const admittedEpoch = hostRuntime.epoch;
    const admittedDesktopEpoch = hostRuntime.desktopEpoch;
    const isBrowser = CUA_BROWSER_TOOLS.has(name);
    const mutation = isBrowser ? CUA_BROWSER_MUTATION_TOOLS.has(name) : CUA_ACTION_TOOLS.has(name);

    const label = isBrowser && task ? browserSessionLabel(task.threadId) : undefined;

    const agentLabel = !isBrowser && task ? agentSessionLabel(task) : undefined;

    const callCancel = new AbortController();
    if (mutation) hostRuntime.inFlightInputInterrupts.add(callCancel);
    if (task) hostRuntime.activeTaskCalls.set(callCancel, cuaComputerTaskKey(task));
    const abort = () => {
      if (hostRuntime.repliedConnections.has(connection)) return;
      const alreadyInterrupted = callCancel.signal.aborted;
      callCancel.abort();
      if (mutation && dispatched && !alreadyInterrupted) {
        void hostRuntime
          .interruptInput()
          .catch((error: unknown) => log(`disconnected input cleanup failed: ${String(error)}`));
      }
    };
    connection.once("close", abort);

    let cancelledBeforeDispatch = false;
    try {
      let reply: CuaReply | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        generation = await hostRuntime.ensureStarted();
        if (
          connection.destroyed ||
          generation.retired ||
          admittedEpoch !== hostRuntime.epoch ||
          hostRuntime.desktopPauses.size > 0 ||
          callCancel.signal.aborted
        ) {
          cancelledBeforeDispatch = !dispatched;
          throw new Error("Cancelled before dispatch.");
        }
        const args = input && typeof input === "object" && !Array.isArray(input) ? input : {};
        let browserSessionId: string | undefined;
        if (isBrowser && label) {
          await hostRuntime.ensureControlSession(generation);
          if (generation.endedBrowserSessions.has(label)) {
            const revived = await cuaRequest<CuaReply>(
              generation.socket,
              {
                method: "call",
                name: "start_session",
                args: { session: label },
                session_id: generation.controlSession,
              },
              { timeoutMs: 10_000 },
            );
            if (revived.ok && !revived.result?.isError)
              generation.endedBrowserSessions.delete(label);
          }
          browserSessionId = generation.controlSession;
        } else if (agentLabel && generation.endedTaskSessions.has(agentLabel)) {
          const revived = await cuaRequest<CuaReply>(
            generation.socket,
            {
              method: "call",
              name: "start_session",
              args: { session: agentLabel },
            },
            { timeoutMs: 10_000 },
          );
          if (revived.ok && !revived.result?.isError) {
            generation.endedTaskSessions.delete(agentLabel);

            generation.appliedSessionCursorStyles.delete(agentLabel);
          }
        }

        if (agentLabel) await hostRuntime.applyCursorStyleForSession(generation, agentLabel);
        if (agentLabel && !generation.taskCursors.get(agentLabel)?.enabled) {
          // Showing/hiding a cursor must not end its driver session: that session can still own retained
          // accessibility refs across turns.
          cursorEnabled = await hostRuntime.setTaskCursorEnabled(generation, agentLabel, true);
        }

        if (
          admittedEpoch !== hostRuntime.epoch ||
          connection.destroyed ||
          callCancel.signal.aborted
        ) {
          cancelledBeforeDispatch = !dispatched;
          throw new Error("Cancelled before dispatch.");
        }
        if (process.platform === "linux" && isBrowser) {
          const refusal = linuxCuaAdmissionRefusal(
            name,
            input,
            foregroundDelivery ? "foreground" : undefined,
            generation.browserInputControl,
          );
          if (refusal) return refusal;
        }
        if (!hostRuntime.inputMonitorAvailable(name, input))
          return hostRuntime.inputMonitorUnavailableReply();
        if (mutation || modelObservation) {
          const target = hostRuntime.controlledTarget(input, task, isBrowser);
          if (target) {
            hostRuntime.controlledTargets.set(
              task ? cuaComputerTaskKey(task) : "anonymous",
              target,
            );
            while (hostRuntime.controlledTargets.size > 256)
              hostRuntime.controlledTargets.delete(
                hostRuntime.controlledTargets.keys().next().value!,
              );
          }
        }
        if (mutation) {
          hostRuntime.activeInputTaskKey = task ? cuaComputerTaskKey(task) : "anonymous";
          hostRuntime.activeForegroundInput =
            foregroundDelivery ||
            (args as Record<string, unknown>).delivery_mode === "foreground" ||
            name === "bring_to_front";
        }
        dispatched = true;
        if (label) generation.liveBrowserSessions.add(label);
        if (mutation) {
          generation.inputInFlight = true;
          generation.browserInputInFlight = isBrowser;
          generation.inputTask = task;
        }
        generation.inputEverDispatched ||= generation.inputInFlight;
        const attemptReply = await cuaRequest<CuaReply>(
          generation.socket,
          {
            method: "call",
            name,
            ...(mutation &&
            (hostRuntime.options.nativeRevision !== null || generation.browserInputControl)
              ? { expected_input_epoch: generation.nativeInputEpoch }
              : {}),

            args: {
              ...args,
              session: label ?? agentLabel ?? generation.session,
            },
            ...(browserSessionId ? { session_id: browserSessionId } : {}),
          },
          { timeoutMs: 30_000, mutation, signal: callCancel.signal },
        );
        if (attemptReply.result?.structuredContent?.input_cleanup_unconfirmed === true) {
          // A tool reply is not a release acknowledgement. Keep CDP input uncertainty across later reads and
          // process exits; OS key-ups cannot prove that the browser received its matching release.
          generation.inputInFlight = true;
          generation.browserInputInFlight ||= isBrowser;
          hostRuntime.nativeInputCleanupPending = generation;
        } else if (mutation && hostRuntime.nativeInputCleanupPending !== generation) {
          generation.inputInFlight = false;
          generation.browserInputInFlight = false;
          generation.inputTask = undefined;
        }
        if (isDriverSessionDeath(attemptReply)) {
          if (isBrowser && label) {
            generation.liveBrowserSessions.delete(label);
            generation.endedBrowserSessions.add(label);
            if (attempt === 0) continue;
          } else if (agentLabel) {
            // A task cursor session expires independently of the shared generation session the same way browser
            // labels do: reviving the label in place keeps every other thread's cursor — and the driver itself
            // — alive, where the shared-session path correctly retires the generation it can no longer trust.
            generation.endedTaskSessions.add(agentLabel);
            while (generation.endedTaskSessions.size > 256)
              generation.endedTaskSessions.delete(
                generation.endedTaskSessions.values().next().value!,
              );
            if (attempt === 0) continue;
          } else if (attempt === 0) {
            await hostRuntime.retire(generation).catch(() => undefined);
            continue;
          }
        }
        reply = attemptReply;
        break;
      }
      if (!reply || !generation) throw new Error("Cancelled before dispatch.");
      if (
        mutation &&
        (reply.result?.structuredContent?.code === "focus_restore_failed" ||
          parseCuaActionDiagnostics(reply.result?.structuredContent)?.error_code ===
            "focus_restore_failed")
      ) {
        hostRuntime.desktopObservationRequired = true;
        hostRuntime.epoch += 1;
        hostRuntime.desktopEpoch += 1;
        const key = task ? cuaComputerTaskKey(task) : "anonymous";
        const target = hostRuntime.controlledTargets.get(key);
        if (target) hostRuntime.takeoverTargets.set(key, { ...target });
      }
      if (
        admittedDesktopEpoch !== hostRuntime.desktopEpoch &&
        (CUA_READ_TOOLS.has(name) || name === "get_browser_state")
      ) {
        log(
          `refused stale ${name} read (desktop epoch ${admittedDesktopEpoch} -> ${hostRuntime.desktopEpoch})`,
        );
        return hostRuntime.desktopPauseReply();
      }
      if (isBrowser && task && reply.ok && !reply.result?.isError)
        hostRuntime.rememberBrowserTarget(input, reply.result, task);
      // Reads may finish during the cooldown, but must not release recovery tracking while continued
      // physical input can still make them stale.
      if (
        modelObservation &&
        hostRuntime.inputInterruptCooldownUntil <= Date.now() &&
        !connection.destroyed &&
        !generation.retired &&
        !generation.didExit &&
        admittedEpoch === hostRuntime.epoch &&
        hostRuntime.desktopPauses.size === 0 &&
        reply.ok &&
        !reply.result?.isError &&
        reply.result !== undefined
      ) {
        const nativeObservation =
          (name === "get_window_state" || name === "get_desktop_state") &&
          reply.result.structuredContent?.screenshot_frame_valid !== false &&
          (reply.result.content?.some((part) => part.type === "image" && !!part.data) ||
            Array.isArray(reply.result.structuredContent?.elements));
        const browserObservation =
          name === "get_browser_state" && hostRuntime.isBrowserSnapshot(input, reply.result);
        if (nativeObservation || browserObservation) {
          if (nativeObservation) hostRuntime.desktopObservationRequired = false;
          if (browserObservation) {
            const key = hostRuntime.browserRecoveryKey(input, task);
            if (key) hostRuntime.browserRecoveryObservations.set(key, hostRuntime.desktopEpoch);
            while (hostRuntime.browserRecoveryObservations.size > 256)
              hostRuntime.browserRecoveryObservations.delete(
                hostRuntime.browserRecoveryObservations.keys().next().value!,
              );
          }
          const key = task ? cuaComputerTaskKey(task) : "anonymous";
          const interrupted = hostRuntime.takeoverTargets.get(key);
          if (
            interrupted &&
            hostRuntime.observationMatchesTarget(name, input, interrupted, reply.result)
          )
            hostRuntime.takeoverTargets.delete(key);
          log(`fresh model observation via ${name}; matching input gate cleared`);
        }
      }
      if (name === "get_desktop_state" && reply.result && hostRuntime.options.normalizeOverview)
        hostRuntime.options.normalizeOverview(reply.result);
      if (agentLabel && task && !isDriverSessionDeath(reply)) {
        const cursor = generation.taskCursors.get(agentLabel);
        const sameTurn = cursor && cuaComputerTaskKey(cursor.task) === cuaComputerTaskKey(task);
        const firstAction = mutation && (!sameTurn || !cursor.firstActionObserved);
        generation.taskCursors.delete(agentLabel);
        generation.taskCursors.set(agentLabel, {
          task,
          firstActionObserved: mutation || (sameTurn && cursor.firstActionObserved) || false,
          enabled: cursorEnabled ?? cursor?.enabled ?? false,
        });
        if (!cursor || firstAction)
          await hostRuntime.logCursorState(
            generation,
            agentLabel,
            task,
            firstAction ? "first-action" : "session-created",
          );
        while (generation.taskCursors.size > 256) {
          const oldest = generation.taskCursors.keys().next().value!;
          if (!(await hostRuntime.endCursorSession(generation, oldest))) {
            // Native idle expiry bounds a failed cosmetic cleanup. Preserve retries under normal load without
            // unbounded per-label metadata.
            generation.taskCursors.delete(oldest);
          }
        }
      }
      return reply;
    } catch (error) {
      let detail = String(error);

      if (generation && !cancelledBeforeDispatch && !callCancel.signal.aborted) {
        try {
          await hostRuntime.retire(generation);
        } catch (cleanupError) {
          detail += `; ${String(cleanupError)}`;
        }
      }
      return {
        ok: false,
        error: detail,
        effect: dispatched && mutation ? "dispatched-unknown" : "not-dispatched",
      };
    } finally {
      if (mutation) {
        hostRuntime.activeForegroundInput = false;
        hostRuntime.activeInputTaskKey = undefined;
      }
      connection.removeListener("close", abort);
      hostRuntime.inFlightInputInterrupts.delete(callCancel);
      hostRuntime.activeTaskCalls.delete(callCancel);
    }
  }

  return { checkPermissions, call };
}
