import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

import type { Schema } from "effect";

import { createLogger } from "../../diagnostics/logger.ts";
import { teardownChildProcessTree } from "../../platform/supervisedProcessTeardown.ts";
import {
  JsonRpcStdioFramer,
  JsonRpcStdioRequestRegistry,
  JsonRpcStdioWriter,
  type JsonRpcId,
} from "../../platform/transport/jsonRpcStdio.ts";
import { decodeMsp, MspInitializeResult } from "./mspProtocol.ts";

const log = createLogger("msp-connection");
const STDERR_LINE_BYTES = 64 * 1024;
const STDERR_TAIL_LINES = 12;
// Loading a long stored session or reading a remote model catalog can take several seconds.
const REQUEST_TIMEOUT_MS = 60_000;
// Server-initiated requests whose answer is only a presentation receipt; the decision travels later
// as its own command.
const RECEIPT_REQUESTS = new Set(["approval/request", "userInput/request"]);

// A JSON-RPC error the host returned; `kind` is MSP's stable error name (for example
// `sessionNotFound`).
export class MspRequestError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | undefined,
    readonly kind: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "MspRequestError";
  }
}

// Receives every notification and server request addressed to one MSP session.
type MspSessionListener = (method: string, params: unknown) => void;

export interface MspConnection {
  readonly initialize: MspInitializeResult;
  readonly request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  readonly attachSession: (sessionId: string, listener: MspSessionListener) => () => void;
  readonly onExit: (listener: (error: Error) => void) => () => void;
  readonly close: () => Promise<void>;
}

// A request whose result must match `schema`; a malformed answer is a protocol failure.
export async function callMsp<S extends Schema.Top & { readonly DecodingServices: never }>(
  connection: Pick<MspConnection, "request">,
  method: string,
  params: Record<string, unknown>,
  schema: S,
): Promise<S["Type"]> {
  const decoded = decodeMsp(schema, await connection.request(method, params));
  if (decoded === undefined) throw new Error(`${method} returned an unexpected result.`);
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorFrom(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

// One `muse serve` host speaking MSP over stdio. It can carry several sessions, each routed by its
// session id. Closing proves the whole process tree exited.
export async function openMspConnection(input: {
  readonly child: ChildProcessWithoutNullStreams;
  // Experimental methods Glade relies on: account state and permission profiles.
  readonly experimentalApi: boolean;
  readonly requestedCapabilities: ReadonlyArray<string>;
  readonly teardownProcessTree?: Parameters<typeof teardownChildProcessTree>[1];
}): Promise<MspConnection> {
  const { child } = input;
  const sessions = new Map<string, MspSessionListener>();
  const exitListeners = new Set<(error: Error) => void>();
  const writer = new JsonRpcStdioWriter(child.stdin);
  const registry = new JsonRpcStdioRequestRegistry({
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    responseError: ({ method, error }) => {
      const data = isRecord(error.data) ? error.data : undefined;
      return new MspRequestError(
        method,
        error.code,
        typeof data?.kind === "string" ? data.kind : undefined,
        `${method} failed: ${error.message ?? "the Muse host reported an error"}`,
      );
    },
  });
  let nextId = 1;
  let exited: Error | undefined;
  let closing: Promise<void> | undefined;

  const send = (message: Record<string, unknown>) => writer.write({ jsonrpc: "2.0", ...message });

  // The host logs on stderr. It is never session output; the last lines explain an exit.
  const stderrTail: string[] = [];
  const stderrFramer = new JsonRpcStdioFramer(STDERR_LINE_BYTES, () => undefined);
  child.stderr.on("data", (chunk: Buffer) => {
    for (const raw of stderrFramer.push(chunk)) {
      const line = stripVTControlCharacters(raw).trim();
      if (!line) continue;
      stderrTail.push(line.slice(0, 500));
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
    }
  });

  const dispatch = (frame: string) => {
    let message: unknown;
    try {
      message = JSON.parse(frame);
    } catch {
      log.warn("msp host wrote a non-JSON frame", { length: frame.length });
      return;
    }
    if (!isRecord(message)) return;
    const id = message.id as JsonRpcId | undefined;
    const method = typeof message.method === "string" ? message.method : undefined;
    if (method === undefined) {
      if (id !== undefined) {
        registry.handleResponse({
          id,
          result: message.result,
          ...(isRecord(message.error) ? { error: message.error } : {}),
        });
      }
      return;
    }
    const params = message.params;
    const sessionId =
      isRecord(params) && typeof params.sessionId === "string" ? params.sessionId : "";
    if (id !== undefined) {
      if (!RECEIPT_REQUESTS.has(method)) {
        void send({ id, error: { code: -32601, message: `${method} is not supported by Glade.` } });
        return;
      }
      void send({ id, result: {} });
    }
    sessions.get(sessionId)?.(method, params);
  };

  const framer = new JsonRpcStdioFramer(undefined, (error) =>
    log.warn("msp host frame rejected", { reason: error.reason }),
  );
  child.stdout.on("data", (chunk: Buffer) => {
    for (const frame of framer.push(chunk)) dispatch(frame);
  });

  const exit = (error: Error) => {
    if (exited) return;
    exited = error;
    registry.rejectAll(error);
    writer.close(error);
    for (const listener of exitListeners) listener(error);
  };
  child.once("error", (cause) => exit(errorFrom(cause)));
  child.once("exit", (code, signal) => {
    if (!closing && stderrTail.length > 0) {
      log.warn("muse host exited", { code, signal, stderr: stderrTail });
    }
    exit(new Error(`Muse Code exited (code=${code}, signal=${signal}).`));
  });

  const request = (method: string, params: Record<string, unknown>) =>
    exited
      ? Promise.reject(exited)
      : registry.requestWithId(nextId++, method, params, (message) =>
          send(message as Record<string, unknown>),
        );

  const close = () => {
    closing ??= (async () => {
      exit(new Error("Muse Code connection closed."));
      await teardownChildProcessTree(child, input.teardownProcessTree);
    })();
    return closing;
  };

  try {
    const initialize = decodeMsp(
      MspInitializeResult,
      await request("initialize", {
        clientInfo: { name: "glade", title: "Glade", version: "1" },
        capabilities: {
          experimentalApi: input.experimentalApi,
          requestedCapabilities: [...input.requestedCapabilities],
        },
      }),
    );
    if (initialize?.schema.version !== 1) {
      throw new Error("Muse Code answered with an unsupported protocol version.");
    }
    await send({ method: "initialized" });
    return {
      initialize,
      request,
      attachSession: (sessionId, listener) => {
        sessions.set(sessionId, listener);
        return () => {
          if (sessions.get(sessionId) === listener) sessions.delete(sessionId);
        };
      },
      onExit: (listener) => {
        if (exited) {
          listener(exited);
          return () => undefined;
        }
        exitListeners.add(listener);
        return () => exitListeners.delete(listener);
      },
      close,
    };
  } catch (cause) {
    await close().catch(() => undefined);
    throw errorFrom(cause);
  }
}
