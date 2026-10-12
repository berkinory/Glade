import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import * as os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ServerConfig } from "../../server/config";
import { TerminalManager } from "../Services/Manager";
import { PtyAdapter, type PtyProcess } from "../Services/PTY";
import { TerminalManagerLive } from "./Manager";

const children: ChildProcess[] = [];
const baseDirs: string[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const dir of baseDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface FakePty {
  process: PtyProcess;
  written: string[];
  emit: (data: string) => void;
}

function ptyRunning(script: string): FakePty {
  const child = spawn("sh", ["-c", script], { stdio: "pipe" });
  children.push(child);
  const written: string[] = [];
  const dataListeners = new Set<(data: string) => void>();
  return {
    written,
    emit: (data) => {
      for (const listener of dataListeners) listener(data);
    },
    process: {
      pid: child.pid!,
      write: (data) => written.push(data),
      resize: () => undefined,
      kill: () => child.kill("SIGKILL"),
      pause: () => undefined,
      resume: () => undefined,
      onData: (listener) => {
        dataListeners.add(listener);
        return () => dataListeners.delete(listener);
      },
      onExit: () => () => undefined,
    },
  };
}

function terminalLayer(pty: FakePty, baseDir: string | { prefix: string }) {
  return TerminalManagerLive.pipe(
    Layer.provide(Layer.succeed(PtyAdapter, { spawn: () => Effect.succeed(pty.process) })),
    Layer.provide(ServerConfig.layerTest(os.tmpdir(), baseDir)),
    Layer.provide(NodeServices.layer),
  );
}

const session = { threadId: "thread", terminalId: "term", cwd: os.tmpdir() };

async function writeOnlyIfIdle(script: string): Promise<{ written: string[]; failed: boolean }> {
  const pty = ptyRunning(script);
  const exit = await Effect.gen(function* () {
    const manager = yield* TerminalManager;
    yield* manager.open(session);
    // Let the shell fork its command before the idle check runs.
    yield* Effect.sleep(200);
    return yield* Effect.exit(manager.write({ ...session, data: "cd /\r", onlyIfIdle: true }));
  }).pipe(
    Effect.provide(terminalLayer(pty, { prefix: "glade-terminal-" })),
    Effect.scoped,
    Effect.runPromise,
  );
  return { written: pty.written, failed: exit._tag === "Failure" };
}

describe.skipIf(process.platform === "win32")("terminal automatic input", () => {
  it.each([
    { shell: "idle", script: "read line", delivered: true },
    { shell: "running a command", script: "sleep 30; :", delivered: false },
  ])("only reaches a verified idle shell ($shell)", async ({ script, delivered }) => {
    const result = await writeOnlyIfIdle(script);
    expect(result.failed).toBe(!delivered);
    expect(result.written).toEqual(delivered ? ["cd /\r"] : []);
  });
});

describe.skipIf(process.platform === "win32")("terminal history persistence", () => {
  it("terminal output written just before shutdown is restored on reopen", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "glade-terminal-history-"));
    baseDirs.push(baseDir);

    const first = ptyRunning("read line");
    await Effect.gen(function* () {
      const manager = yield* TerminalManager;
      yield* manager.open(session);
      first.emit("last line before quit\r\n");
    }).pipe(Effect.provide(terminalLayer(first, baseDir)), Effect.scoped, Effect.runPromise);

    const second = ptyRunning("read line");
    const reopened = await Effect.gen(function* () {
      const manager = yield* TerminalManager;
      return yield* manager.open(session);
    }).pipe(Effect.provide(terminalLayer(second, baseDir)), Effect.scoped, Effect.runPromise);

    expect(reopened.history).toContain("last line before quit");
  });

  it("keeps plain text and control sequences split across output batches", async () => {
    const cases = [
      {
        head: "plain \u001b[3",
        tail: "1mred\u001b[0m end",
        history: "plain \u001b[31mred\u001b[0m end",
      },
      { head: "a\u001b[2", tail: "Jb", history: "ab" },
      { head: "t\u001b]0;ti", tail: "tle\u0007y", history: "t\u001b]0;title\u0007y" },
      { head: "q\u001b", tail: "7r", history: "qr" },
      { head: "c1 \u009b2", tail: "Jcsi", history: "c1 csi" },
    ];
    // A full output batch is sanitized on its own, so each head's trailing partial sequence has to
    // carry into the batch that reopening flushes.
    const padding = "x".repeat(131_072);
    const pty = ptyRunning("read line");
    const histories = await Effect.gen(function* () {
      const manager = yield* TerminalManager;
      yield* manager.open(session);
      const histories: string[] = [];
      for (const { head, tail } of cases) {
        pty.emit(`${padding}${head}`);
        pty.emit(tail);
        const { history } = yield* manager.open(session);
        histories.push(history.slice(history.lastIndexOf(padding) + padding.length));
      }
      return histories;
    }).pipe(
      Effect.provide(terminalLayer(pty, { prefix: "glade-terminal-" })),
      Effect.scoped,
      Effect.runPromise,
    );

    expect(histories).toEqual(cases.map(({ history }) => history));
  });
});
