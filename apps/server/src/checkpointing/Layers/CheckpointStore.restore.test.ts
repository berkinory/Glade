import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { CheckpointRef } from "@glade/contracts/core/baseSchemas";
import { Effect, Layer, ManagedRuntime } from "effect";
import { expect, it } from "vitest";

import { ServerConfig } from "../../server/config.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import { CheckpointStoreLive } from "./CheckpointStore.ts";

it("scopes restore to removed turns and requires fresh consent for later edits", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "glade-scoped-restore-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  const runtime = ManagedRuntime.make(
    CheckpointStoreLive.pipe(
      Layer.provide(
        GitCoreLive.pipe(
          Layer.provide(ServerConfig.layerTest(cwd, { prefix: "glade-scoped-restore-test-" })),
        ),
      ),
      Layer.provide(NodeServices.layer),
    ),
  );
  try {
    git("init", "-q");
    git("config", "user.name", "Checkpoint Test");
    git("config", "user.email", "checkpoint@example.invalid");
    writeFileSync(join(cwd, "agent.ts"), "before\n");
    writeFileSync(join(cwd, "unrelated.ts"), "before\n");
    writeFileSync(join(cwd, "file[1].ts"), "literal before\n");
    writeFileSync(join(cwd, "file1.ts"), "glob match must survive\n");
    git("add", ".");
    git("commit", "-qm", "baseline");
    const before = CheckpointRef.makeUnsafe("refs/glade-checkpoints/scoped/before");
    const after = CheckpointRef.makeUnsafe("refs/glade-checkpoints/scoped/after");
    git("update-ref", before, "HEAD");
    writeFileSync(join(cwd, "agent.ts"), "agent turn\n");
    writeFileSync(join(cwd, "file[1].ts"), "literal agent turn\n");
    const store = await runtime.runPromise(
      Effect.gen(function* () {
        return yield* CheckpointStore;
      }),
    );
    await runtime.runPromise(store.captureCheckpoint({ cwd, checkpointRef: after }));
    const input = { cwd, turns: [{ beforeCheckpointRef: before, afterCheckpointRef: after }] };
    writeFileSync(join(cwd, "unrelated.ts"), "another thread\n");
    git("add", "unrelated.ts");
    const index = git("diff", "--cached", "--binary");
    const stamp = new Date("2020-01-02T03:04:05Z");
    utimesSync(join(cwd, "unrelated.ts"), stamp, stamp);
    const first = await runtime.runPromise(store.previewScopedRestore(input));
    expect(first.files).toEqual([
      { path: "agent.ts", conflict: false },
      { path: "file[1].ts", conflict: false },
    ]);
    writeFileSync(join(cwd, "agent.ts"), "later user edit\n");
    await expect(
      runtime.runPromise(
        store.restoreScopedCheckpoint({
          ...input,
          confirmation: { fingerprint: first.fingerprint, overwritePaths: [] },
        }),
      ),
    ).rejects.toThrow("outdated");
    const preview = await runtime.runPromise(store.previewScopedRestore(input));
    expect(preview.files.find((file) => file.path === "agent.ts")?.conflict).toBe(true);
    await expect(
      runtime.runPromise(
        store.restoreScopedCheckpoint({
          ...input,
          confirmation: { fingerprint: preview.fingerprint, overwritePaths: [] },
        }),
      ),
    ).rejects.toThrow("explicit permission");
    expect(readFileSync(join(cwd, "agent.ts"), "utf8")).toBe("later user edit\n");
    await runtime.runPromise(
      store.restoreScopedCheckpoint({
        ...input,
        confirmation: { fingerprint: preview.fingerprint, overwritePaths: ["agent.ts"] },
      }),
    );
    expect(readFileSync(join(cwd, "agent.ts"), "utf8")).toBe("before\n");
    expect(readFileSync(join(cwd, "file[1].ts"), "utf8")).toBe("literal before\n");
    expect(readFileSync(join(cwd, "file1.ts"), "utf8")).toBe("glob match must survive\n");
    expect(readFileSync(join(cwd, "unrelated.ts"), "utf8")).toBe("another thread\n");
    expect(statSync(join(cwd, "unrelated.ts")).mtimeMs).toBe(stamp.getTime());
    expect(git("diff", "--cached", "--binary")).toBe(index);
  } finally {
    await runtime.dispose();
    rmSync(cwd, { recursive: true, force: true });
  }
});
