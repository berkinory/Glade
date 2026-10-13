import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";

import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type InitializeResponse,
  type RequestPermissionOutcome,
  type RequestPermissionRequest,
  type SessionNotification,
} from "@agentclientprotocol/sdk";

import { createLogger } from "../../diagnostics/logger.ts";
import { teardownChildProcessTree } from "../../platform/supervisedProcessTeardown.ts";
import { JsonRpcStdioFramer } from "../../platform/transport/jsonRpcStdio.ts";
import type { AcpProviderProfile } from "./acpProviderProfile.ts";

const log = createLogger("acp-connection");
const STDERR_LINE_BYTES = 64 * 1024;
const STDERR_TAIL_LINES = 12;

interface AcpSessionHandlers {
  readonly onUpdate: (notification: SessionNotification) => void;
  readonly onPermission: (request: RequestPermissionRequest) => Promise<RequestPermissionOutcome>;
}

export interface AcpConnection {
  readonly agent: ClientSideConnection;
  readonly initialize: InitializeResponse;
  // Routes updates and permission requests for one ACP session to its owner.
  readonly attachSession: (sessionId: string, handlers: AcpSessionHandlers) => () => void;
  readonly onExit: (listener: (error: Error) => void) => () => void;
  readonly close: () => Promise<void>;
}

function errorFrom(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

// One agent process speaking ACP over stdio. It can host several ACP sessions, each routed by its
// session id. Closing proves the whole process tree exited.
export async function openAcpConnection(input: {
  readonly child: ChildProcessWithoutNullStreams;
  readonly profile: AcpProviderProfile;
  readonly teardownProcessTree?: Parameters<typeof teardownChildProcessTree>[1];
}): Promise<AcpConnection> {
  const { child, profile } = input;
  const sessions = new Map<string, AcpSessionHandlers>();
  // Some agents announce a session's commands before answering `session/new`, while no
  // owner is attached; the latest announcement waits for it. Other early updates are dropped, which
  // also discards the history `session/load` replays.
  const earlyCommands = new Map<string, SessionNotification>();
  const exitListeners = new Set<(error: Error) => void>();
  let exited: Error | undefined;
  let closing: Promise<void> | undefined;

  // Agents log freely on stderr. It is never session output; the last lines explain an exit.
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

  const agent = new ClientSideConnection(
    () => ({
      sessionUpdate: (notification) => {
        const handlers = sessions.get(notification.sessionId);
        if (handlers) handlers.onUpdate(notification);
        else if (notification.update.sessionUpdate === "available_commands_update") {
          earlyCommands.set(notification.sessionId, notification);
        }
      },
      requestPermission: async (request) => ({
        // An unknown session cannot show the request; cancelling lets the agent continue.
        outcome: (await sessions.get(request.sessionId)?.onPermission(request)) ?? {
          outcome: "cancelled",
        },
      }),
      ...(profile.extensions?.request
        ? {
            extMethod: async (method: string, params: Record<string, unknown>) => {
              const result = await profile.extensions?.request?.(method, params);
              if (result === undefined) throw new Error(`${method} is not supported by Glade.`);
              return result;
            },
          }
        : {}),
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream),
  );

  const exit = (error: Error) => {
    if (exited) return;
    exited = error;
    for (const listener of exitListeners) listener(error);
  };
  child.once("error", (cause) => exit(errorFrom(cause)));
  child.once("exit", (code, signal) => {
    if (!closing && stderrTail.length > 0) {
      log.warn("acp agent exited", {
        provider: profile.provider,
        code,
        signal,
        stderr: stderrTail,
      });
    }
    exit(new Error(`${profile.displayName} exited (code=${code}, signal=${signal}).`));
  });

  const close = () => {
    closing ??= (async () => {
      exit(new Error(`${profile.displayName} connection closed.`));
      await teardownChildProcessTree(child, input.teardownProcessTree);
    })();
    return closing;
  };

  try {
    const initialize = await agent.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        ...(profile.clientMeta ? { _meta: { ...profile.clientMeta } } : {}),
      },
      clientInfo: { name: "glade", version: "1" },
    });
    const authMethodId = profile.authMethodId;
    if (authMethodId && initialize.authMethods?.some((method) => method.id === authMethodId)) {
      await agent.authenticate({ methodId: authMethodId });
    }
    return {
      agent,
      initialize,
      attachSession: (sessionId, handlers) => {
        sessions.set(sessionId, handlers);
        const early = earlyCommands.get(sessionId);
        earlyCommands.delete(sessionId);
        if (early) handlers.onUpdate(early);
        return () => {
          if (sessions.get(sessionId) === handlers) sessions.delete(sessionId);
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
