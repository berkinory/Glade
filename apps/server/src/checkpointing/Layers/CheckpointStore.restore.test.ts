import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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

it("restores changed files without rewriting unchanged sources or the user's index", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "glade-checkpoint-restore-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  const runtime = ManagedRuntime.make(
    CheckpointStoreLive.pipe(
      Layer.provide(
        GitCoreLive.pipe(
          Layer.provide(ServerConfig.layerTest(cwd, { prefix: "glade-restore-test-" })),
        ),
      ),
      Layer.provide(NodeServices.layer),
    ),
  );
  try {
    git("init", "-q");
    git("config", "user.name", "Checkpoint Test");
    git("config", "user.email", "checkpoint@example.invalid");
    writeFileSync(join(cwd, "unchanged.ts"), "original source\n");
    writeFileSync(join(cwd, "changed.ts"), "before\n");
    writeFileSync(join(cwd, "deleted.ts"), "restore me\n");
    writeFileSync(join(cwd, ".gitignore"), "ignored.log\n");
    git("add", ".");
    git("commit", "-qm", "baseline");
    const checkpointRef = CheckpointRef.makeUnsafe("refs/glade-checkpoints/restore/0");
    git("update-ref", checkpointRef, "HEAD");
    writeFileSync(join(cwd, "changed.ts"), "staged change\n");
    git("add", "changed.ts");
    writeFileSync(join(cwd, "changed.ts"), "unstaged change\n");
    rmSync(join(cwd, "deleted.ts"));
    writeFileSync(join(cwd, "new.ts"), "remove me\n");
    writeFileSync(join(cwd, "ignored.log"), "keep me\n");
    const stamp = new Date("2020-01-02T03:04:05Z");
    utimesSync(join(cwd, "unchanged.ts"), stamp, stamp);
    const stagedBefore = git("diff", "--cached", "--binary");
    const restore = () =>
      runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CheckpointStore;
          return yield* store.restoreCheckpoint({ cwd, checkpointRef });
        }),
      );
    expect(await restore()).toBe(true);
    expect(readFileSync(join(cwd, "changed.ts"), "utf8")).toBe("before\n");
    expect(readFileSync(join(cwd, "deleted.ts"), "utf8")).toBe("restore me\n");
    expect(existsSync(join(cwd, "new.ts"))).toBe(false);
    expect(readFileSync(join(cwd, "ignored.log"), "utf8")).toBe("keep me\n");
    expect(statSync(join(cwd, "unchanged.ts")).mtimeMs).toBe(stamp.getTime());
    expect(git("diff", "--cached", "--binary")).toBe(stagedBefore);
    const restoredStamp = statSync(join(cwd, "changed.ts")).mtimeMs;
    expect(await restore()).toBe(true);
    expect(statSync(join(cwd, "changed.ts")).mtimeMs).toBe(restoredStamp);
  } finally {
    await runtime.dispose();
    rmSync(cwd, { recursive: true, force: true });
  }
});
