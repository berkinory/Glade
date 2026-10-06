import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Fiber, Layer, ManagedRuntime, Option } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckpointStoreLive } from "./CheckpointStore.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { ServerConfig } from "../../server/config.ts";
import { CheckpointRef } from "@glade/contracts/core/baseSchemas";

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition");
}

describe("CheckpointStoreLive", () => {
  let runtime: ManagedRuntime.ManagedRuntime<CheckpointStore, unknown> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("deduplicates concurrent captures for the same checkpoint ref", async () => {
    let releaseAdd: (() => void) | undefined;
    const addGate = new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === "rev-parse --git-path index") {
        return Effect.succeed({ code: 0, stdout: "/repo/.git/index\n", stderr: "" });
      }
      if (args === "rev-parse --verify HEAD") {
        return Effect.succeed({ code: 1, stdout: "", stderr: "" });
      }
      if (args === "add -A -- .") {
        return Effect.promise(() => addGate).pipe(Effect.as({ code: 0, stdout: "", stderr: "" }));
      }
      if (args === "write-tree") {
        return Effect.succeed({ code: 0, stdout: "tree-oid\n", stderr: "" });
      }
      if (args.startsWith("commit-tree ")) {
        return Effect.succeed({ code: 0, stdout: "commit-oid\n", stderr: "" });
      }
      if (args.startsWith("update-ref ")) {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        const input = {
          cwd: "/repo",
          checkpointRef: CheckpointRef.makeUnsafe("refs/glade-checkpoints/thread/message"),
        };

        const first = yield* store.captureCheckpoint(input).pipe(Effect.forkChild);
        yield* Effect.promise(() =>
          waitFor(() => execute.mock.calls.some(([call]) => call.args.join(" ") === "add -A -- .")),
        );
        const second = yield* store.captureCheckpoint(input).pipe(Effect.forkChild);
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 25)));

        expect(
          execute.mock.calls.filter(([call]) => call.args.join(" ") === "add -A -- ."),
        ).toHaveLength(1);

        releaseAdd?.();
        yield* Fiber.join(first);
        yield* Fiber.join(second);
      }),
    );
  });

  it("seeds a capture from the working index so Git can reuse its stat cache", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "glade-checkpoint-index-test-"));
    const workingIndexPath = join(tempDir, "index");
    writeFileSync(workingIndexPath, "working-index-stat-cache");
    const workingIndexTime = new Date("2020-01-02T03:04:05.000Z");
    utimesSync(workingIndexPath, workingIndexTime, workingIndexTime);
    let capturedSeed = "";
    let capturedIndexMtimeMs = 0;

    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === "rev-parse --git-path index") {
        return Effect.succeed({ code: 0, stdout: `${workingIndexPath}\n`, stderr: "" });
      }
      if (args === "update-index --really-refresh") {
        const captureIndexPath = input.env?.GIT_INDEX_FILE ?? "";
        const refreshTime = new Date("2025-01-02T03:04:05.000Z");
        utimesSync(captureIndexPath, refreshTime, refreshTime);
        return Effect.succeed({ code: 1, stdout: "", stderr: "README.md: needs update\n" });
      }
      if (args === "add -A -- .") {
        const captureIndexPath = input.env?.GIT_INDEX_FILE ?? "";
        capturedSeed = readFileSync(captureIndexPath, "utf8");
        capturedIndexMtimeMs = statSync(captureIndexPath).mtimeMs;
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      if (args === "write-tree") {
        return Effect.succeed({ code: 0, stdout: "tree-oid\n", stderr: "" });
      }
      if (args.startsWith("commit-tree ")) {
        return Effect.succeed({ code: 0, stdout: "commit-oid\n", stderr: "" });
      }
      if (args.startsWith("update-ref ")) {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CheckpointStore;
          yield* store.captureCheckpoint({
            cwd: tempDir,
            checkpointRef: CheckpointRef.makeUnsafe("refs/glade-checkpoints/thread/stat-cache"),
          });
        }),
      );

      expect(capturedSeed).toBe("working-index-stat-cache");
      expect(capturedIndexMtimeMs).toBe(workingIndexTime.getTime());
      expect(
        execute.mock.calls.some(
          ([call]) => call.args.join(" ") === "update-index --really-refresh",
        ),
      ).toBe(true);
      expect(
        execute.mock.calls.some(([call]) => call.args.join(" ") === "rev-parse --verify HEAD"),
      ).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("clears in-flight capture state when the owner is interrupted", async () => {
    let addCalls = 0;
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === "rev-parse --git-path index") {
        return Effect.succeed({ code: 0, stdout: "/repo/.git/index\n", stderr: "" });
      }
      if (args === "rev-parse --verify HEAD") {
        return Effect.succeed({ code: 1, stdout: "", stderr: "" });
      }
      if (args === "add -A -- .") {
        addCalls += 1;
        if (addCalls === 1) {
          return Effect.never;
        }
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      if (args === "write-tree") {
        return Effect.succeed({ code: 0, stdout: "tree-oid\n", stderr: "" });
      }
      if (args.startsWith("commit-tree ")) {
        return Effect.succeed({ code: 0, stdout: "commit-oid\n", stderr: "" });
      }
      if (args.startsWith("update-ref ")) {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        const input = {
          cwd: "/repo",
          checkpointRef: CheckpointRef.makeUnsafe("refs/glade-checkpoints/thread/message"),
        };

        const first = yield* store.captureCheckpoint(input).pipe(Effect.forkChild);
        yield* Effect.promise(() => waitFor(() => addCalls === 1));
        const waiter = yield* store.captureCheckpoint(input).pipe(
          Effect.map(() => "completed" as const),
          Effect.catch((error) => Effect.succeed(error._tag)),
          Effect.forkChild,
        );
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 25)));

        yield* Fiber.interrupt(first);

        const waiterResult = yield* Fiber.join(waiter);
        expect(waiterResult).toBe("CheckpointInvariantError");

        const thirdResult = yield* store
          .captureCheckpoint(input)
          .pipe(Effect.timeoutOption("100 millis"));
        expect(Option.isSome(thirdResult)).toBe(true);
        expect(addCalls).toBe(2);
      }),
    );
  });

  it("skips the capture when skipIfExists is set and the ref already exists", async () => {
    const existingRef = "refs/glade-checkpoints/thread/existing";
    const missingRef = "refs/glade-checkpoints/thread/missing";
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === `rev-parse --verify --quiet ${existingRef}^{commit}`) {
        return Effect.succeed({ code: 0, stdout: "existing-commit\n", stderr: "" });
      }
      if (args === `rev-parse --verify --quiet ${missingRef}^{commit}`) {
        return Effect.succeed({ code: 1, stdout: "", stderr: "" });
      }
      if (args === "rev-parse --git-path index") {
        return Effect.succeed({ code: 0, stdout: "/repo/.git/index\n", stderr: "" });
      }
      if (args === "rev-parse --verify HEAD") {
        return Effect.succeed({ code: 1, stdout: "", stderr: "" });
      }
      if (args === "add -A -- .") {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      if (args === "write-tree") {
        return Effect.succeed({ code: 0, stdout: "tree-oid\n", stderr: "" });
      }
      if (args.startsWith("commit-tree ")) {
        return Effect.succeed({ code: 0, stdout: "commit-oid\n", stderr: "" });
      }
      if (args.startsWith("update-ref ")) {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        const captureArgs = (args: string) =>
          execute.mock.calls.filter(([call]) => call.args.join(" ") === args);

        yield* store.captureCheckpoint({
          cwd: "/repo",
          checkpointRef: CheckpointRef.makeUnsafe(existingRef),
          skipIfExists: true,
        });
        expect(captureArgs("add -A -- .")).toHaveLength(0);

        yield* store.captureCheckpoint({
          cwd: "/repo",
          checkpointRef: CheckpointRef.makeUnsafe(missingRef),
          skipIfExists: true,
        });
        expect(captureArgs("add -A -- .")).toHaveLength(1);
        expect(captureArgs(`update-ref ${missingRef} commit-oid`)).toHaveLength(1);
      }),
    );
  });

  it("fails when a checkpoint ref cannot be deleted", async () => {
    const lockedRef = CheckpointRef.makeUnsafe("refs/glade/checkpoints/thread/turn/locked");
    const deletableRef = CheckpointRef.makeUnsafe("refs/glade/checkpoints/thread/turn/ok");
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === `update-ref -d ${lockedRef}`) {
        return Effect.succeed({ code: 1, stdout: "", stderr: "cannot lock ref\n" });
      }
      if (args === `update-ref -d ${deletableRef}`) {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        return yield* store
          .deleteCheckpointRefs({ cwd: "/repo", checkpointRefs: [deletableRef, lockedRef] })
          .pipe(
            Effect.map(() => "success" as const),
            Effect.catch((error) => Effect.succeed(error.message)),
          );
      }),
    );

    // Every ref is still attempted; one loser must not abandon the batch.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result).not.toBe("success");
    expect(result).toContain(lockedRef);
    expect(result).toContain("cannot lock ref");
    expect(result).not.toContain(deletableRef);
  });

  it("tolerates deleting checkpoint refs that are already absent", async () => {
    // `git update-ref -d` exits 0 for a ref that does not exist, so the exit-code check must not turn
    // best-effort cleanup into a hard failure.
    const missingRef = CheckpointRef.makeUnsafe("refs/glade/checkpoints/thread/turn/gone");
    const execute = vi.fn<GitCoreShape["execute"]>(() =>
      Effect.succeed({ code: 0, stdout: "", stderr: "" }),
    );
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        return yield* store
          .deleteCheckpointRefs({ cwd: "/repo", checkpointRefs: [missingRef] })
          .pipe(
            Effect.map(() => "success" as const),
            Effect.catch((error) => Effect.succeed(error.message)),
          );
      }),
    );

    expect(result).toBe("success");
  });
});

