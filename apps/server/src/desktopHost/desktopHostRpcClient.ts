import { DESKTOP_HOST_AUTH_METHOD } from "@glade/contracts/desktopHost/desktopHostRpc";
import { encodeFrame, FrameDecoder } from "@glade/shared/desktopHost/frameCodec";
import * as Net from "node:net";

const CONNECT_TIMEOUT_MS = 5_000;

export class DesktopHostRpcFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface DesktopHostConnection {
  readonly request: (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>;
  readonly closed: Promise<void>;
  readonly close: () => void;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

function responseError(error: unknown): DesktopHostRpcFailure {
  const record = (error ?? {}) as { message?: unknown; data?: { code?: unknown } };
  const code = typeof record.data?.code === "string" ? record.data.code : "protocol";
  return new DesktopHostRpcFailure(code, String(record.message ?? "Desktop host request failed."));
}

// One authenticated JSON-RPC connection to the desktop host. The auth request is the first frame;
// the desktop closes the socket on anything else.
export function connectDesktopHost(input: {
  readonly path: string;
  readonly token: string;
  readonly onNotification: (method: string, params: unknown) => void;
}): Promise<DesktopHostConnection> {
  return new Promise((resolve, reject) => {
    const socket = Net.createConnection(input.path);
    const decoder = new FrameDecoder();
    const pending = new Map<number, Pending>();
    let nextId = 1;
    let markClosed: () => void = () => undefined;
    const closed = new Promise<void>((done) => {
      markClosed = done;
    });

    const send = (method: string, params: unknown) =>
      new Promise<unknown>((resolveRequest, rejectRequest) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        socket.write(encodeFrame({ jsonrpc: "2.0", id, method, params }));
      });

    socket.on("data", (chunk: Buffer) => {
      let messages: unknown[];
      try {
        messages = decoder.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const message of messages) {
        const { id, method, params, result, error } = (message ?? {}) as Record<string, unknown>;
        if (typeof method === "string" && id === undefined) {
          input.onNotification(method, params);
          continue;
        }
        const entry = typeof id === "number" ? pending.get(id) : undefined;
        if (!entry) continue;
        pending.delete(id as number);
        if (error !== undefined) entry.reject(responseError(error));
        else entry.resolve(result);
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      for (const entry of pending.values()) {
        entry.reject(
          new DesktopHostRpcFailure("unavailable", "The desktop host connection closed."),
        );
      }
      pending.clear();
      markClosed();
      reject(new DesktopHostRpcFailure("unavailable", "The desktop host refused the connection."));
    });

    const timer = setTimeout(() => socket.destroy(), CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      send(DESKTOP_HOST_AUTH_METHOD, { token: input.token }).then(
        () => {
          clearTimeout(timer);
          resolve({
            closed,
            close: () => socket.destroy(),
            request: (method, params, signal) => {
              if (socket.destroyed) {
                return Promise.reject(
                  new DesktopHostRpcFailure("unavailable", "The desktop host connection closed."),
                );
              }
              const id = nextId;
              const request = send(method, params);
              // An abandoned request only stops waiting; the desktop finishes the operation.
              signal.addEventListener("abort", () => {
                pending
                  .get(id)
                  ?.reject(new DesktopHostRpcFailure("timeout", `${method} was cancelled.`));
                pending.delete(id);
              });
              return request;
            },
          });
        },
        (error: unknown) => {
          clearTimeout(timer);
          socket.destroy();
          reject(error);
        },
      );
    });
  });
}
