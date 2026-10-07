import type {
  ComputerConnection,
  ComputerUnavailableReason,
} from "@glade/contracts/computer/computerHost";
import type { CuaBinary } from "./cuaBinary";
import type { ComputerPermissions } from "./cuaPermissions";
import { loadCuaSdk } from "./cuaSdk";
import { createWindowsCuaDaemon, type CuaDaemon } from "./cuaWindowsDaemon";

export interface CuaHost {
  readonly connection: () => ComputerConnection;
  // Re-reads the OS grants now instead of waiting for the next poll.
  readonly refresh: () => void;
  readonly stop: () => Promise<void>;
}

// The daemon's environment is limited to Cua's embedded allowlist, which excludes DO_NOT_TRACK;
// the MCP proxy the server launches takes both.
const DAEMON_TELEMETRY_OFF = [{ name: "CUA_DRIVER_RS_TELEMETRY_ENABLED", value: "0" }];
const PROXY_TELEMETRY_OFF = [...DAEMON_TELEMETRY_OFF, { name: "DO_NOT_TRACK", value: "1" }];
const PERMISSION_POLL_MS = 3_000;
const RESTART_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
const STABLE_RUN_MS = 60_000;
const STOP_TIMEOUT_MS = 5_000;

const unavailable = (reason: ComputerUnavailableReason, message: string): ComputerConnection => ({
  state: "unavailable",
  reason,
  message,
});
// SDK errors name their variant in `message` and the detail in `inner.reason`.
const errorMessage = (error: unknown) => {
  const reason = (error as { inner?: { reason?: unknown } } | null)?.inner?.reason;
  const message = error instanceof Error ? error.message : String(error);
  return typeof reason === "string" ? `${message}: ${reason}` : message;
};

// Owns the embedded Cua daemon for the app's lifetime. Only this (permission-owning) process may
// start it; the server receives the MCP launch spec of each generation and runs the proxy itself.
// Every transition runs on one promise chain so a poll, a crash restart and quit never interleave.
export function startCuaHost(input: {
  readonly binary: Promise<CuaBinary>;
  readonly permissions: ComputerPermissions;
  readonly hostBundleId: string;
  readonly publish: (connection: ComputerConnection) => void;
  readonly log: (message: string) => void;
}): CuaHost {
  let current = unavailable("starting", "Cua Driver is starting.");
  let host: CuaDaemon | null = null;
  // The generation this host considers alive; cleared before any intentional stop or restart so
  // that generation's exit is not mistaken for a crash.
  let live: string | null = null;
  let granted: boolean | null = null;
  let failures = 0;
  let stopped = false;
  let restartTimer: NodeJS.Timeout | null = null;
  let chain = Promise.resolve();

  const publish = (connection: ComputerConnection) => {
    current = connection;
    input.publish(connection);
  };
  const serialize = (step: () => Promise<void>) => {
    chain = chain.then(step).catch((error: unknown) => {
      input.log(`cua host transition failed message=${errorMessage(error)}`);
      publish(unavailable("failed", errorMessage(error)));
    });
    return chain;
  };

  const ensureHost = async (binaryPath: string): Promise<CuaDaemon> => {
    if (host) return host;
    if (process.platform === "win32") {
      host = createWindowsCuaDaemon({
        binaryPath,
        hostBundleId: input.hostBundleId,
        environment: DAEMON_TELEMETRY_OFF,
      });
      return host;
    }
    const sdk = await loadCuaSdk();
    host = sdk.EmbeddedCuaDriverHost.withOptions(
      sdk.EmbeddedDriverHostOptions.create({
        binaryPath,
        hostBundleId: input.hostBundleId,
        approveSessionPolicy: false,
        dangerouslyBypassApprovals: false,
        inheritStderr: false,
        environment: DAEMON_TELEMETRY_OFF,
      }),
    );
    return host;
  };

  const scheduleRestart = () => {
    if (stopped || restartTimer) return;
    const delay = RESTART_BACKOFF_MS[Math.min(failures, RESTART_BACKOFF_MS.length - 1)];
    failures += 1;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void serialize(() => launch(true));
    }, delay);
  };

  const watchExit = (driver: CuaDaemon, generation: string, startedAt: number) => {
    driver.waitForExit(generation).then(
      (exit) => {
        if (stopped || live !== generation) return;
        live = null;
        if (Date.now() - startedAt > STABLE_RUN_MS) failures = 0;
        input.log(`cua driver exited generation=${generation} code=${exit.code ?? "none"}`);
        publish(unavailable("failed", "Cua Driver exited unexpectedly; restarting it."));
        scheduleRestart();
      },
      (error: unknown) => input.log(`cua driver exit watch failed message=${errorMessage(error)}`),
    );
  };

  // `restart` replaces a generation that exited on its own; a first start or a start after a stop
  // uses `start`.
  async function launch(restart: boolean): Promise<void> {
    if (stopped || granted === false) return;
    const binary = await input.binary;
    if (!binary.ok) {
      publish(unavailable(binary.reason, binary.message));
      return;
    }
    const driver = await ensureHost(binary.path);
    live = null;
    try {
      const connection = restart ? await driver.restart() : await driver.start();
      live = connection.generation;
      watchExit(driver, connection.generation, Date.now());
      input.log(
        `cua driver started generation=${connection.generation} version=${connection.driverVersion}`,
      );
      publish({
        state: "ready",
        generation: connection.generation,
        driverVersion: connection.driverVersion,
        mcp: {
          command: connection.mcp.command,
          args: connection.mcp.args,
          // The proxy reports telemetry on its own unless told not to.
          environment: [...connection.mcp.environment, ...PROXY_TELEMETRY_OFF],
        },
      });
    } catch (error) {
      publish(unavailable("failed", `Cua Driver did not start: ${errorMessage(error)}`));
      scheduleRestart();
    }
  }

  const stopDriver = async () => {
    live = null;
    await host?.stop();
  };

  const checkPermissions = async () => {
    const permissions = await input.permissions.read();
    const now = permissions.status !== "missing";
    if (now === granted) return;
    granted = now;
    if (!now) {
      await stopDriver();
      publish(
        unavailable(
          "permissions_required",
          "Grant Glade Accessibility and Screen Recording access in System Settings.",
        ),
      );
      return;
    }
    // Grants attach to the daemon at start; a revoked grant stopped it above, so start fresh.
    await launch(false);
  };

  void serialize(checkPermissions);
  const poll = setInterval(() => void serialize(checkPermissions), PERMISSION_POLL_MS);

  return {
    connection: () => current,
    refresh: () => void serialize(checkPermissions),
    stop: async () => {
      if (stopped) return chain;
      stopped = true;
      clearInterval(poll);
      if (restartTimer) clearTimeout(restartTimer);
      await serialize(async () => {
        const driver = host;
        host = null;
        live = null;
        if (!driver) return;
        await Promise.race([
          driver.stop(),
          new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
        ]);
      });
    },
  };
}