it("summarizes added, deleted, renamed and binary files", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "glade-checkpoint-summary-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  const summaryRuntime = ManagedRuntime.make(
    CheckpointStoreLive.pipe(
      Layer.provide(
        GitCoreLive.pipe(
          Layer.provide(ServerConfig.layerTest(cwd, { prefix: "glade-checkpoint-summary-test-" })),
        ),
      ),
      Layer.provide(NodeServices.layer),
    ),
  );
  const lines = (count: number) =>
    Array.from({ length: count }, (_, index) => `line ${index}\n`).join("");
  try {
    git("init", "-q");
    git("config", "user.name", "Checkpoint Test");
    git("config", "user.email", "checkpoint@example.invalid");
    writeFileSync(join(cwd, "modified.ts"), "a\nb\nc\n");
    writeFileSync(join(cwd, "deleted.ts"), "one\ntwo\n");
    writeFileSync(join(cwd, "before rename.ts"), lines(20));
    writeFileSync(join(cwd, "image.bin"), Buffer.from([0, 1, 2, 3]));
    git("add", ".");
    git("commit", "-qm", "baseline");
    const from = CheckpointRef.makeUnsafe("refs/glade-checkpoints/summary/from");
    const to = CheckpointRef.makeUnsafe("refs/glade-checkpoints/summary/to");
    git("update-ref", from, "HEAD");
    writeFileSync(join(cwd, "modified.ts"), "a\nB\nc\nd\n");
    rmSync(join(cwd, "deleted.ts"));
    git("mv", "before rename.ts", "after\trename.ts");
    writeFileSync(join(cwd, "after\trename.ts"), `${lines(20)}extra\n`);
    writeFileSync(join(cwd, "image.bin"), Buffer.from([0, 9, 8, 7]));
    writeFileSync(join(cwd, "added.ts"), "new\n");
    git("add", "-A");
    git("commit", "-qm", "turn");
    git("update-ref", to, "HEAD");

    const files = await summaryRuntime.runPromise(
      Effect.flatMap(CheckpointStore.asEffect(), (store) =>
        store.summarizeCheckpointDiff({ cwd, fromCheckpointRef: from, toCheckpointRef: to }),
      ),
    );

    expect(files).toEqual([
      { path: "added.ts", kind: "added", additions: 1, deletions: 0 },
      { path: "after\trename.ts", kind: "renamed", additions: 1, deletions: 0 },
      { path: "deleted.ts", kind: "deleted", additions: 0, deletions: 2 },
      { path: "image.bin", kind: "modified", additions: 0, deletions: 0 },
      { path: "modified.ts", kind: "modified", additions: 2, deletions: 1 },
    ]);
  } finally {
    await summaryRuntime.dispose();
    rmSync(cwd, { recursive: true, force: true });
  }
});
