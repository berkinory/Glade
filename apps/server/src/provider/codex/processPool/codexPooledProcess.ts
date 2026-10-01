import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { createLogger } from "../../../diagnostics/logger";
import { JsonRpcStdioFramer } from "../../../platform/transport/jsonRpcStdio";

import {
  CodexAppServerTransportError,
  CodexJsonlFramer,
  CodexJsonlWriter,
} from "../codexAppServerTransport";
import { codexMessageRoute } from "./codexProcessRouting";

const log = createLogger("codex-process");

interface ProcessListener {
  readonly line: (line: string) => void;
  readonly failure: (error: Error) => void;
  readonly exit: (code: number | null, signal: NodeJS.Signals | null) => void;
}
interface ExitProof {
  readonly capturedBeforeRootExit?: boolean;
}
export interface CodexProcessLease {
  readonly child: ChildProcessWithoutNullStreams;
  readonly writer: { write: (message: unknown) => Promise<void>; close: (error?: Error) => void };
  readonly initialize: (run: () => Promise<void>) => Promise<void>;
  readonly openThread: <T>(run: () => Promise<T>) => Promise<T>;
  readonly bindThread: (threadId: string) => void;
  readonly allocateRequest: () => number;
  readonly finishRequest: (id: number) => void;
  readonly subscribe: (listener: ProcessListener) => () => void;
  readonly release: () => Promise<ExitProof & { readonly retained: boolean }>;
  readonly invalidate: (error: Error) => void;
}
interface LeaseState {
  readonly discovery: boolean;
  listener?: ProcessListener;
  writesClosed: boolean;
}

export class CodexPooledProcess {
  private readonly leases = new Map<symbol, LeaseState>();
  private readonly threads = new Map<string, symbol>();
  private readonly requests = new Map<number, symbol>();
  private readonly framer = new CodexJsonlFramer();
  private readonly writer: CodexJsonlWriter;
  private readonly stderrFramer = new JsonRpcStdioFramer(1024 * 1024, (error) => {
    log.warn("codex stderr line discarded", { reason: error.reason });
  });
  private nextRequest = 1;
  private initialized?: Promise<void>;
  private threadOpens: Promise<unknown> = Promise.resolve();
  private opening: symbol | undefined;
  private failure?: Error;
  private closing: Promise<ExitProof> | undefined;
  private readonly startedAt = Date.now();

  constructor(
    readonly child: ChildProcessWithoutNullStreams,
    private readonly teardown: (child: ChildProcessWithoutNullStreams) => Promise<ExitProof>,
    private readonly onFailure: (lifetimeMs: number) => void,
    private readonly onClosed: () => void,
  ) {
    this.writer = new CodexJsonlWriter(child.stdin);
    child.stdout.on("data", this.read);
    child.stdout.once("end", this.end);
    child.stderr.on("data", this.stderr);
    child.once("error", this.fail);
    child.once("exit", this.exit);
  }

