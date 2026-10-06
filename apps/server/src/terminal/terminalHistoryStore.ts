import fs from "node:fs";
import path from "node:path";

import { DEFAULT_TERMINAL_ID } from "@glade/contracts/terminal/terminal";
import { Encoding } from "effect";

import { createLogger } from "../diagnostics/logger";
import {
  PRIVATE_FILE_MODE,
  repairPrivateFile,
} from "../platform/filesystem/privatePathPermissions";
import { capHistoryByLimits, type HistoryLimits } from "./terminalHistory";

// Streaming output rewrites the whole capped history file, so writes wait for output to go idle.
// The max wait bounds how much a hard kill (SIGKILL, crash) can lose while output never pauses.
const PERSIST_IDLE_MS = 1_000;
const PERSIST_MAX_WAIT_MS = 5_000;

interface PendingWrite {
  threadId: string;
  terminalId: string;
  materialize: () => string;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
}

function legacySafeThreadId(threadId: string): string {
  return threadId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function toSafeThreadId(threadId: string): string {
  return `terminal_${Encoding.encodeBase64Url(threadId)}`;
}

function toKey(threadId: string, terminalId: string): string {
  return `${threadId}\u0000${terminalId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TerminalHistoryStore {
  private readonly pending = new Map<string, PendingWrite>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly persistedByKey = new Map<string, string>();
  private tempCounter = 0;
  private readonly logger = createLogger("terminal");

  constructor(
    private readonly logsDir: string,
    private readonly limits: HistoryLimits,
    private readonly sanitize: (raw: string) => string,
  ) {}

  async read(threadId: string, terminalId: string): Promise<string> {
    await this.flush(threadId, terminalId);
    const key = toKey(threadId, terminalId);
    const nextPath = this.historyPath(threadId, terminalId);
    try {
      const raw = await fs.promises.readFile(nextPath, "utf8");
      await repairPrivateFile(nextPath);
      const capped = capHistoryByLimits(this.sanitize(raw), this.limits);
      if (capped !== raw) {
        await fs.promises.writeFile(nextPath, capped, {
          encoding: "utf8",
          mode: PRIVATE_FILE_MODE,
        });
      }
      this.persistedByKey.set(key, capped);
      return capped;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (terminalId !== DEFAULT_TERMINAL_ID) return "";

    const legacyPath = this.legacyHistoryPath(threadId);
    try {
      const raw = await fs.promises.readFile(legacyPath, "utf8");
      const capped = capHistoryByLimits(this.sanitize(raw), this.limits);
      await fs.promises.writeFile(nextPath, capped, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
      await repairPrivateFile(nextPath);
      this.persistedByKey.set(key, capped);
      try {
        await fs.promises.rm(legacyPath, { force: true });
      } catch (cleanupError) {
        this.logger.warn("failed to remove legacy terminal history", {
          threadId,
          error: errorMessage(cleanupError),
        });
      }
      return capped;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.persistedByKey.set(key, "");
        return "";
      }
      throw error;
    }
  }

  // Coalesces output into one write after PERSIST_IDLE_MS of quiet, or PERSIST_MAX_WAIT_MS after
  // the first unsaved chunk, whichever comes first.
  schedule(threadId: string, terminalId: string, materialize: () => string): void {
    const key = toKey(threadId, terminalId);
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing.timer);
    const deadline = existing?.deadline ?? Date.now() + PERSIST_MAX_WAIT_MS;
    const delay = Math.max(0, Math.min(PERSIST_IDLE_MS, deadline - Date.now()));
    const timer = setTimeout(() => void this.writePending(key), delay);
    timer.unref?.();
    this.pending.set(key, { threadId, terminalId, materialize, deadline, timer });
  }

  write(threadId: string, terminalId: string, history: string): Promise<void> {
    this.cancelPending(toKey(threadId, terminalId));
    return this.enqueueWrite(threadId, terminalId, history);
  }

  flush(threadId: string, terminalId: string): Promise<void> {
    return this.flushKey(toKey(threadId, terminalId));
  }

  // Closed sessions flush their final history, then drop the write-dedup cache so archived
  // histories do not stay pinned in memory.
  async flushAndRelease(threadId: string, terminalId: string): Promise<void> {
    await this.flush(threadId, terminalId);
    this.persistedByKey.delete(toKey(threadId, terminalId));
  }

  async flushAll(timeoutMs: number): Promise<void> {
    const keys = new Set([...this.pending.keys(), ...this.queues.keys()]);
    const flushed = Promise.all([...keys].map((key) => this.flushKey(key))).then(() => false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    });
    const timedOut = await Promise.race([flushed, deadline]);
    clearTimeout(timer);
    if (timedOut) {
      this.logger.warn("terminal history flush timed out during shutdown", {
        pendingTerminals: this.pending.size + this.queues.size,
        timeoutMs,
      });
    }
  }

  async delete(threadId: string, terminalId: string): Promise<void> {
    this.persistedByKey.delete(toKey(threadId, terminalId));
    const deletions = [fs.promises.rm(this.historyPath(threadId, terminalId), { force: true })];
    if (terminalId === DEFAULT_TERMINAL_ID) {
      deletions.push(fs.promises.rm(this.legacyHistoryPath(threadId), { force: true }));
    }
    try {
      await Promise.all(deletions);
    } catch (error) {
      this.logger.warn("failed to delete terminal history", {
        threadId,
        terminalId,
        error: errorMessage(error),
      });
    }
  }

  async deleteAllForThread(threadId: string): Promise<void> {
    const threadPrefix = `${toSafeThreadId(threadId)}_`;
    for (const key of [...this.persistedByKey.keys()]) {
      if (key.startsWith(`${threadId}\u0000`)) this.persistedByKey.delete(key);
    }
    try {
      const entries = await fs.promises.readdir(this.logsDir, { withFileTypes: true });
      const removals = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter(
          (name) =>
            name === `${toSafeThreadId(threadId)}.log` ||
            name === `${legacySafeThreadId(threadId)}.log` ||
            name.startsWith(threadPrefix),
        )
        .map((name) => fs.promises.rm(path.join(this.logsDir, name), { force: true }));
      await Promise.all(removals);
    } catch (error) {
      this.logger.warn("failed to delete terminal histories for thread", {
        threadId,
        error: errorMessage(error),
      });
    }
  }

  private async flushKey(key: string): Promise<void> {
    while (true) {
      await this.writePending(key);
      const queued = this.queues.get(key);
      if (!queued) return;
      await queued;
    }
  }

  private cancelPending(key: string): PendingWrite | undefined {
    const entry = this.pending.get(key);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    return entry;
  }

  private writePending(key: string): Promise<void> {
    const entry = this.cancelPending(key);
    if (!entry) return Promise.resolve();
    return this.enqueueWrite(entry.threadId, entry.terminalId, entry.materialize());
  }

  private enqueueWrite(threadId: string, terminalId: string, history: string): Promise<void> {
    const key = toKey(threadId, terminalId);
    const task = async () => {
      if (this.persistedByKey.get(key) === history) return;
      const finalPath = this.historyPath(threadId, terminalId);
      const tempPath = `${finalPath}.tmp-${process.pid}-${(this.tempCounter += 1)}`;
      try {
        await fs.promises.writeFile(tempPath, history, {
          encoding: "utf8",
          mode: PRIVATE_FILE_MODE,
        });
        await fs.promises.rename(tempPath, finalPath);
        await repairPrivateFile(finalPath);
        this.persistedByKey.set(key, history);
      } catch (error) {
        await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    };
    const next = (this.queues.get(key) ?? Promise.resolve()).then(task).catch((error) => {
      this.logger.warn("failed to persist terminal history", {
        threadId,
        terminalId,
        error: errorMessage(error),
      });
    });
    this.queues.set(key, next);
    void next.then(() => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    });
    return next;
  }

  private historyPath(threadId: string, terminalId: string): string {
    const threadPart = toSafeThreadId(threadId);
    if (terminalId === DEFAULT_TERMINAL_ID) {
      return path.join(this.logsDir, `${threadPart}.log`);
    }
    return path.join(this.logsDir, `${threadPart}_${Encoding.encodeBase64Url(terminalId)}.log`);
  }

  private legacyHistoryPath(threadId: string): string {
    return path.join(this.logsDir, `${legacySafeThreadId(threadId)}.log`);
  }
}
