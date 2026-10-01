import {
  CUA_DRIVER_VERSION,
  CUA_NATIVE_REVISION,
  cuaCleanupAcknowledged,
  cuaRequest,
  type CuaReply,
} from "@glade/shared/computer/cuaDriverProtocol";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, chmod, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  CUA_CURSOR_IDLE_HIDE_MS,
  CUA_DRIVER_MISSING_MESSAGE,
  Generation,
  TaskCursor,
  log,
  normalizeCuaCursorStyle,
} from "./cuaHostPolicy";
import { type CuaHostRuntime } from "./cuaHostRuntimeTypes";

export function createCuaDriverGeneration(
  hostRuntime: Pick<
    CuaHostRuntime,
    | "closed"
    | "suspended"
    | "starting"
    | "retiring"
    | "generation"
    | "options"
    | "runtimeDirectory"
    | "updateInputMonitorArmed"
    | "observedNativeRevision"
    | "browserTargets"
    | "browserRecoveryObservations"
    | "nativeInputCleanupPending"
  >,
) {
  let warmAttempted = false;

  function warm(): void {
    if (warmAttempted || hostRuntime.closed || hostRuntime.suspended) return;
    const raw = process.env.GLADE_CUA_WARM_ON_FIRST_TOUCH?.trim().toLowerCase();
    if (raw !== "1" && raw !== "true" && raw !== "on" && raw !== "yes") return;
    warmAttempted = true;
    void ensureSpawned().catch((error: unknown) => {
      log(`driver warm-up failed: ${String(error)}`);
    });
  }

  async function ensureControlSession(generation: Generation): Promise<void> {
    if (generation.controlSocket && !generation.controlSocket.destroyed) return;

    if (generation.controlSocket) {
      for (const label of generation.liveBrowserSessions)
        generation.endedBrowserSessions.add(label);
      generation.liveBrowserSessions.clear();
    }
    const socket = createConnection(generation.socket);
    generation.controlSocket = socket;
    socket.on("error", () => undefined);
    try {
      const reply = await new Promise<CuaReply>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const timeout = setTimeout(() => reject(new Error("session_begin timed out")), 10_000);
        const fail = () => {
          clearTimeout(timeout);
          reject(new Error("session_begin connection closed"));
        };
        socket.once("close", fail);
        socket.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          const end = Buffer.concat(chunks).indexOf(10);
          if (end < 0) return;
          clearTimeout(timeout);
          socket.removeListener("close", fail);
          socket.removeAllListeners("data");
          try {
            resolve(JSON.parse(Buffer.concat(chunks).subarray(0, end).toString("utf8")));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
        socket.write(
          JSON.stringify({
            method: "session_begin",
            session_id: generation.controlSession,
          }) + "\n",
        );
      });
      if (!reply.ok) throw new Error(reply.error ?? "session_begin refused.");
    } catch (error) {
      socket.destroy();
      if (generation.controlSocket === socket) generation.controlSocket = undefined;
      throw error;
    }
  }

  function ensureSpawned(): Promise<Generation> {
    if (hostRuntime.starting) return hostRuntime.starting;
    const start = async () => {
      await hostRuntime.retiring;
      if (hostRuntime.closed) throw new Error("Computer host is closed.");
      if (
        hostRuntime.generation &&
        !hostRuntime.generation.retired &&
        !hostRuntime.generation.didExit
      )
        return hostRuntime.generation;
      if (hostRuntime.generation) await retire(hostRuntime.generation);
      try {
        await access(hostRuntime.options.binaryPath);
      } catch {
        throw new Error(CUA_DRIVER_MISSING_MESSAGE);
      }
      const endpoint =
        process.platform === "win32"
          ? `\\\\.\\pipe\\glade-cua-driver-${randomUUID().slice(0, 8)}`
          : join(hostRuntime.runtimeDirectory(), `driver-${randomUUID().slice(0, 8)}.sock`);
      // Park the compact cursor between actions until end_task removes it, with a one-minute native
      // expiry if cleanup cannot be acknowledged. Idle compact cursors sleep without repainting; model
      // latency must not make the only agent indicator disappear. Upstream cannot parse these flags.
      const expectsPatched = hostRuntime.options.nativeRevision !== null;
      const child = spawn(
        hostRuntime.options.binaryPath,
        [
          "serve",
          "--embedded",
          "--socket",
          endpoint,
          ...(expectsPatched
            ? ["--compact-cursor", "--idle-hide-ms", String(CUA_CURSOR_IDLE_HIDE_MS)]
            : []),
        ],
        {
          stdio: ["pipe", "ignore", "pipe"],
          env: {
            ...process.env,
            CUA_DRIVER_EMBEDDED: "1",
            CUA_DRIVER_HOST_BUNDLE_ID: hostRuntime.options.bundleId,
            CUA_DRIVER_PERMISSION_MODE: "standard",
            CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",

            CUA_DRIVER_RS_UPDATE_CHECK: "0",

            GLADE_CUA_FOREGROUND_OBSERVATION_MS: "100",

            GLADE_CUA_BACKGROUND_OBSERVATION_MS: "350",
            CUA_DRIVER_PARENT_LIVENESS_STDIN: "1",
            CUA_DRIVER_EMBEDDED_HOST_PID: String(process.pid),
            CUA_DRIVER_RS_HOME: join(hostRuntime.runtimeDirectory(), "state"),
          },
        },
      );

      const stderrTail: string[] = [];
      let stderrPending = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        const lines = (stderrPending + chunk.toString("utf8")).split("\n");
        stderrPending = lines.pop()!.slice(-4096);
        for (const line of lines) {
          if (!line.trim()) continue;

          const overlay = line.match(
            /^glade_cua_overlay_init code=(overlay_display_unavailable|overlay_window_unavailable)$/,
          );
          const restore = line.match(
            /^glade_cua_focus_restore status=(not-needed|restored|failed|unobservable|user-changed)$/,
          );
          if (overlay || restore)
            log(
              JSON.stringify({
                event: overlay ? "computer_cursor_init" : "computer_focus_restore",
                ts: new Date().toISOString(),
                ...(overlay ? { code: overlay[1] } : { status: restore![1] }),
              }),
            );
          stderrTail.push(line.slice(0, 200));
          if (stderrTail.length > 20) stderrTail.shift();
        }
      });
      const exited = new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.once("error", () => resolve());
      });
      void exited.then(() => {
        if (stderrTail.length) log(`driver stderr tail: ${stderrTail.join(" | ")}`);
      });
      const generation: Generation = {
        nativeInputEpoch: 0,
        browserInputControl: false,
        child,
        socket: endpoint,
        session: `glade-${randomUUID()}`,
        exited,
        didExit: false,
        retired: false,
        cancellationReady: false,
        inputInFlight: false,
        inputTask: undefined,
        browserInputInFlight: false,
        inputEverDispatched: false,
        controlSession: `glade-transport-${randomUUID()}`,
        controlSocket: undefined,
        endedBrowserSessions: new Set<string>(),
        liveBrowserSessions: new Set<string>(),
        endedTaskSessions: new Set<string>(),
        appliedCursorStyle: "",
        appliedSessionCursorStyles: new Map<string, string>(),
        taskCursors: new Map<string, TaskCursor>(),
      };
      hostRuntime.generation = generation;
      hostRuntime.updateInputMonitorArmed();
      void exited.then(() => {
        generation.didExit = true;
      });
      try {
        let metadata: CuaReply | undefined;
        for (let attempt = 0; attempt < 80; attempt++) {
          if (generation.retired || generation.didExit)
            throw new Error("Cua Driver stopped during startup.");
          try {
            metadata = await cuaRequest<CuaReply>(
              endpoint,
              { method: "metadata" },
              { timeoutMs: 200 },
            );
            break;
          } catch {
            await delay(50);
          }
        }
        // `nativeRevision: null` expects an unpatched upstream driver — its metadata carries no Glade
        // revision and the field must not be required. A patched build is still accepted there: a superset
        // of the expected identity is never a downgrade.
        const expectedNativeRevision =
          hostRuntime.options.nativeRevision === undefined
            ? CUA_NATIVE_REVISION
            : hostRuntime.options.nativeRevision;
        const reportedRevision = metadata?.result?.glade_native_revision;
        if (
          !metadata?.ok ||
          metadata.result?.driver_version !== CUA_DRIVER_VERSION ||
          (expectedNativeRevision !== null && reportedRevision !== expectedNativeRevision) ||
          metadata.result?.embedded !== true ||
          metadata.result?.pid !== child.pid
        )
          throw new Error("Cua Driver identity/version/native revision handshake failed.");
        hostRuntime.observedNativeRevision =
          typeof reportedRevision === "number" && Number.isSafeInteger(reportedRevision)
            ? reportedRevision
            : 0;
        generation.browserInputControl =
          process.platform === "linux" &&
          reportedRevision === CUA_NATIVE_REVISION &&
          metadata.result?.glade_browser_input_control === 1;
        if (generation.retired || generation.didExit)
          throw new Error("Cua Driver stopped during startup.");
        generation.cancellationReady =
          expectedNativeRevision !== null || generation.browserInputControl;
        if (process.platform !== "win32") await chmod(endpoint, 0o600);
        if (generation.retired || generation.didExit)
          throw new Error("Cua Driver stopped during startup.");
        return generation;
      } catch (error) {
        await retire(generation);
        throw error;
      }
    };
    hostRuntime.starting = start().finally(() => {
      hostRuntime.starting = undefined;
    });
    return hostRuntime.starting;
  }

  async function openSession(generation: Generation): Promise<void> {
    generation.sessionOpening ??= (async () => {
      const startupTimeoutMs = hostRuntime.options.startupTimeoutMs ?? 5_000;
      if (generation.retired || generation.didExit)
        throw new Error("Cua Driver stopped during startup.");
      const session = await cuaRequest<CuaReply>(
        generation.socket,
        {
          method: "call",
          name: "start_session",
          args: { session: generation.session },
        },
        { timeoutMs: startupTimeoutMs },
      );
      if (!session.ok || session.result?.isError)
        throw new Error("Cua session initialization failed.");
      if (generation.retired || generation.didExit)
        throw new Error("Cua Driver stopped during startup.");

      const motion = await cuaRequest<CuaReply>(
        generation.socket,
        {
          method: "call",
          name: "set_agent_cursor_motion",
          args: {
            session: generation.session,
            glide_duration_ms: 100,
            dwell_after_click_ms: 0,
          },
        },
        { timeoutMs: startupTimeoutMs },
      );
      if (!motion.ok || motion.result?.isError)
        throw new Error("Cua cursor initialization failed.");
      // Stock sends nothing at all, so a default install keeps the driver's own monochrome art; an
      // unpatched upstream driver has no style tool, so a configured style stays stock there. The shared
      // session rarely paints an action (task calls carry their own label), so this is best-effort: a
      // cosmetic color must never retire a driver, and the per-task application below carries the real
      // work.
      const style = normalizeCuaCursorStyle(hostRuntime.options.cursorStyle?.());
      if (style && hostRuntime.observedNativeRevision !== 0) {
        try {
          const styled = await cuaRequest<CuaReply>(
            generation.socket,
            {
              method: "call",
              name: "set_agent_cursor_style",
              args: { session: generation.session, ...style },
            },
            { timeoutMs: startupTimeoutMs },
          );
          if (!styled.ok || styled.result?.isError) {
            log("shared cursor session style was refused; keeping the stock cursor");
          } else {
            generation.appliedCursorStyle = JSON.stringify(style);
          }
        } catch (error) {
          log(`shared cursor session style failed: ${String(error)}`);
        }
      }
    })();
    try {
      await generation.sessionOpening;
    } catch (error) {
      await retire(generation);
      throw error;
    }
  }

  async function ensureStarted(): Promise<Generation> {
    const generation = await ensureSpawned();
    await openSession(generation);
    return generation;
  }

  async function terminate(generation: Generation): Promise<void> {
    if (generation.didExit) return;
    // End the lifetime pipe too: Tokio's blocking stdin reader otherwise keeps the native runtime alive
    // during graceful shutdown.
    generation.child.stdin?.end();
    const graceful = setTimeout(() => generation.child.kill("SIGTERM"), 500);
    const force = setTimeout(() => generation.child.kill("SIGKILL"), 1_500);
    try {
      // Every retire branch that reaches terminate() has already proven the generation cannot hold OS
      // input, so even a kernel-wedged process that survives SIGKILL must not hang the whole retirement
      // chain.
      await Promise.race([generation.exited, delay(4_000)]);
    } finally {
      clearTimeout(graceful);
      clearTimeout(force);
    }
    if (!generation.didExit)
      log(
        `driver pid=${generation.child.pid} did not exit after SIGKILL; releasing the generation anyway`,
      );
  }

  function retire(generation: Generation): Promise<void> {
    if (generation.retirement) return generation.retirement;
    generation.retired = true;
    hostRuntime.browserTargets.clear();
    hostRuntime.browserRecoveryObservations.clear();
    if (hostRuntime.nativeInputCleanupPending === generation)
      hostRuntime.nativeInputCleanupPending = undefined;
    hostRuntime.updateInputMonitorArmed();
    // Browser teardown rides the control connection's lifetime: closing it now lets the driver's EOF
    // reaper end every session this transport owns while the daemon is still alive to run its cleanup
    // hooks, instead of racing termination.
    generation.controlSocket?.destroy();
    generation.controlSocket = undefined;
    hostRuntime.retiring = hostRuntime.retiring.then(async () => {
      const inputUncertain = generation.inputInFlight;
      const releaseHeldInput = async () => {
        if (
          !inputUncertain ||
          generation.browserInputInFlight ||
          !hostRuntime.options.releaseHeldInput
        )
          return false;
        try {
          await hostRuntime.options.releaseHeldInput();
          log("released held input left by the dead driver generation");
          return true;
        } catch (error) {
          log(`held-input release failed: ${String(error)}`);
          return false;
        }
      };
      if (generation.didExit && generation.inputInFlight) {
        // Without a confirmed release the held state is unprovable: keep the dead generation referenced so
        // every later request fails closed instead of a replacement compounding the uncertainty.
        if (await releaseHeldInput()) {
          if (hostRuntime.generation === generation) hostRuntime.generation = undefined;
          await rm(generation.socket, { force: true });
          return;
        }
        throw new Error(
          "Cua Driver exited during input without confirming native cleanup. Computer admission is closed.",
        );
      }
      if (!generation.didExit && generation.cancellationReady) {
        let cleanupConfirmed = false;
        try {
          const reply = await cuaRequest<CuaReply>(
            generation.socket,
            {
              method: "cancel_input",
              args: { expected_pid: generation.child.pid },
            },
            { timeoutMs: 5_000 },
          );
          cleanupConfirmed =
            reply.ok === true && cuaCleanupAcknowledged(reply.result, generation.child.pid);
        } catch {
          cleanupConfirmed = false;
        }
        if (!cleanupConfirmed) {
          if (!generation.didExit) await Promise.race([generation.exited, delay(500)]);
          if (generation.didExit) {
            const cleared = !generation.inputInFlight || (await releaseHeldInput());
            if (cleared) {
              if (hostRuntime.generation === generation) hostRuntime.generation = undefined;
              await rm(generation.socket, { force: true });
              return;
            }
            throw new Error(
              "Cua Driver exited during input without confirming native cleanup. Computer admission is closed.",
            );
          }
          if (!generation.inputEverDispatched) {
            // The driver only ever holds OS input in response to a dispatched action, and none ever reached
            // this generation — a wedge during startup or between reads cannot leave input held. Terminate and
            // clear so the next request spawns a replacement instead of closing admission for the host's
            // lifetime.
            await terminate(generation);
            if (hostRuntime.generation === generation) hostRuntime.generation = undefined;
            await rm(generation.socket, { force: true });
            return;
          }

          await releaseHeldInput();
          throw new Error(
            "Cua Driver did not confirm native input cleanup. Computer admission is closed; the driver was not killed or replaced.",
          );
        }
        generation.inputInFlight = false;
      }
      // Before the validated handshake no action can have been dispatched. Otherwise the authenticated
      // acknowledgement above covers all matching releases and native context restoration before
      // termination is allowed.
      await terminate(generation);
      if (hostRuntime.generation === generation) hostRuntime.generation = undefined;
      await rm(generation.socket, { force: true });
    });
    generation.retirement = hostRuntime.retiring;
    // The rejection belongs to whoever retired this generation — not to the sequencing chain. A cleanup
    // that throws ("admission closed") must not leave `this.retiring` rejected forever, or one
    // mid-input daemon death would refuse every generation the host ever tries to spawn.
    hostRuntime.retiring = hostRuntime.retiring.then(
      () => undefined,
      () => undefined,
    );
    return generation.retirement;
  }

  return { warm, ensureControlSession, ensureSpawned, ensureStarted, retire };
}
