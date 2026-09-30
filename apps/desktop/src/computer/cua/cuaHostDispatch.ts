import {
  CUA_ACTION_TOOLS,
  CUA_BROWSER_MUTATION_TOOLS,
  CUA_BROWSER_TOOLS,
  CUA_DRIVER_VERSION,
  CUA_READ_TOOLS,
  CUA_SETUP_TIMEOUT_MS,
  cuaComputerTaskKey,
  parseCuaShieldArgs,
  type CuaComputerTask,
  type CuaReply,
} from "@glade/shared/computer/cuaDriverProtocol";
import { access } from "node:fs/promises";
import { type Socket } from "node:net";
import { CUA_DRIVER_MISSING_MESSAGE, TaskRequest, log } from "./cuaHostPolicy";
import { type CuaHostRuntime } from "./cuaHostRuntimeTypes";
import { linuxCuaAdmissionRefusal } from "./linuxCuaAdmission";

export function createCuaHostDispatch(
  hostRuntime: Pick<
    CuaHostRuntime,
    | "userStoppedTasks"
    | "stopTaskInput"
    | "closed"
    | "suspended"
    | "stop"
    | "interruptInput"
    | "endTask"
    | "endBrowserThread"
    | "operations"
    | "stopping"
    | "generation"
    | "taskStoppedReply"
    | "inputMonitorRequested"
    | "epoch"
    | "options"
    | "inputMonitorUnavailableReply"
    | "warm"
    | "ownPids"
    | "desktopPauseReply"
    | "ensureSpawned"
    | "inputMonitorAvailable"
    | "nativeInputCleanupPending"
    | "interruptNativeInput"
    | "inputInterruptCooldownUntil"
    | "inputInterruptedReply"
    | "checkCurrentPermissions"
    | "retire"
    | "isIsolatedBrowserSetup"
    | "hasBrowserRecoveryObservation"
    | "takeoverTargets"
    | "setFrameTapTask"
    | "call"
    | "isFrameTaskEnded"
    | "frameTapTarget"
    | "primeTapAfterLaunch"
    | "activateInputMonitor"
    | "admissionState"
    | "advanceDesktopEpoch"
    | "requireFreshObservation"
  >,
) {
  async function handleAuthenticatedRequest(
    request: Record<string, unknown>,
    connection: Socket,
    task: CuaComputerTask | undefined,
    admitted: TaskRequest | undefined,
  ): Promise<CuaReply> {
    const taskStopped = () =>
      admitted?.stopped === true ||
      (task && hostRuntime.userStoppedTasks.has(cuaComputerTaskKey(task)));
    if (request.method === "stop") {
      if (task) {
        const scope = await hostRuntime.stopTaskInput(task);
        return { ok: true, result: { stop_scope: scope } };
      }

      if (hostRuntime.closed || hostRuntime.suspended) await hostRuntime.stop();
      else await hostRuntime.interruptInput();
      return { ok: true };
    }
    if (request.method === "end_task") {
      if (!task) throw new Error("Computer task attribution is required.");
      await hostRuntime.endTask(task, task.turnId === undefined);
      return { ok: true };
    }
    if (request.method === "shield") {
      // Answered before the closed/suspended gate on purpose: engage checks those itself, while release
      // must land in every host state — a shield left up because teardown was gated is exactly the
      // failure this surface exists to prevent.
      return handleShield(request, task);
    }
    if (request.method === "end_browser_thread") {
      // Explicit browser teardown for a removed thread: end the thread's lifecycle session so the driver
      // runs its session-end hooks (targets, grants, owned browsers) now rather than at
      // control-connection EOF. Queued like a call so it cannot race an in-flight call on the same label
      // — ending a session under a dispatching call would turn a known-alive capability into a mid-flight
      // session death.
      if (!task) throw new Error("Computer task attribution is required.");
      await hostRuntime.endBrowserThread(task);
      return { ok: true };
    }
    if (hostRuntime.closed) throw new Error("Computer host is closed.");
    if (hostRuntime.suspended)
      throw new Error("Computer host is suspended while the backend is stopping.");
    if (taskStopped()) return hostRuntime.taskStoppedReply();
    const monitorRefusal = await hostRuntime.activateInputMonitor(
      request,
      connection,
      task,
      taskStopped,
    );
    if (monitorRefusal) return monitorRefusal;
    // Hosts without a permission bridge can warm on first touch. On macOS, wait for the first granted
    // snapshot below so the daemon cannot cache a denied TCC result before setup completes.
    if (
      !hostRuntime.options.checkPermissions &&
      (request.method === "probe" ||
        (request.method === "call" && request.name === "check_permissions"))
    )
      hostRuntime.warm();
    if (request.method === "probe") {
      try {
        await access(hostRuntime.options.binaryPath);
      } catch {
        return {
          ok: false,
          error: CUA_DRIVER_MISSING_MESSAGE,
        };
      }
      return {
        ok: true,
        result: { version: CUA_DRIVER_VERSION, running: !!hostRuntime.generation },
      };
    }
    if (request.method === "setup") {
      connection.setTimeout(CUA_SETUP_TIMEOUT_MS);
      await hostRuntime.stop();
      if (connection.destroyed || hostRuntime.closed || hostRuntime.suspended)
        return {
          ok: false,
          error: "Cancelled before permission setup.",
          effect: "not-dispatched",
        };
      await hostRuntime.options.setup();
      return { ok: true };
    }
    const name = request.name;
    if (
      request.method !== "call" ||
      typeof name !== "string" ||
      (!CUA_READ_TOOLS.has(name) && !CUA_ACTION_TOOLS.has(name) && !CUA_BROWSER_TOOLS.has(name))
    )
      throw new Error("Unsupported computer host request.");
    if (process.platform === "linux" && !CUA_BROWSER_TOOLS.has(name)) {
      const refusal = linuxCuaAdmissionRefusal(name, request.args, request.deliveryMode);
      if (refusal) return refusal;
    }

    if (CUA_BROWSER_TOOLS.has(name) && !task)
      throw new Error("Computer browser calls require task attribution.");
    if (CUA_BROWSER_TOOLS.has(name)) {
      const args =
        request.args && typeof request.args === "object" && !Array.isArray(request.args)
          ? (request.args as Record<string, unknown>)
          : {};
      const pid = args.pid;
      if (typeof pid === "number" && Number.isSafeInteger(pid) && hostRuntime.ownPids().has(pid)) {
        const message =
          "Computer browser calls may never target this application's own processes; the integrated browser is a separate surface.";
        return {
          ok: true,
          result: {
            isError: true,
            content: [{ type: "text", text: message }],
            structuredContent: { effect: "refused", code: "browser_self_target", message },
          },
        };
      }
    }
    if (hostRuntime.admissionState().paused) return hostRuntime.desktopPauseReply();
    // Observations and input share one native session. A pane capture must not race input or turn a
    // harmless concurrent read into a driver restart.
    const previous = hostRuntime.operations;
    const stopping = hostRuntime.stopping;
    const epoch = hostRuntime.epoch;
    const operation = (async (): Promise<CuaReply> => {
      await previous;
      await stopping;
      if (
        hostRuntime.closed ||
        hostRuntime.suspended ||
        connection.destroyed ||
        epoch !== hostRuntime.epoch
      )
        return {
          ok: false,
          error: "Cancelled before dispatch.",
          effect: "not-dispatched",
        } as const;
      if (hostRuntime.admissionState().paused) return hostRuntime.desktopPauseReply();
      if (process.platform === "linux" && CUA_BROWSER_TOOLS.has(name)) {
        // Capability comes only from the embedded child handshake. A cold browser call must not trust model
        // arguments or a configured path as evidence that this Linux artifact implements input
        // cancellation.
        const generation = await hostRuntime.ensureSpawned();
        if (
          hostRuntime.closed ||
          hostRuntime.suspended ||
          connection.destroyed ||
          epoch !== hostRuntime.epoch ||
          generation.retired ||
          generation.didExit
        )
          return { ok: false, error: "Cancelled before dispatch.", effect: "not-dispatched" };
        const refusal = linuxCuaAdmissionRefusal(
          name,
          request.args,
          request.deliveryMode,
          generation.browserInputControl,
        );
        if (refusal) return refusal;
      }
      if (!hostRuntime.inputMonitorAvailable(name, request.args))
        return hostRuntime.inputMonitorUnavailableReply();
      if (
        (CUA_ACTION_TOOLS.has(name) || CUA_BROWSER_MUTATION_TOOLS.has(name)) &&
        hostRuntime.nativeInputCleanupPending
      ) {
        await hostRuntime.interruptNativeInput(hostRuntime.nativeInputCleanupPending);
        if (epoch !== hostRuntime.epoch || connection.destroyed)
          return {
            ok: false,
            error: "Cancelled while waiting for native input cleanup.",
            effect: "not-dispatched",
          };
      }

      if (
        hostRuntime.inputInterruptCooldownUntil > Date.now() &&
        (CUA_ACTION_TOOLS.has(name) || CUA_BROWSER_MUTATION_TOOLS.has(name))
      )
        return hostRuntime.inputInterruptedReply();
      if (taskStopped()) {
        return hostRuntime.taskStoppedReply();
      }
      if (name === "check_permissions" && hostRuntime.options.checkPermissions) {
        return hostRuntime.checkCurrentPermissions({
          connection,
          task,
          cancelled: () =>
            hostRuntime.closed ||
            hostRuntime.suspended ||
            connection.destroyed ||
            epoch !== hostRuntime.epoch ||
            taskStopped(),
          onChange: async (previous, next) => {
            hostRuntime.epoch += 1;
            hostRuntime.advanceDesktopEpoch();
            hostRuntime.requireFreshObservation();
            log(
              `permission state changed accessibility ${previous.accessibility} -> ${next.accessibility}, ` +
                `screen_recording ${previous.screenRecording} -> ${next.screenRecording}; requiring fresh desktop observation`,
            );
            if (hostRuntime.generation) await hostRuntime.retire(hostRuntime.generation);
          },
          warm: hostRuntime.warm,
          monitorState: () =>
            hostRuntime.inputMonitorRequested
              ? hostRuntime.options.inputMonitorState?.()
              : undefined,
          bundleId: hostRuntime.options.bundleId,
        });
      }
      const browserRecoverySetup = hostRuntime.isIsolatedBrowserSetup(name, request.args);
      const browserRecoveryObserved = hostRuntime.hasBrowserRecoveryObservation(request.args, task);
      // Launching names an app, not anything on screen, so a stale view cannot misdirect it. Gating it
      // left a task that starts by opening an app stuck after every lock or sleep: the app had no window
      // to observe.
      if (
        (hostRuntime.admissionState().desktopObservationRequired &&
          ((CUA_ACTION_TOOLS.has(name) && name !== "launch_app") ||
            name === "check_input_ready")) ||
        (hostRuntime.admissionState().browserObservationRequired &&
          CUA_BROWSER_MUTATION_TOOLS.has(name) &&
          !browserRecoverySetup &&
          !browserRecoveryObserved) ||
        ((hostRuntime.takeoverTargets.has(task ? cuaComputerTaskKey(task) : "anonymous") ||
          (!task && hostRuntime.takeoverTargets.size > 0)) &&
          (CUA_ACTION_TOOLS.has(name) ||
            (CUA_BROWSER_MUTATION_TOOLS.has(name) &&
              !browserRecoverySetup &&
              !browserRecoveryObserved) ||
            name === "check_input_ready"))
      ) {
        log(`refused ${name}: fresh desktop observation still required`);
        return hostRuntime.desktopPauseReply();
      }
      if (
        task &&
        (request.modelObservation === true ||
          CUA_ACTION_TOOLS.has(name) ||
          CUA_BROWSER_TOOLS.has(name))
      )
        hostRuntime.setFrameTapTask(task);
      const reply = await hostRuntime.call(
        name,
        request.args,
        connection,
        request.modelObservation === true,
        task,
        request.deliveryMode === "foreground",
      );

      if (
        task &&
        !hostRuntime.isFrameTaskEnded(task) &&
        !taskStopped() &&
        epoch === hostRuntime.epoch &&
        !connection.destroyed &&
        reply.ok &&
        !reply.result?.isError &&
        reply.result?.structuredContent?.effect !== "refused" &&
        reply.result?.structuredContent?.status !== "refused" &&
        (request.modelObservation === true ||
          CUA_ACTION_TOOLS.has(name) ||
          CUA_BROWSER_TOOLS.has(name))
      ) {
        const target = hostRuntime.frameTapTarget(task, request.args);
        if (target) {
          try {
            hostRuntime.options.frameTap?.update(target);
          } catch (error) {
            log(`computer frame tap update failed: ${String(error)}`);
          }
        } else if (name === "launch_app") {
          // launch_app carries no window (bundle/name only), so the tap would otherwise sit out the whole
          // cold start until the first window-attributed call.
          void hostRuntime
            .primeTapAfterLaunch(task, request.args, connection, epoch)
            .catch((error: unknown) =>
              log(`computer frame tap launch prime failed: ${String(error)}`),
            );
        }
      }
      return reply;
    })();
    hostRuntime.operations = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async function handleShield(
    request: Record<string, unknown>,
    task: CuaComputerTask | undefined,
  ): Promise<CuaReply> {
    const args = parseCuaShieldArgs(request.args);
    if (!args) throw new Error("Invalid computer shield request.");
    const shield = hostRuntime.options.shield;
    if (args.action === "engage") {
      if (hostRuntime.closed || hostRuntime.suspended) {
        return {
          ok: false,
          error: "The activation shield is unavailable while the computer host is stopped.",
          effect: "not-dispatched",
        };
      }
      if (hostRuntime.admissionState().paused) {
        return {
          ok: false,
          error:
            "The activation shield is unavailable while the desktop is paused. " +
            "Observe the desktop again before activating windows.",
          effect: "not-dispatched",
        };
      }
      if (!shield) {
        return {
          ok: false,
          error: "The activation shield is not available in this build.",
          effect: "not-dispatched",
        };
      }
      try {
        await shield.engage(
          {
            shieldId: args.shieldId,
            frame: args.frame,
            windowId: args.windowId,
            pid: args.pid,
            ...(args.label !== undefined ? { label: args.label } : {}),
          },
          task,
        );
      } catch (error) {
        return {
          ok: false,
          error: `The activation shield could not be shown: ${
            error instanceof Error ? error.message : String(error)
          }`,
          effect: "not-dispatched",
        };
      }
      return { ok: true, result: { engaged: true, shield_id: args.shieldId } };
    }
    if (args.action === "release") {
      await shield?.release(args.shieldId);
      return { ok: true };
    }
    const released = (await shield?.releaseAll()) ?? 0;
    return { ok: true, result: { released } };
  }

  return { handleAuthenticatedRequest };
}