  private fail = (cause: unknown): void => {
    if (this.failure || this.closing) return;
    const error = cause instanceof Error ? cause : new Error("Codex transport failed", { cause });
    this.failure = error;
    this.writer.close(error);
    this.onFailure(Date.now() - this.startedAt);
    for (const state of this.leases.values()) state.listener?.failure(error);
  };
  private read = (chunk: Buffer): void => {
    try {
      for (const line of this.framer.push(chunk)) this.route(line);
    } catch (error) {
      this.fail(error);
    }
  };
  private end = (): void => {
    try {
      this.framer.finish();
    } catch (error) {
      this.fail(error);
      return;
    }
    this.fail(
      new CodexAppServerTransportError({ reason: "read-closed", observedBytes: 0, maxBytes: 0 }),
    );
  };
  private stderr = (chunk: Buffer): void => {
    // A shared process has no stderr thread/turn routing contract. Keep diagnostics here;
    // only protocol notifications and process failures may become session events.
    for (const rawLine of this.stderrFramer.push(chunk)) {
      const line = stripVTControlCharacters(rawLine).trim();
      if (line)
        log.warn("codex app-server stderr", {
          pid: this.child.pid,
          preview: line.slice(0, 1000),
          length: line.length,
        });
    }
  };
  private exit = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (this.closing) return;
    const error = new Error(`Codex app-server exited (code=${code}, signal=${signal})`);
    if (!this.failure) {
      this.failure = error;
      this.writer.close(error);
      this.onFailure(Date.now() - this.startedAt);
    }
    for (const state of this.leases.values()) state.listener?.exit(code, signal);
  };

  private route(line: string): void {
    let route;
    try {
      route = codexMessageRoute(line);
    } catch {
      // Let the existing protocol boundary classify non-JSON diagnostic lines.
      for (const state of this.leases.values()) state.listener?.line(line);
      return;
    }
    if (route.responseId !== undefined) {
      const owner =
        typeof route.responseId === "number" ? this.requests.get(route.responseId) : undefined;
      if (owner) this.leases.get(owner)?.listener?.line(line);
      return;
    }
    if (route.threadId) {
      let owner = this.threads.get(route.threadId);
      if (!owner && route.parentThreadId) owner = this.threads.get(route.parentThreadId);
      if (!owner && route.threadStarted && !route.parentThreadId) owner = this.opening;
      if (!owner) return;
      this.threads.set(route.threadId, owner);
      for (const child of route.childThreadIds) {
        if (!this.threads.has(child)) this.threads.set(child, owner);
      }
      this.leases.get(owner)?.listener?.line(line);
      return;
    }
    if (route.request) {
      const owner =
        this.opening ??
        [...this.leases].find(([, state]) => !state.discovery)?.[0] ??
        this.leases.keys().next().value;
      if (owner) this.leases.get(owner)?.listener?.line(line);
      return;
    }
    for (const state of this.leases.values()) state.listener?.line(line);
  }

  async available(): Promise<void> {
    if (this.closing) await this.closing;
    else if (this.failure) throw this.failure;
  }
  get isClosing(): boolean {
    return this.closing !== undefined;
  }

  acquire(discovery: boolean): CodexProcessLease {
    if (this.failure || this.closing) throw this.failure ?? new Error("Codex process is closing");
    const id = Symbol();
    const state: LeaseState = { discovery, writesClosed: false };
    this.leases.set(id, state);
    let released = false;
    const release = async () => {
      if (!released) {
        released = true;
        state.writesClosed = true;
        this.leases.delete(id);
        for (const [thread, owner] of this.threads) if (owner === id) this.threads.delete(thread);
        for (const [request, owner] of this.requests)
          if (owner === id) this.requests.delete(request);
      }
      if (this.leases.size > 0) return { retained: true };
      if (!this.closing) {
        this.writer.close(new Error("Last Codex session stopped"));
        this.closing = this.teardown(this.child)
          .then((proof) => {
            this.child.stdout.off("data", this.read);
            this.child.stdout.off("end", this.end);
            this.child.stderr.off("data", this.stderr);
            this.child.off("error", this.fail);
            this.child.off("exit", this.exit);
            this.framer.close();
            this.stderrFramer.close();
            this.onClosed();
            return proof;
          })
          .catch((error: unknown) => {
            this.closing = undefined;
            this.failure =
              error instanceof Error
                ? error
                : new Error("Codex process teardown failed", { cause: error });
            throw error;
          });
      }
      return { ...(await this.closing), retained: false };
    };
    return {
      child: this.child,
      writer: {
        write: (message) => {
          if (state.writesClosed || released)
            return Promise.reject(new Error("Codex session is closed"));
          return this.writer.write(message).catch((error: unknown) => {
            this.fail(error);
            throw error;
          });
        },
        close: () => {
          state.writesClosed = true;
        },
      },
      initialize: (run) => {
        this.initialized ??= run().catch((error: unknown) => {
          this.fail(error);
          throw error;
        });
        return this.initialized;
      },
      openThread: (run) => {
        const opening = this.threadOpens.then(async () => {
          if (released || this.failure) throw this.failure ?? new Error("Codex session is closed");
          this.opening = id;
          try {
            return await run();
          } finally {
            this.opening = undefined;
          }
        });
        this.threadOpens = opening.catch(() => undefined);
        return opening;
      },
      bindThread: (threadId) => {
        const owner = this.threads.get(threadId);
        if (owner && owner !== id)
          throw new Error("Native Codex thread is already attached to another session");
        this.threads.set(threadId, id);
      },
      allocateRequest: () => {
        const request = this.nextRequest++;
        this.requests.set(request, id);
        return request;
      },
      finishRequest: (request) => {
        this.requests.delete(request);
      },
      subscribe: (listener) => {
        state.listener = listener;
        if (this.failure) listener.failure(this.failure);
        return () => {
          delete state.listener;
        };
      },
      release,
      invalidate: this.fail,
    };
  }
}
