import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Layer, PlatformError, Scope } from "effect";
import type { GitCommandError } from "./Errors.ts";
import { expect } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../server/config.ts";
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
  it.effect(
    "rejects a same-line-count edit after generation without committing or clearing the index",
    () =>
      Effect.gen(function* () {
        const { core, cwd, run, write, actions } = yield* setup;
        const head = (yield* run(["rev-parse", "HEAD"])).stdout;
        yield* write("file.txt", "original suggestion\n");
        const context = yield* core.prepareCommitContext(cwd, false);
        expect(context?.scope).toBe("workingTree");
        yield* write("file.txt", "changed after suggestion\n");
        yield* run(["add", "."]);
        const index = (yield* run(["write-tree"])).stdout;
        const result = yield* Effect.exit(
          actions.commitStaged(cwd, "Generated message", {
            snapshot: context!.snapshot,
            scope: "workingTree",
          }),
        );
        expect(Exit.isFailure(result)).toBe(true);
        expect((yield* run(["rev-parse", "HEAD"])).stdout).toBe(head);
        expect((yield* run(["write-tree"])).stdout).toBe(index);
      }),
  );

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
        expect(yield* actions.rebaseState(cwd)).toMatchObject({ inProgress: true });
        yield* actions.rebase({ cwd, action: "abort" });
        expect((yield* run(["rev-parse", "HEAD"])).stdout).toBe(original);
        expect(yield* actions.rebaseState(cwd)).toMatchObject({ inProgress: false });
        yield* Effect.exit(actions.rebase({ cwd, action: "start", target: "main" }));
        yield* write("file.txt", "resolved\n");
        yield* run(["add", "file.txt"]);
        yield* actions.rebase({ cwd, action: "continue" });
        expect(yield* actions.rebaseState(cwd)).toMatchObject({ inProgress: false });
        expect((yield* run(["show", "HEAD:file.txt"])).stdout).toBe("resolved\n");
        expect((yield* run(["merge-base", "--is-ancestor", "main", "HEAD"])).code).toBe(0);
      }),
  );
  it.effect(
    "undo preserves the index, unstaged edits and untracked files and rejects stale or root selections",
    () =>
      Effect.gen(function* () {
        const { cwd, run, write, actions } = yield* setup;
        const root = (yield* run(["rev-parse", "HEAD"])).stdout.trim();
        expect(Exit.isFailure(yield* Effect.exit(actions.undoCommit(cwd, root)))).toBe(true);
        yield* write("file.txt", "committed\n");
        yield* run(["commit", "-am", "Undo me\n\nBody"]);
        const head = (yield* run(["rev-parse", "HEAD"])).stdout.trim();
        yield* write("file.txt", "staged\n");
        yield* run(["add", "file.txt"]);
        yield* write("file.txt", "unstaged\n");
        yield* write("untracked.txt", "keep\n");
        const index = (yield* run(["write-tree"])).stdout;
        expect(Exit.isFailure(yield* Effect.exit(actions.undoCommit(cwd, root)))).toBe(true);
        expect((yield* actions.undoCommit(cwd, head)).message).toBe("Undo me\n\nBody");
        expect((yield* run(["rev-parse", "HEAD"])).stdout.trim()).toBe(root);
        expect((yield* run(["write-tree"])).stdout).toBe(index);
        expect(yield* Effect.promise(() => fs.readFile(path.join(cwd, "file.txt"), "utf8"))).toBe(
          "unstaged\n",
        );
        expect(
          yield* Effect.promise(() => fs.readFile(path.join(cwd, "untracked.txt"), "utf8")),
        ).toBe("keep\n");
      }),
  );

  type Repo = Effect.Success<typeof setup>;
  const commitFile = (repo: Repo, name: string, content: string, message: string) =>
    Effect.gen(function* () {
      yield* repo.write(name, content);
      yield* repo.run(["add", name]);
      yield* repo.run(["commit", "-m", message]);
    });
  const eligibility: ReadonlyArray<{
    name: string;
    arrange: (
      repo: Repo,
    ) => Effect.Effect<void, GitCommandError | PlatformError.PlatformError, Scope.Scope>;
    target?: string;
    undo: boolean;
    revert: "reverted" | "stopped" | "refused";
  }> = [
    {
      name: "unpushed head",
      arrange: (repo) => commitFile(repo, "file.txt", "local\n", "Local"),
      undo: true,
      revert: "reverted",
    },
    {
      name: "pushed head",
      arrange: (repo) =>
        Effect.gen(function* () {
          const remote = yield* repo.files.makeTempDirectoryScoped({ prefix: "glade-remote-" });
          yield* repo.run(["init", "--bare", remote]);
          yield* repo.run(["remote", "add", "origin", remote]);
          yield* commitFile(repo, "file.txt", "pushed\n", "Pushed");
          yield* repo.run(["push", "-u", "origin", "main"]);
        }),
      undo: false,
      revert: "reverted",
    },
    { name: "root commit", arrange: () => Effect.void, undo: false, revert: "reverted" },
    {
      name: "merge head",
      arrange: (repo) =>
        Effect.gen(function* () {
          yield* repo.run(["checkout", "-b", "side"]);
          yield* commitFile(repo, "side.txt", "side\n", "Side");
          yield* repo.run(["checkout", "main"]);
          yield* commitFile(repo, "main.txt", "main\n", "Main");
          yield* repo.run(["merge", "--no-ff", "side", "-m", "Merge side"]);
        }),
      undo: false,
      revert: "refused",
    },
    {
      name: "head during a conflicting cherry-pick",
      arrange: (repo) =>
        Effect.gen(function* () {
          yield* repo.run(["checkout", "-b", "side"]);
          yield* commitFile(repo, "file.txt", "side\n", "Side");
          yield* repo.run(["checkout", "main"]);
          yield* commitFile(repo, "file.txt", "main\n", "Main");
          yield* repo.core
            .execute({
              cwd: repo.cwd,
              operation: "test",
              args: ["cherry-pick", "side"],
              allowNonZeroExit: true,
            })
            .pipe(Effect.asVoid);
        }),
      undo: false,
      revert: "refused",
    },
    {
      name: "older commit whose revert conflicts",
      arrange: (repo) =>
        Effect.gen(function* () {
          yield* commitFile(repo, "file.txt", "first\n", "First");
          yield* commitFile(repo, "file.txt", "second\n", "Second");
        }),
      target: "HEAD~1",
      undo: false,
      revert: "stopped",
    },
  ];
  for (const row of eligibility) {
    it.effect(`undo and revert eligibility: ${row.name}`, () =>
      Effect.gen(function* () {
        const repo = yield* setup;
        yield* row.arrange(repo);
        const sha = (yield* repo.run(["rev-parse", row.target ?? "HEAD"])).stdout.trim();
        const undoable = yield* repo.actions.checkUndoCommit(repo.cwd);
        expect(undoable === sha).toBe(row.undo);
        const revert = yield* Effect.exit(repo.actions.revertCommit(repo.cwd, sha));
        expect(Exit.isSuccess(revert) ? revert.value.status : "refused").toBe(row.revert);
        if (row.revert === "stopped")
          expect(yield* repo.actions.rebaseState(repo.cwd)).toMatchObject({ kind: "revert" });
      }),
    );
  }

  it.effect(
    "undo keeps conflicting local tags and rejects commits published only under remote tags",
    () =>
      Effect.gen(function* () {
        const { cwd, files, run, write, actions } = yield* setup;
        const root = (yield* run(["rev-parse", "HEAD"])).stdout.trim();
        yield* run(["tag", "v1", root]);
        const remote = yield* files.makeTempDirectoryScoped({ prefix: "glade-remote-tags-" });
        yield* run(["init", "--bare", remote]);
        yield* run(["remote", "add", "upstream", remote]);
        yield* run(["push", "upstream", "HEAD:refs/heads/main"]);
        yield* write("file.txt", "published tag\n");
        yield* run(["commit", "-am", "Remote tag"]);
        const published = (yield* run(["rev-parse", "HEAD"])).stdout.trim();
        yield* run(["push", "upstream", "HEAD:refs/tags/v1"]);
        yield* write("file.txt", "unpublished\n");
        yield* run(["commit", "-am", "Undo me"]);
        const head = (yield* run(["rev-parse", "HEAD"])).stdout.trim();
        expect((yield* actions.undoCommit(cwd, head)).message).toBe("Undo me");
        expect((yield* run(["rev-parse", "HEAD"])).stdout.trim()).toBe(published);
        expect((yield* run(["rev-parse", "refs/tags/v1"])).stdout.trim()).toBe(root);
        expect(Exit.isFailure(yield* Effect.exit(actions.undoCommit(cwd, published)))).toBe(true);
        expect((yield* run(["rev-parse", "HEAD"])).stdout.trim()).toBe(published);
      }),
  );

  it.effect(
    "synchronized push publishes, fast-forwards and rebases divergence without losing work",
    () =>
      Effect.gen(function* () {
        const { cwd, core, files, run, write, actions } = yield* setup;
        const remote = yield* files.makeTempDirectoryScoped({ prefix: "glade-remote-" });
        yield* run(["init", "--bare", remote]);
        yield* run(["remote", "add", "origin", remote]);
        yield* core.pushCurrentBranch(cwd, "main");
        const other = yield* files.makeTempDirectoryScoped({ prefix: "glade-other-" });
        yield* run(["clone", "-b", "main", remote, other]);
        const otherRun = (args: string[]) => core.execute({ cwd: other, operation: "test", args });
        yield* otherRun(["config", "user.name", "Other"]);
        yield* otherRun(["config", "user.email", "other@example.com"]);
        yield* otherRun(["config", "commit.gpgsign", "false"]);
        yield* files.writeFileString(path.join(other, "incoming.txt"), "incoming\n");
        yield* otherRun(["add", "."]);
        yield* otherRun(["commit", "-m", "Incoming"]);
        yield* otherRun(["push"]);
        yield* core.pushCurrentBranch(cwd, "main");
        expect(yield* files.readFileString(path.join(cwd, "incoming.txt"))).toBe("incoming\n");
        yield* write("outgoing.txt", "outgoing\n");
        yield* run(["add", "."]);
        yield* run(["commit", "-m", "Outgoing"]);
        const unpublished = (yield* run(["rev-parse", "HEAD"])).stdout.trim();
        yield* files.writeFileString(path.join(other, "another.txt"), "another\n");
        yield* otherRun(["add", "."]);
        yield* otherRun(["commit", "-m", "Another"]);
        yield* otherRun(["push"]);
        expect(Exit.isFailure(yield* Effect.exit(core.pushCurrentBranch(cwd, "main", false)))).toBe(
          true,
        );
        expect((yield* run(["rev-parse", "HEAD"])).stdout.trim()).toBe(unpublished);
        yield* core.pushCurrentBranch(cwd, "main");
        expect(yield* files.readFileString(path.join(cwd, "another.txt"))).toBe("another\n");
        expect(yield* files.readFileString(path.join(cwd, "outgoing.txt"))).toBe("outgoing\n");
        const published = (yield* run(["rev-parse", "HEAD"])).stdout.trim();
        expect(published).not.toBe(unpublished);
        expect(Exit.isFailure(yield* Effect.exit(actions.undoCommit(cwd, published)))).toBe(true);
        expect((yield* run(["rev-parse", "HEAD"])).stdout.trim()).toBe(published);
      }),
  );

  it.effect(
    "push conflict intent survives reconstruction and supports abort and resumed push",
    () =>
      Effect.gen(function* () {
        const { cwd, core, files, run, write } = yield* setup;
        const remote = yield* files.makeTempDirectoryScoped({ prefix: "glade-remote-" });
        yield* run(["init", "--bare", remote]);
        yield* run(["remote", "add", "origin", remote]);
        yield* core.pushCurrentBranch(cwd, "main");
        yield* run(["checkout", "-b", "incoming"]);
        yield* write("file.txt", "incoming\n");
        yield* run(["commit", "-am", "Incoming"]);
        yield* run(["push", "origin", "HEAD:main"]);
        yield* run(["checkout", "main"]);
        yield* write("file.txt", "outgoing\n");
        yield* run(["commit", "-am", "Outgoing"]);
        const head = (yield* run(["rev-parse", "HEAD"])).stdout.trim();
        expect(Exit.isFailure(yield* Effect.exit(core.pushCurrentBranch(cwd, "main")))).toBe(true);
        expect(yield* sourceControlActions(core).rebaseState(cwd)).toMatchObject({
          kind: "rebase",
          pendingPush: true,
          conflicts: ["file.txt"],
        });
        yield* sourceControlActions(core).rebase({ cwd, action: "abort" });
        expect((yield* run(["rev-parse", "HEAD"])).stdout.trim()).toBe(head);
        expect(yield* sourceControlActions(core).rebaseState(cwd)).toMatchObject({
          inProgress: false,
          pendingPush: false,
        });
        expect(Exit.isFailure(yield* Effect.exit(core.pushCurrentBranch(cwd, "main")))).toBe(true);
        yield* write("file.txt", "resolved\n");
        yield* run(["add", "file.txt"]);
        yield* sourceControlActions(core).rebase({ cwd, action: "continue" });
        expect((yield* run(["rev-parse", "HEAD"])).stdout).toBe(
          (yield* run(["rev-parse", "origin/main"])).stdout,
        );
        expect(yield* sourceControlActions(core).rebaseState(cwd)).toMatchObject({
          inProgress: false,
          pendingPush: false,
        });
      }),
  );
});
