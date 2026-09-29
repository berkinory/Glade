import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Layer } from "effect";
import { expect } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../config.ts";
import { GitCoreLive } from "./Layers/GitCore.ts";
import { GitCore } from "./Services/GitCore.ts";
import { sourceControlActions } from "./sourceControlActions.ts";

const layer = GitCoreLive.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "glade-scm-test-" })),
  Layer.provideMerge(NodeServices.layer),
);
const setup = Effect.gen(function* () {
  const core = yield* GitCore;
  const files = yield* FileSystem.FileSystem;
  const cwd = yield* files.makeTempDirectoryScoped({ prefix: "glade-scm-" });
  const run = (args: string[]) => core.execute({ cwd, operation: "test", args });
  yield* run(["init", "-b", "main"]);
  yield* run(["config", "user.email", "test@example.com"]);
  yield* run(["config", "user.name", "Test"]);
  yield* run(["config", "commit.gpgsign", "false"]);
  const write = (name: string, content: string) =>
    files.writeFileString(path.join(cwd, name), content);
  yield* write("file.txt", "initial\n");
  yield* run(["add", "."]);
  yield* run(["commit", "-m", "Initial"]);
  return { core, files, cwd, run, write, actions: sourceControlActions(core) };
});

it.layer(layer)("source-control actions", (it) => {
  it.effect("commits the index without staging working-tree edits", () =>
    Effect.gen(function* () {
      const { cwd, run, write, actions } = yield* setup;
      yield* write("file.txt", "staged\n");
      yield* run(["add", "file.txt"]);
      yield* write("file.txt", "unstaged\n");
      yield* write("untracked.txt", "untracked\n");
      yield* actions.commitStaged(cwd, "Only staged\n\nWith body");
      expect((yield* run(["show", "HEAD:file.txt"])).stdout).toBe("staged\n");
      expect((yield* run(["status", "--porcelain"])).stdout).toContain(" M file.txt");
      expect((yield* run(["status", "--porcelain"])).stdout).toContain("?? untracked.txt");
    }),
  );

  it.effect(
    "ignores exact paths from a subdirectory without globbing or replacing existing rules",
    () =>
      Effect.gen(function* () {
        const { cwd, run, write, actions, files } = yield* setup;
        yield* files.makeDirectory(path.join(cwd, "nested"));
        yield* write(".gitignore", "# existing\r\n/other");
        yield* write("nested/a[1]*.txt", "ignore\n");
        yield* write("nested/a1more.txt", "keep\n");
        yield* actions.ignorePaths(path.join(cwd, "nested"), ["a[1]*.txt"]);
        yield* actions.ignorePaths(path.join(cwd, "nested"), ["a[1]*.txt"]);
        expect(yield* files.readFileString(path.join(cwd, ".gitignore"))).toBe(
          "# existing\r\n/other\r\n/nested/a\\[1\\]\\*.txt\r\n",
        );
        expect((yield* run(["ls-files", "--others", "--exclude-standard"])).stdout).toContain(
          "nested/a1more.txt",
        );
        expect((yield* run(["ls-files", "--others", "--exclude-standard"])).stdout).not.toContain(
          "nested/a[1]*.txt",
        );
        expect(Exit.isFailure(yield* Effect.exit(actions.ignorePaths(cwd, ["file.txt"])))).toBe(
          true,
        );
        expect(Exit.isFailure(yield* Effect.exit(actions.ignorePaths(cwd, ["../outside"])))).toBe(
          true,
        );
      }),
  );

  it.effect("refuses a linked .gitignore without writing through it", () =>
    Effect.gen(function* () {
      const { cwd, write, actions, files } = yield* setup;
      yield* write("external", "keep\n");
      yield* write("new.txt", "new\n");
      yield* Effect.promise(() =>
        fs.symlink(path.join(cwd, "external"), path.join(cwd, ".gitignore")),
      );
      expect(Exit.isFailure(yield* Effect.exit(actions.ignorePaths(cwd, ["new.txt"])))).toBe(true);
      expect(yield* files.readFileString(path.join(cwd, "external"))).toBe("keep\n");
    }),
  );

  it.effect(
    "leaves conflicting rebase recoverable, aborts to the original head, and can continue after resolution",
    () =>
      Effect.gen(function* () {
        const { cwd, run, write, actions } = yield* setup;
        yield* run(["checkout", "-b", "topic"]);
        yield* write("file.txt", "topic\n");
        yield* run(["commit", "-am", "Topic"]);
        const original = (yield* run(["rev-parse", "HEAD"])).stdout;
        yield* run(["checkout", "main"]);
        yield* write("file.txt", "main\n");
        yield* run(["commit", "-am", "Main"]);
        yield* run(["checkout", "topic"]);
        expect(
          Exit.isFailure(
            yield* Effect.exit(actions.rebase({ cwd, action: "start", target: "main" })),
          ),
        ).toBe(true);
        expect(yield* actions.rebaseState(cwd)).toEqual({ inProgress: true });
        yield* actions.rebase({ cwd, action: "abort" });
        expect((yield* run(["rev-parse", "HEAD"])).stdout).toBe(original);
        expect(yield* actions.rebaseState(cwd)).toEqual({ inProgress: false });
        yield* Effect.exit(actions.rebase({ cwd, action: "start", target: "main" }));
        yield* write("file.txt", "resolved\n");
        yield* run(["add", "file.txt"]);
        yield* actions.rebase({ cwd, action: "continue" });
        expect(yield* actions.rebaseState(cwd)).toEqual({ inProgress: false });
        expect((yield* run(["show", "HEAD:file.txt"])).stdout).toBe("resolved\n");
        expect((yield* run(["merge-base", "--is-ancestor", "main", "HEAD"])).code).toBe(0);
      }),
  );
});
