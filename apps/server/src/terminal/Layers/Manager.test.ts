import { spawn, type ChildProcess } from "node:child_process";
import * as os from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ServerConfig } from "../../server/config";
import { TerminalManager } from "../Services/Manager";
import { PtyAdapter, type PtyProcess } from "../Services/PTY";
import { TerminalManagerLive } from "./Manager";

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

function ptyRunning(script: string, written: string[]): PtyProcess {
  const child = spawn("sh", ["-c", script], { stdio: "pipe" });
  children.push(child);
  return {
    pid: child.pid!,
    write: (data) => written.push(data),
    resize: () => undefined,
    kill: () => child.kill("SIGKILL"),
    pause: () => undefined,
    resume: () => undefined,
    onData: () => () => undefined,
    onExit: () => () => undefined,
  };
}

async function writeOnlyIfIdle(script: string): Promise<{ written: string[]; failed: boolean }> {
  const written: string[] = [];
  const layer = TerminalManagerLive.pipe(
    Layer.provide(
      Layer.succeed(PtyAdapter, { spawn: () => Effect.succeed(ptyRunning(script, written)) }),
    ),
    Layer.provide(ServerConfig.layerTest(os.tmpdir(), { prefix: "glade-terminal-" })),
    Layer.provide(NodeServices.layer),
  );
  const exit = await Effect.gen(function* () {
    const manager = yield* TerminalManager;
    yield* manager.open({ threadId: "thread", terminalId: "term", cwd: os.tmpdir() });
    // Let the shell fork its command before the idle check runs.
    yield* Effect.sleep(200);
    return yield* Effect.exit(
      manager.write({ threadId: "thread", terminalId: "term", data: "cd /\r", onlyIfIdle: true }),
    );
  }).pipe(Effect.provide(layer), Effect.scoped, Effect.runPromise);
  return { written, failed: exit._tag === "Failure" };
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
