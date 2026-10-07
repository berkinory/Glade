import {
  DESKTOP_HOST_APPLICATION_ERROR,
  DESKTOP_HOST_AUTH_METHOD,
} from "@glade/contracts/desktopHost/desktopHostRpc";
import { encodeFrame, FrameDecoder } from "@glade/shared/desktopHost/frameCodec";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

export type DesktopHostDispatch = (method: string, params: unknown) => Promise<unknown>;

export interface DesktopHostRpcServer {
  readonly path: string;
  readonly notify: (method: string, params: unknown) => void;
  readonly close: () => Promise<void>;
}

const MAX_CONNECTIONS = 8;
const AUTH_TIMEOUT_MS = 5_000;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_INTERNAL_ERROR = -32603;

const digest = (value: string) => Crypto.createHash("sha256").update(value, "utf8").digest();

interface RpcRequest {
  readonly id: string | number;
  readonly method: string;
  readonly params: unknown;
}

function asRequest(message: unknown): RpcRequest | null {
  if (typeof message !== "object" || message === null) return null;
  const { jsonrpc, id, method, params } = message as Record<string, unknown>;
  if (jsonrpc !== "2.0" || typeof method !== "string") return null;
  if (typeof id !== "string" && typeof id !== "number") return null;
  return { id, method, params };
}

function errorResponse(id: RpcRequest["id"] | null, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string"
    ? {
        jsonrpc: "2.0",
        id,
        error: { code: DESKTOP_HOST_APPLICATION_ERROR, message, data: { code } },
      }
    : { jsonrpc: "2.0", id, error: { code: JSON_RPC_INTERNAL_ERROR, message } };
}

function makeSocketPath(platform: NodeJS.Platform): { path: string; directory: string | null } {
  if (platform === "win32") {
    return {
      path: `\\\\.\\pipe\\glade-host-${Crypto.randomBytes(16).toString("hex")}`,
      directory: null,
    };
  }
  // mkdtemp creates the directory 0700, so no other user can reach the socket inside it.
  const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "glade-host-"));
  FS.chmodSync(directory, 0o700);
  return { path: Path.join(directory, "host.sock"), directory };
}

// The first frame on every connection must be an `auth` request carrying the capability token the
// backend received over its private stdio pipe. Anything else closes the socket before any method
// runs, so a local process that finds the socket path learns nothing and can do nothing.
export async function startDesktopHostRpcServer(input: {
  readonly token: string;
  readonly dispatch: DesktopHostDispatch;
  readonly platform?: NodeJS.Platform;
}): Promise<DesktopHostRpcServer> {
  const expected = digest(input.token);
  const { path, directory } = makeSocketPath(input.platform ?? process.platform);
  const sockets = new Set<Net.Socket>();
  const authenticated = new Set<Net.Socket>();

  const write = (socket: Net.Socket, message: unknown) => {
    if (socket.destroyed) return;
    try {
      socket.write(encodeFrame(message));
    } catch (error) {
      const id = (message as { id?: RpcRequest["id"] }).id ?? null;
      socket.write(encodeFrame(errorResponse(id, error)));
    }
  };

  const handle = async (socket: Net.Socket, message: unknown) => {
    const request = asRequest(message);
    if (!request) {
      write(socket, {
        jsonrpc: "2.0",
        id: null,
        error: { code: JSON_RPC_INVALID_REQUEST, message: "Invalid request." },
      });
      return;
    }
    try {
      const result = await input.dispatch(request.method, request.params);
      write(socket, { jsonrpc: "2.0", id: request.id, result: result ?? null });
    } catch (error) {
      write(socket, errorResponse(request.id, error));
    }
  };

  const server = Net.createServer((socket) => {
    if (sockets.size >= MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    const decoder = new FrameDecoder();
    const authTimer = setTimeout(() => socket.destroy(), AUTH_TIMEOUT_MS);
    socket.on("data", (chunk: Buffer) => {
      let messages: unknown[];
      try {
        messages = decoder.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const message of messages) {
        if (authenticated.has(socket)) {
          void handle(socket, message);
          continue;
        }
        const request = asRequest(message);
        const token = (request?.params as { token?: unknown } | undefined)?.token;
        if (
          request?.method !== DESKTOP_HOST_AUTH_METHOD ||
          typeof token !== "string" ||
          !Crypto.timingSafeEqual(digest(token), expected)
        ) {
          socket.destroy();
          return;
        }
        clearTimeout(authTimer);
        authenticated.add(socket);
        write(socket, { jsonrpc: "2.0", id: request.id, result: {} });
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      clearTimeout(authTimer);
      sockets.delete(socket);
      authenticated.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
  if (directory) FS.chmodSync(path, 0o600);

  return {
    path,
    notify: (method, params) => {
      for (const socket of authenticated) write(socket, { jsonrpc: "2.0", method, params });
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (directory) FS.rmSync(directory, { recursive: true, force: true });
    },
  };
}
