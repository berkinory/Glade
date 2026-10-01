import {
  cuaActionDiagnosticMessage,
  parseCuaActionDiagnostics,
} from "@glade/shared/computer/cuaActionDiagnostics";
import {
  CUA_ACTION_TOOLS,
  cuaComputerTaskKey,
  parseCuaComputerTask,
  type CuaComputerTask,
  type CuaReply,
} from "@glade/shared/computer/cuaDriverProtocol";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOGGABLE_CUA_CODES, log, safeNativeId } from "./cuaHostPolicy";
import { type CuaHostRuntime } from "./cuaHostRuntimeTypes";
import { markCuaRuntimeDirectory } from "./cuaRuntimeOwnership";

export function createCuaHostTransport(
  hostRuntime: Pick<CuaHostRuntime, "options" | "desktopState" | "handleAuthenticatedRequest">,
) {
  let directory = "";
  let server: Server | undefined;
  const connections = new Set<Socket>();
  const repliedConnections = new WeakSet<Socket>();
  const admittedTaskRequests = new Set<{ task: CuaComputerTask; stopped: boolean }>();
  const knownTasks = new Map<string, CuaComputerTask>();

  async function listen(): Promise<string> {
    directory = await mkdtemp(join(tmpdir(), "glade-cua-"));
    await chmod(directory, 0o700);
    await markCuaRuntimeDirectory(directory);

    const endpoint =
      hostRuntime.options.hostEndpoint ??
      (process.platform === "win32"
        ? `\\\\.\\pipe\\glade-cua-host-${randomUUID().slice(0, 8)}`
        : join(directory, "host.sock"));
    const listener = createServer((socket) => accept(socket));
    server = listener;
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(endpoint, resolve);
    });
    if (process.platform !== "win32") await chmod(endpoint, 0o600);
    return endpoint;
  }

  function accept(socket: Socket): void {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
    socket.on("error", () => undefined);
    const chunks: Buffer[] = [];
    let bytes = 0;
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) {
        socket.destroy();
        return;
      }
      const end = chunk.indexOf(10);
      chunks.push(end < 0 ? chunk : chunk.subarray(0, end));
      if (end < 0) return;
      socket.removeAllListeners("data");
      let request: Record<string, unknown>;
      try {
        request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!request || typeof request !== "object" || Array.isArray(request))
          throw new Error("Invalid request");
      } catch {
        socket.destroy();
        return;
      }
      void handle(request, socket).then(
        (result) => {
          repliedConnections.add(socket);
          socket.end(JSON.stringify({ ...result, ...hostRuntime.desktopState() }) + "\n");
        },
        (error) => {
          repliedConnections.add(socket);
          socket.end(
            JSON.stringify({
              ok: false,
              error: String(error),
              effect: "not-dispatched",
              ...hostRuntime.desktopState(),
            }) + "\n",
          );
        },
      );
    });
    socket.setTimeout(60_000, () => socket.destroy());
  }

  async function handle(request: Record<string, unknown>, connection: Socket): Promise<CuaReply> {
    const name = typeof request.name === "string" ? request.name : "";
    if (request.method !== "call" || !CUA_ACTION_TOOLS.has(name))
      return handleRequest(request, connection);
    const started = Date.now();
    let reply: CuaReply | undefined;
    try {
      reply = await handleRequest(request, connection);
      return reply;
    } finally {
      const task = reply ? parseCuaComputerTask(request.task) : undefined;
      const args =
        request.args && typeof request.args === "object"
          ? (request.args as Record<string, unknown>)
          : {};
      const structured = reply?.result?.structuredContent;
      const diagnostics = parseCuaActionDiagnostics(structured);
      const effect = structured?.effect ?? reply?.effect;
      const refusal = structured?.refusal as Record<string, unknown> | undefined;
      const code = structured?.code ?? refusal?.code;
      log(
        JSON.stringify({
          event: "computer_action",
          ts: new Date().toISOString(),
          thread: task?.threadId,
          turn: task?.turnId,
          tool: name,
          layer: "driver-host",
          code: typeof code === "string" && LOGGABLE_CUA_CODES.has(code) ? code : undefined,
          pid: safeNativeId(args.pid),
          windowId: safeNativeId(args.window_id),
          effect:
            typeof effect === "string" &&
            ["refused", "not-dispatched", "dispatched-unknown", "verified"].includes(effect)
              ? effect
              : "unknown",
          failed: !reply?.ok || reply.result?.isError === true,
          ...(diagnostics
            ? {
                diagnostics,
                reason: cuaActionDiagnosticMessage(diagnostics),
              }
            : {}),
          ms: Date.now() - started,
        }),
      );
    }
  }

  async function handleRequest(
    request: Record<string, unknown>,
    connection: Socket,
  ): Promise<CuaReply> {
    const supplied =
      typeof request.capability === "string" ? Buffer.from(request.capability) : Buffer.alloc(0);
    const expected = Buffer.from(hostRuntime.options.capability);
    if (
      expected.length < 32 ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new Error("Computer host authority is required.");
    const task = parseCuaComputerTask(request.task);
    if (request.task !== undefined && !task) throw new Error("Invalid computer task attribution.");
    const admitted = request.method === "call" && task ? { task, stopped: false } : undefined;
    if (admitted) {
      admittedTaskRequests.add(admitted);
      const key = cuaComputerTaskKey(admitted.task);
      knownTasks.delete(key);
      knownTasks.set(key, admitted.task);
      while (knownTasks.size > 256) knownTasks.delete(knownTasks.keys().next().value!);
    }
    try {
      return await hostRuntime.handleAuthenticatedRequest(request, connection, task, admitted);
    } finally {
      if (admitted) admittedTaskRequests.delete(admitted);
    }
  }

  function stopMatchingTasks(task: CuaComputerTask): CuaComputerTask[] {
    const matches = (candidate: CuaComputerTask) =>
      candidate.threadId === task.threadId &&
      (task.turnId === undefined || candidate.turnId === task.turnId);
    const matched = [...knownTasks.values()].filter(matches);
    for (const admitted of admittedTaskRequests) {
      if (!matches(admitted.task)) continue;
      admitted.stopped = true;
      matched.push(admitted.task);
    }
    return matched;
  }

  async function close(hasGeneration: boolean): Promise<void> {
    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
    if (directory && !hasGeneration) await rm(directory, { recursive: true, force: true });
  }

  return {
    listen,
    runtimeDirectory: () => directory,
    hasReplied: (socket: Socket) => repliedConnections.has(socket),
    stopMatchingTasks,
    closeTransport: close,
  };
}
