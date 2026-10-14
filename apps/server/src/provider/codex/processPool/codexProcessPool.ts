import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { resolveBaseCodexHomePath } from "../codexHomePaths";
import { CodexPooledProcess, type CodexProcessLease } from "./codexPooledProcess";

interface ProcessInput {
  readonly binaryPath: string;
  readonly env: NodeJS.ProcessEnv;
  readonly argv: readonly string[];
  readonly skillsRoots?: readonly string[];
}
export class CodexProcessPool {
  private readonly processes = new Map<string, Set<CodexPooledProcess>>();
  private readonly failures = new Map<string, { count: number; retryAt: number }>();
  constructor(
    private readonly options: {
      readonly spawn: (
        input: ProcessInput & { readonly cwd: string },
      ) => ChildProcessWithoutNullStreams;
      readonly teardown: (
        child: ChildProcessWithoutNullStreams,
      ) => Promise<{ readonly capturedBeforeRootExit?: boolean }>;
    },
  ) {}

  assertThreadAvailable(threadId: string): void {
    for (const entries of this.processes.values()) {
      if ([...entries].some((entry) => entry.ownsThread(threadId)))
        throw new Error("Native Codex thread is already attached to another session");
    }
  }

  async acquire(
    input: ProcessInput,
    role: "chat" | "discovery" | "auxiliary" = "chat",
    signal?: AbortSignal,
  ): Promise<CodexProcessLease> {
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          role,
          input.binaryPath,
          resolveBaseCodexHomePath(input.env),
          input.argv,
          input.skillsRoots?.toSorted() ?? [],
          Object.entries(input.env).toSorted(([left], [right]) => left.localeCompare(right)),
        ]),
      )
      .digest("hex");
    for (;;) {
      signal?.throwIfAborted();
      const existing = [...(this.processes.get(key) ?? [])].find((entry) => entry.accepting);
      if (existing) return existing.acquire(role !== "chat");
      const closing = [...(this.processes.get(key) ?? [])].find(
        (entry) => entry.isClosing || entry.isFailed,
      );
      if (closing) {
        await closing.available();
        continue;
      }
      const remaining = (this.failures.get(key)?.retryAt ?? 0) - Date.now();
      if (remaining <= 0) break;
      await delay(remaining, undefined, signal ? { signal } : undefined);
    }
    const process = new CodexPooledProcess(
      // One app-server serves threads from many workspaces, each opened with its own cwd. Its
      // process cwd must outlive all of them: once a workspace it was spawned in is deleted, Codex
      // fails every later config load ("No such file or directory") for every thread it serves.
      this.options.spawn({ ...input, cwd: homedir() }),
      this.options.teardown,
      (lifetimeMs) => {
        const count = lifetimeMs >= 60_000 ? 1 : (this.failures.get(key)?.count ?? 0) + 1;
        if (this.failures.size >= 512 && !this.failures.has(key))
          this.failures.delete(this.failures.keys().next().value!);
        this.failures.set(key, {
          count,
          retryAt: Date.now() + Math.min(30_000, 250 * 2 ** Math.min(7, count - 1)),
        });
      },
      () => {
        const entries = this.processes.get(key);
        entries?.delete(process);
        if (entries?.size === 0) this.processes.delete(key);
      },
      () => this.acquire(input, "auxiliary"),
      (threadId) => this.assertThreadAvailable(threadId),
    );
    let entries = this.processes.get(key);
    if (!entries) this.processes.set(key, (entries = new Set()));
    entries.add(process);
    return process.acquire(role !== "chat");
  }
}
