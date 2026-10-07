import type { ChildProcess } from "node:child_process";
import * as Crypto from "node:crypto";
import * as Net from "node:net";
import { spawnProcess } from "@glade/shared/platform/processRuntime";

interface McpLaunch {
  readonly command: string;
  readonly args: string[];
  readonly environment: { name: string; value: string }[];
}

export interface CuaDaemonConnection {
  readonly generation: string;
  readonly driverVersion: string;
  readonly mcp: McpLaunch;
}

// The lifecycle `startCuaHost` drives; Cua's embedded SDK host satisfies it structurally.
export interface CuaDaemon {
  readonly start: () => Promise<CuaDaemonConnection>;
  readonly restart: () => Promise<CuaDaemonConnection>;
  readonly stop: () => Promise<void>;
  readonly waitForExit: (generation: string) => Promise<{ readonly code?: number }>;
}

interface Running {
  readonly generation: string;
  readonly child: ChildProcess;
  readonly exit: Promise<{ readonly code?: number }>;
}

const STARTUP_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 2_000;
const PROBE_INTERVAL_MS = 50;
const PROBE_TIMEOUT_MS = 1_000;
// Cua's embedded host clears the daemon's environment down to this allowlist; keep the same
// boundary so provider credentials in Glade's environment never reach the driver.
const INHERITED_ENV = new Set([
  "PATH",
  "TMP",
  "TEMP",
  "LANG",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "CUA_LOG",
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One `metadata` request over the daemon's pipe; null while the pipe is not answering yet.
function requestMetadata(pipe: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const socket = Net.connect(pipe);
    let buffer = "";
    const finish = (value: Record<string, unknown> | null) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(null));
    socket.once("error", () => finish(null));
    socket.once("connect", () => socket.write(`${JSON.stringify({ method: "metadata" })}\n`));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as {
          ok?: unknown;
          result?: Record<string, unknown>;
        };
        finish(response.ok === true && response.result ? response.result : null);
      } catch {
        finish(null);
      }
    });
  });
}

// Windows replacement for Cua's embedded host, which spawns the console-subsystem daemon without
// CREATE_NO_WINDOW and so gives it a visible console. It runs the same `serve --embedded` contract
// (parent liveness on stdin, private pipe, host pid) through the shared runtime, which hides the
// window; macOS needs the SDK host for TCC responsibility, Windows has no such constraint.
// `startCuaHost` serializes every call, so this keeps no state machine of its own.
export function createWindowsCuaDaemon(input: {
  readonly binaryPath: string;
  readonly hostBundleId: string;
  readonly environment: ReadonlyArray<{ readonly name: string; readonly value: string }>;
}): CuaDaemon {
  let running: Running | null = null;
  let last: Running | null = null;

  const stop = async () => {
    const current = running;
    running = null;
    if (!current) return;
    last = current;
    // Closing stdin is the daemon's graceful shutdown signal.
    current.child.stdin?.end();
    const exited = await Promise.race([
      current.exit.then(() => true),
      sleep(SHUTDOWN_TIMEOUT_MS).then(() => false),
    ]);
    if (!exited) {
      current.child.kill();
      await current.exit;
    }
  };

  const start = async (): Promise<CuaDaemonConnection> => {
    await stop();
    const generation = Crypto.randomBytes(16).toString("hex");
    const pipe = `\\\\.\\pipe\\cua-${process.pid}-${generation.slice(0, 8)}`;
    const env: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(process.env)) {
      const upper = name.toUpperCase();
      if (INHERITED_ENV.has(upper) || upper.startsWith("LC_")) env[name] = value;
    }
    for (const { name, value } of input.environment) env[name] = value;
    env.CUA_DRIVER_EMBEDDED_HOST_PID = String(process.pid);

    const child = spawnProcess(
      input.binaryPath,
      [
        "serve",
        "--embedded",
        "--parent-liveness-stdio",
        "--no-permissions-gate",
        "--socket",
        pipe,
        "--host-bundle-id",
        input.hostBundleId,
        "--permission-mode",
        "standard",
      ],
      { env, stdio: ["pipe", "ignore", "ignore"] },
    );
    const exit = new Promise<{ code?: number }>((resolve) => {
      child.once("exit", (code) => resolve(code === null ? {} : { code }));
      child.once("error", () => resolve({}));
    });
    const current: Running = { generation, child, exit };
    running = current;

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (child.exitCode === null && child.signalCode === null) {
      if (Date.now() >= deadline) {
        await stop();
        throw new Error(`Cua Driver did not become ready within ${STARTUP_TIMEOUT_MS}ms.`);
      }
      const metadata = await requestMetadata(pipe);
      if (metadata) {
        // A process that owns the pipe name but is not our child must never be trusted.
        if (
          metadata.pid !== child.pid ||
          metadata.embedded !== true ||
          metadata.host_bundle_id !== input.hostBundleId
        ) {
          await stop();
          throw new Error(`The Cua Driver pipe ${pipe} answered for a different process.`);
        }
        return {
          generation,
          driverVersion: String(metadata.driver_version),
          mcp: {
            command: input.binaryPath,
            args: ["mcp", "--embedded", "--socket", pipe, "--host-bundle-id", input.hostBundleId],
            environment: [],
          },
        };
      }
      await sleep(PROBE_INTERVAL_MS);
    }
    running = null;
    last = current;
    const { code } = await exit;
    throw new Error(`Cua Driver exited before it was ready (code=${code ?? "none"}).`);
  };

  return {
    start,
    restart: start,
    stop,
    waitForExit: (generation) => {
      const match = [running, last].find((entry) => entry?.generation === generation);
      return match
        ? match.exit
        : Promise.reject(new Error(`Cua Driver generation ${generation} is not known.`));
    },
  };
}
