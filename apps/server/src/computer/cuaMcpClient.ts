import type { ComputerMcpLaunch } from "@glade/contracts/computer/computerHost";
import { spawnProcess } from "@glade/shared/platform/processRuntime";

import { teardownChildProcessTree } from "../platform/supervisedProcessTeardown.ts";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const INITIALIZE_TIMEOUT_MS = 15_000;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const STDERR_TAIL_CHARS = 2_000;
// The proxy relays to the daemon over the socket named in its launch spec; it needs the user's
// session basics, not the server's provider credentials.
const INHERITED_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "XDG_RUNTIME_DIR",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "DBUS_SESSION_BUS_ADDRESS",
  "SystemRoot",
  "windir",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "PATHEXT",
] as const;

export class CuaMcpFailure extends Error {
  constructor(
    readonly code: "unavailable" | "cancelled" | "protocol",
    message: string,
  ) {
    super(message);
  }
}

export interface CuaMcpClient {
  readonly request: (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>;
  readonly exited: Promise<void>;
  readonly close: () => Promise<void>;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

// A minimal MCP client over the `cua-driver mcp` stdio proxy: newline-delimited JSON-RPC, one
// request table, `notifications/cancelled` when a caller gives up so the driver releases input.
export async function openCuaMcpClient(launch: ComputerMcpLaunch): Promise<CuaMcpClient> {
  const env: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_ENV) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  for (const { name, value } of launch.environment) env[name] = value;
  const child = spawnProcess(launch.command, launch.args, { env, stdio: "pipe" });
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let stdout = "";
  let stderrTail = "";

  let closed: CuaMcpFailure | null = null;
  const failPending = (failure: CuaMcpFailure) => {
    closed ??= failure;
    for (const entry of pending.values()) entry.reject(failure);
    pending.clear();
  };

  const exited = new Promise<void>((resolve) => {
    const finish = () => {
      failPending(
        new CuaMcpFailure(
          "unavailable",
          `The Cua MCP proxy exited.${stderrTail ? ` ${stderrTail.trim()}` : ""}`,
        ),
      );
      resolve();
    };
    child.once("exit", finish);
    child.once("error", finish);
  });
  // A proxy that dies mid-write raises EPIPE here; without a listener it would crash the server.
  child.stdin.on("error", (error) => {
    failPending(
      new CuaMcpFailure("unavailable", `The Cua MCP proxy stopped reading: ${error.message}`),
    );
    void teardownChildProcessTree(child).catch(() => undefined);
  });

  const write = (message: unknown) => {
    if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    let newline = stdout.indexOf("\n");
    while (newline >= 0) {
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      newline = stdout.indexOf("\n");
      if (!line) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const { id, method, result, error } = message;
      if (typeof method === "string") {
        // Server-initiated requests: answer pings, decline anything else.
        if (id === undefined) continue;
        write(
          method === "ping"
            ? { jsonrpc: "2.0", id, result: {} }
            : {
                jsonrpc: "2.0",
                id,
                error: { code: JSON_RPC_METHOD_NOT_FOUND, message: `${method} is unsupported.` },
              },
        );
        continue;
      }
      const entry = typeof id === "number" ? pending.get(id) : undefined;
      if (!entry) continue;
      pending.delete(id as number);
      if (error !== undefined) {
        const detail = (error ?? {}) as { message?: unknown };
        entry.reject(new CuaMcpFailure("protocol", String(detail.message ?? "Cua MCP error.")));
      } else {
        entry.resolve(result);
      }
    }
  });

  const request = (method: string, params: unknown, signal: AbortSignal) =>
    new Promise<unknown>((resolve, reject) => {
      if (signal.aborted) {
        reject(new CuaMcpFailure("cancelled", `${method} was cancelled.`));
        return;
      }
      if (closed) {
        reject(closed);
        return;
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        reject(new CuaMcpFailure("unavailable", "The Cua MCP proxy is not running."));
        return;
      }
      const id = nextId++;
      const onAbort = () => {
        if (!pending.delete(id)) return;
        write({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: id, reason: "Cancelled by Glade." },
        });
        reject(new CuaMcpFailure("cancelled", `${method} was cancelled.`));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      pending.set(id, {
        resolve: (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      });
      write({ jsonrpc: "2.0", id, method, params });
    });

  const close = async () => {
    child.stdin.end();
    await teardownChildProcessTree(child);
  };

  try {
    await request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "glade", version: "1" },
      },
      AbortSignal.timeout(INITIALIZE_TIMEOUT_MS),
    );
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
  write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  return { request, exited, close };
}
