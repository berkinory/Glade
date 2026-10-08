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

type GitExecuteInput = Parameters<GitCoreShape["execute"]>[0];
type GitExecuteResult = ReturnType<GitCoreShape["execute"]>;

const gitResult = (code: number, stdout = "", stderr = "") =>
  Effect.succeed({ code, stdout, stderr });

function fakeGit(overrides: Record<string, (input: GitExecuteInput) => GitExecuteResult> = {}) {
  return vi.fn<GitCoreShape["execute"]>((input) => {
    const args = input.args.join(" ");
    const override = overrides[args];
    if (override) return override(input);
    if (args === "rev-parse --git-path index") return gitResult(0, "/repo/.git/index\n");
    if (args === "rev-parse --verify HEAD") return gitResult(1);
    if (args === "add -A -- .") return gitResult(0);
    if (args === "write-tree") return gitResult(0, "tree-oid\n");
    if (args.startsWith("commit-tree ")) return gitResult(0, "commit-oid\n");
    if (args.startsWith("update-ref ")) return gitResult(0);
    throw new Error(`Unexpected git args: ${args}`);
  });
}

async function withRealRepo(
  prefix: string,
  body: (repo: {
    readonly cwd: string;
    readonly git: (...args: string[]) => string;
    readonly runtime: ManagedRuntime.ManagedRuntime<CheckpointStore, unknown>;
  }) => Promise<void>,
): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  const runtime = ManagedRuntime.make(
    CheckpointStoreLive.pipe(
      Layer.provide(GitCoreLive.pipe(Layer.provide(ServerConfig.layerTest(cwd, { prefix })))),
      Layer.provide(NodeServices.layer),
    ),
  );
  try {
    git("init", "-q");
    git("config", "user.name", "Checkpoint Test");
    git("config", "user.email", "checkpoint@example.invalid");
    await body({ cwd, git, runtime });
  } finally {
    await runtime.dispose();
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("CheckpointStoreLive", () => {
  let runtime: ManagedRuntime.ManagedRuntime<CheckpointStore, unknown> | null = null;

  const storeWith = (execute: GitCoreShape["execute"]) => {
    runtime = ManagedRuntime.make(
      CheckpointStoreLive.pipe(
        Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
        Layer.provide(NodeServices.layer),
      ),
    );
    return runtime;
  };

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
    const execute = fakeGit({
      "add -A -- .": () =>
        Effect.promise(() => addGate).pipe(Effect.as({ code: 0, stdout: "", stderr: "" })),
    });
    const testRuntime = storeWith(execute);

    await testRuntime.runPromise(
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

    const execute = fakeGit({
      "rev-parse --git-path index": () => gitResult(0, `${workingIndexPath}\n`),
      "update-index --really-refresh": (input) => {
        const captureIndexPath = input.env?.GIT_INDEX_FILE ?? "";
        const refreshTime = new Date("2025-01-02T03:04:05.000Z");
        utimesSync(captureIndexPath, refreshTime, refreshTime);
        return gitResult(1, "", "README.md: needs update\n");
      },
      "add -A -- .": (input) => {
        const captureIndexPath = input.env?.GIT_INDEX_FILE ?? "";
        capturedSeed = readFileSync(captureIndexPath, "utf8");
        capturedIndexMtimeMs = statSync(captureIndexPath).mtimeMs;
        return gitResult(0);
      },
    });
    const testRuntime = storeWith(execute);

    try {
      await testRuntime.runPromise(
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
    const execute = fakeGit({
      "add -A -- .": () => {
        addCalls += 1;
        return addCalls === 1 ? Effect.never : gitResult(0);
      },
    });
    const testRuntime = storeWith(execute);

    await testRuntime.runPromise(
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
    const execute = fakeGit({
      [`rev-parse --verify --quiet ${existingRef}^{commit}`]: () =>
        gitResult(0, "existing-commit\n"),
      [`rev-parse --verify --quiet ${missingRef}^{commit}`]: () => gitResult(1),
    });
    const testRuntime = storeWith(execute);

    await testRuntime.runPromise(
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
    const execute = fakeGit({
      [`update-ref -d ${lockedRef}`]: () => gitResult(1, "", "cannot lock ref\n"),
    });
    const testRuntime = storeWith(execute);

    const result = await testRuntime.runPromise(
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
});

describe("CheckpointStoreLive against a real repository", () => {
  const lines = (count: number) =>
    Array.from({ length: count }, (_, index) => `line ${index}\n`).join("");

  it("summarizes added, deleted, renamed and binary files", () =>
    withRealRepo("glade-checkpoint-summary-", async ({ cwd, git, runtime }) => {
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

      const files = await runtime.runPromise(
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
    }));

  it("scopes restore to removed turns and requires fresh consent for later edits", () =>
    withRealRepo("glade-scoped-restore-", async ({ cwd, git, runtime }) => {
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
    }));
});
