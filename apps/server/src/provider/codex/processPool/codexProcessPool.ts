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
  private readonly processes = new Map<string, CodexPooledProcess>();
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

  async acquire(
    input: ProcessInput,
    discovery = false,
    signal?: AbortSignal,
  ): Promise<CodexProcessLease> {
    const key = createHash("sha256")
      .update(
        JSON.stringify([
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
      const existing = this.processes.get(key);
      if (existing) {
        await existing.available();
        signal?.throwIfAborted();
        if (existing.isClosing) continue;
        return existing.acquire(discovery);
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
        if (this.processes.get(key) === process) this.processes.delete(key);
      },
    );
    this.processes.set(key, process);
    return process.acquire(discovery);
  }
}
