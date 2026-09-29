// FILE: GitCore.test.ts
// Purpose: Exercises GitCore repository operations, branch/worktree flows, and status summaries.
// Layer: Server Git service tests
// Depends on: Effect test layers plus real temporary Git repositories.
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Layer, PlatformError, Schema, Scope } from "effect";
import { describe, expect } from "vitest";

import { GitCoreLive } from "./GitCore.ts";
import { GitCore } from "../Services/GitCore.ts";
import { GitCheckoutDirtyWorktreeError, GitCommandError } from "../Errors.ts";
import { ServerConfig } from "../../config.ts";

// ── Helpers ──

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "glade-git-core-test-",
});
const GitCoreTestLayer = GitCoreLive.pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provide(NodeServices.layer),
);
const TestLayer = Layer.mergeAll(NodeServices.layer, GitCoreTestLayer);

function makeTmpDir(
  prefix = "git-test-",
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix });
  });
}

function writeTextFile(
  filePath: string,
  contents: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(filePath, contents);
  });
}

function readTextFile(
  filePath: string,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.readFileString(filePath);
  });
}

/** Run a raw git command for test setup (not under test). */
function git(
  cwd: string,
  args: ReadonlyArray<string>,
  env?: NodeJS.ProcessEnv,
): Effect.Effect<string, GitCommandError, GitCore> {
  return Effect.gen(function* () {
    const gitCore = yield* GitCore;
    const result = yield* gitCore.execute({
      operation: "GitCore.test.git",
      cwd,
      args,
      ...(env ? { env } : {}),
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });
}

/** Create a repo with an initial commit so branches work. */
function initRepoWithCommit(
  cwd: string,
): Effect.Effect<
  { initialBranch: string },
  GitCommandError | PlatformError.PlatformError,
  GitCore | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const core = yield* GitCore;
    yield* core.initRepo({ cwd });
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* writeTextFile(path.join(cwd, "README.md"), "# test\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "initial commit"]);
    const initialBranch = yield* git(cwd, ["branch", "--show-current"]);
    return { initialBranch };
  });
}

// ── Tests ──

it.layer(TestLayer)("git integration", (it) => {
  describe("bounded working-tree and ref reads", () => {
    it.effect("preserves a regular-file to gitlink type change against the ref", () =>
      Effect.gen(function* () {
        const core = yield* GitCore;
        const tmp = yield* makeTmpDir();
        const sub = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* initRepoWithCommit(sub);
        yield* writeTextFile(path.join(tmp, "vendor"), "old file\n");
        yield* git(tmp, ["add", "."]);
        yield* git(tmp, ["commit", "-m", "old file"]);
        yield* git(tmp, ["rm", "vendor"]);
        yield* git(tmp, ["-c", "protocol.file.allow=always", "submodule", "add", sub, "vendor"]);
        const patch = (yield* core.readRefPatch(tmp, "HEAD")).patch;
        expect(patch).toContain("new file mode 160000");
        expect(patch).toContain("+Subproject commit ");
        expect(yield* core.readDiffStats(tmp, "ref", "HEAD")).toEqual({
          additions: 4,
          deletions: 1,
          fileCount: 2,
        });
        yield* git(tmp, ["submodule", "deinit", "-f", "vendor"]);
        expect((yield* core.readRefPatch(tmp, "HEAD")).patch).toContain("new file mode 160000");
        expect(yield* core.readDiffStats(tmp, "ref", "HEAD")).toEqual({
          additions: 4,
          deletions: 1,
          fileCount: 2,
        });
      }),
    );

    it.effect("truncates an oversized unstaged patch instead of failing", () =>
      Effect.gen(function* () {
        const core = yield* GitCore;
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);

        const original = "x\n".repeat(400_000);
        const updated = "y\n".repeat(400_000);
        yield* writeTextFile(path.join(tmp, "generated.ts"), original);
        yield* git(tmp, ["add", "generated.ts"]);
        yield* git(tmp, ["commit", "-m", "add generated"]);
        yield* writeTextFile(path.join(tmp, "generated.ts"), updated);

        const result = yield* core.readUnstagedPatch(tmp);
        expect(Buffer.byteLength(result.patch, "utf8")).toBeLessThanOrEqual(1_000_000);
        expect(result.truncated).toBe(true);
        expect(result.patch).toContain("diff --git a/generated.ts b/generated.ts");

        yield* writeTextFile(path.join(tmp, "z-last.txt"), "visible even after a large diff\n");
        const files = yield* core.readSourceControlFiles(tmp);
        expect(files.unstaged.map((file) => file.path)).toEqual(["generated.ts", "z-last.txt"]);
        const selected = yield* core.readUnstagedPatch(tmp, "z-last.txt");
        expect(selected.truncated).toBe(false);
        expect(selected.patch).toContain("+visible even after a large diff");
        yield* git(tmp, ["add", "z-last.txt"]);
        const stagedFiles = yield* core.readSourceControlFiles(tmp);
        expect(stagedFiles.staged.map((file) => file.path)).toEqual(["z-last.txt"]);
        expect((yield* core.readStagedPatch(tmp, "z-last.txt")).patch).toContain(
          "+visible even after a large diff",
        );
      }),
    );

    it.effect("bounds tracked and untracked patches to a literal requested file", () =>
      Effect.gen(function* () {
        const core = yield* GitCore;
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* writeTextFile(path.join(tmp, "[a].txt"), "before\n");
        yield* writeTextFile(path.join(tmp, "a.txt"), "before\n");
        yield* git(tmp, ["add", "."]);
        yield* git(tmp, ["commit", "-m", "files"]);
        yield* writeTextFile(path.join(tmp, "[a].txt"), "selected\n");
        yield* writeTextFile(path.join(tmp, "a.txt"), "unrelated\n");
        yield* writeTextFile(path.join(tmp, "untracked.txt"), "new selected\n");
        const tracked = (yield* core.readWorkingTreePatch(tmp, "[a].txt")).patch;
        expect(tracked).toContain("+selected");
        expect(tracked).not.toContain("unrelated");
        expect(tracked).not.toContain("untracked.txt");
        const untracked = (yield* core.readWorkingTreePatch(tmp, "untracked.txt")).patch;
        expect(untracked).toContain("+new selected");
        expect(untracked).not.toContain("a.txt");
        expect((yield* core.readWorkingTreePatch(tmp, "missing.txt")).patch).toBe("");
      }),
    );

    it.effect("rejects traversal and directories instead of expanding a file request", () =>
      Effect.gen(function* () {
        const core = yield* GitCore;
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* Effect.promise(() => fs.mkdir(path.join(tmp, "folder")));
        yield* writeTextFile(path.join(tmp, "folder", "child.txt"), "child\n");
        for (const filePath of ["../outside.txt", "/tmp/outside.txt", "folder", "folder/", ""]) {
          const exit = yield* core.readWorkingTreePatch(tmp, filePath).pipe(Effect.exit);
          expect(Exit.isFailure(exit)).toBe(true);
        }
      }),
    );
  });

  describe("readFileAtRev", () => {
    it.effect("rejects paths that escape the workspace", () =>
      Effect.gen(function* () {
        const core = yield* GitCore;
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);

        const error = yield* core
          .readFileAtRev({ cwd: tmp, filePath: "../outside.ts" })
          .pipe(Effect.flip);

        expect(error.message).toContain("workspace-relative");
      }),
    );
  });

  // ── initGitRepo ──

  // ── listGitBranches ──

  // ── checkoutGitBranch ──

  describe("checkoutGitBranch", () => {
    it.effect("does not silently checkout a local branch when a remote ref no longer exists", () =>
      Effect.gen(function* () {
        const remote = yield* makeTmpDir();
        const source = yield* makeTmpDir();
        yield* git(remote, ["init", "--bare"]);

        yield* initRepoWithCommit(source);
        const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: source })).branches.find(
          (branch) => branch.current,
        )!.name;
        yield* git(source, ["remote", "add", "origin", remote]);
        yield* git(source, ["push", "-u", "origin", defaultBranch]);

        yield* (yield* GitCore).createBranch({ cwd: source, branch: "feature" });

        const checkoutResult = yield* Effect.result(
          (yield* GitCore).checkoutBranch({ cwd: source, branch: "origin/feature" }),
        );
        expect(checkoutResult._tag).toBe("Failure");
        expect(yield* git(source, ["branch", "--show-current"])).toBe(defaultBranch);
      }),
    );

    it.effect("throws when checkout would overwrite uncommitted changes", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* (yield* GitCore).createBranch({ cwd: tmp, branch: "other" });

        // Create a conflicting change: modify README on current branch
        yield* writeTextFile(path.join(tmp, "README.md"), "modified\n");
        yield* git(tmp, ["add", "README.md"]);

        // First, checkout other branch cleanly
        yield* git(tmp, ["stash"]);
        yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: "other" });
        yield* writeTextFile(path.join(tmp, "README.md"), "other content\n");
        yield* git(tmp, ["add", "."]);
        yield* git(tmp, ["commit", "-m", "other change"]);

        // Go back to default branch
        const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
          (b) => !b.current,
        )!.name;
        yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: defaultBranch });

        // Make uncommitted changes to the same file
        yield* writeTextFile(path.join(tmp, "README.md"), "conflicting local\n");

        // Checkout should fail due to uncommitted changes
        const result = yield* Effect.result(
          (yield* GitCore).checkoutBranch({ cwd: tmp, branch: "other" }),
        );
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          const error = result.failure;
          expect(error).toBeInstanceOf(GitCheckoutDirtyWorktreeError);
          if (Schema.is(GitCheckoutDirtyWorktreeError)(error)) {
            expect(error.branch).toBe("other");
            expect(error.conflictingFiles).toContain("README.md");
            expect(error.message).toContain("Uncommitted changes block checkout to other:");
          }
        }
        expect(yield* git(tmp, ["branch", "--show-current"])).toBe(defaultBranch);
      }),
    );
  });

  describe("stashAndCheckout", () => {
    it.effect("keeps the stash when reapplying dirty changes conflicts", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        const { initialBranch } = yield* initRepoWithCommit(tmp);
        const core = yield* GitCore;

        yield* core.createBranch({ cwd: tmp, branch: "conflicting" });
        yield* core.checkoutBranch({ cwd: tmp, branch: "conflicting" });
        yield* writeTextFile(path.join(tmp, "README.md"), "conflicting content\n");
        yield* git(tmp, ["add", "."]);
        yield* git(tmp, ["commit", "-m", "conflicting change"]);
        yield* core.checkoutBranch({ cwd: tmp, branch: initialBranch });

        yield* writeTextFile(path.join(tmp, "README.md"), "local edits that will conflict\n");

        const result = yield* Effect.result(
          core.stashAndCheckout({ cwd: tmp, branch: "conflicting" }),
        );

        expect(result._tag).toBe("Failure");
        const branches = yield* core.listBranches({ cwd: tmp });
        expect(branches.branches.find((branch) => branch.current)?.name).toBe("conflicting");
        expect(yield* readTextFile(path.join(tmp, "README.md"))).toBe("conflicting content\n");
        expect((yield* git(tmp, ["status", "--short"])).trim()).toBe("");
        expect(yield* git(tmp, ["stash", "list"])).toContain(
          "glade: stash before switching to conflicting",
        );
      }),
    );
  });

  // ── createGitBranch ──

  // ── renameGitBranch ──

  // ── createGitWorktree + removeGitWorktree ──

  describe("createGitWorktree", () => {
    it.effect("creates a worktree with a new branch from the base branch", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);

        const wtPath = path.join(tmp, "worktree-out");
        const currentBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
          (b) => b.current,
        )!.name;

        const result = yield* (yield* GitCore).createWorktree({
          cwd: tmp,
          branch: currentBranch,
          newBranch: "wt-branch",
          path: wtPath,
        });

        expect(result.worktree.path).toBe(wtPath);
        expect(result.worktree.branch).toBe("wt-branch");
        expect(existsSync(wtPath)).toBe(true);
        expect(existsSync(path.join(wtPath, "README.md"))).toBe(true);

        yield* (yield* GitCore).removeWorktree({ cwd: tmp, path: wtPath });
        expect(existsSync(wtPath)).toBe(false);
      }),
    );

    it.effect("copies checkout changes and .worktreeinclude files into a detached worktree", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* writeTextFile(path.join(tmp, ".gitignore"), ".env\n");
        yield* writeTextFile(path.join(tmp, ".worktreeinclude"), ".env\n");
        yield* git(tmp, ["add", ".gitignore", ".worktreeinclude"]);
        yield* git(tmp, ["commit", "-m", "configure worktree files"]);
        yield* writeTextFile(path.join(tmp, "README.md"), "# locally edited\n");
        yield* writeTextFile(path.join(tmp, "notes.txt"), "untracked note\n");
        yield* writeTextFile(path.join(tmp, ".env"), "LOCAL_ONLY=yes\n");

        const core = yield* GitCore;
        const expectedHead = yield* git(tmp, ["rev-parse", "HEAD"]);
        const wtPath = path.join(tmp, "wt-copied-state");
        const result = yield* core.createDetachedWorktree({
          cwd: tmp,
          ref: "HEAD",
          path: wtPath,
          copyChangesFrom: tmp,
        });

        expect(result.worktree).toEqual({ path: wtPath, ref: expectedHead, branch: null });
        expect(yield* readTextFile(path.join(wtPath, "README.md"))).toBe("# locally edited\n");
        expect(yield* readTextFile(path.join(wtPath, "notes.txt"))).toBe("untracked note\n");
        expect(yield* readTextFile(path.join(wtPath, ".env"))).toBe("LOCAL_ONLY=yes\n");

        const proof = yield* core.recordWorktreeOwnership({
          path: wtPath,
          branch: null,
          token: "copied-state-token",
        });
        expect(yield* core.verifyWorktreeOwnership({ path: wtPath, proof })).toEqual({
          verified: true,
          reason: null,
        });
        yield* writeTextFile(path.join(wtPath, ".env"), "LOCAL_ONLY=changed\n");
        expect(yield* core.verifyWorktreeOwnership({ path: wtPath, proof })).toEqual({
          verified: false,
          reason: "worktree state changed",
        });
        yield* core.removeWorktree({ cwd: tmp, path: wtPath, force: true });
      }),
    );

    it.effect("deletes the pre-created branch when worktree add fails", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const core = yield* GitCore;
        const wtPath = path.join(tmp, "wt-rollback-branch");
        // A plain file at the target path makes `git worktree add` fail after
        // the branch has already been created.
        yield* writeTextFile(wtPath, "occupied\n");

        const result = yield* Effect.exit(
          core.createDetachedWorktree({
            cwd: tmp,
            ref: "HEAD",
            path: wtPath,
            newBranch: "glade/rollback1",
          }),
        );

        expect(Exit.isFailure(result)).toBe(true);
        expect(yield* git(tmp, ["branch", "--list", "glade/rollback1"])).toBe("");
      }),
    );

    it.effect("removeWorktree reclamation never deletes user-named branches", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const core = yield* GitCore;
        const wtPath = path.join(tmp, "wt-user-branch");
        yield* core.createDetachedWorktree({
          cwd: tmp,
          ref: "HEAD",
          path: wtPath,
          newBranch: "feature/user-owned",
        });

        yield* core.removeWorktree({
          cwd: tmp,
          path: wtPath,
          force: true,
          reclaimTemporaryBranch: true,
        });
        const remainingBranches = yield* git(tmp, ["branch", "--list", "feature/user-owned"]);
        expect(remainingBranches).toContain("feature/user-owned");
      }),
    );

    it.effect("atomically replaces an incomplete worktree snapshot", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* writeTextFile(path.join(tmp, "README.md"), "snapshot change\n");
        yield* writeTextFile(path.join(tmp, "untracked.txt"), "preserve me\n");

        const snapshotRoot = yield* makeTmpDir("worktree-snapshot-test-");
        const outputPath = path.join(snapshotRoot, "thread-1");
        yield* Effect.promise(() => fs.mkdir(outputPath, { recursive: true }));
        yield* writeTextFile(path.join(outputPath, "partial.tmp"), "incomplete\n");

        const core = yield* GitCore;
        yield* core.snapshotWorktree({ cwd: tmp, outputPath });

        expect(existsSync(path.join(outputPath, "snapshot.json"))).toBe(true);
        expect(existsSync(path.join(outputPath, "partial.tmp"))).toBe(false);
        expect(yield* readTextFile(path.join(outputPath, "files", "untracked.txt"))).toBe(
          "preserve me\n",
        );
        expect(yield* readTextFile(path.join(outputPath, "changes.patch"))).toContain(
          "snapshot change",
        );
      }),
    );

    it.effect("rejects a moved HEAD and conditionally preserves the changed branch", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        const { initialBranch } = yield* initRepoWithCommit(tmp);
        const core = yield* GitCore;
        const wtPath = path.join(tmp, "wt-head-moved");
        yield* core.createWorktree({
          cwd: tmp,
          branch: initialBranch,
          newBranch: "wt-head-moved",
          path: wtPath,
        });
        const proof = yield* core.recordWorktreeOwnership({
          path: wtPath,
          branch: "wt-head-moved",
          token: "head-moved-token",
        });
        yield* writeTextFile(path.join(wtPath, "new-commit.txt"), "preserve me\n");
        yield* git(wtPath, ["add", "new-commit.txt"]);
        yield* git(wtPath, ["commit", "-m", "advance owned branch"]);

        expect(yield* core.verifyWorktreeOwnership({ path: wtPath, proof })).toEqual({
          verified: false,
          reason: "worktree HEAD changed",
        });
        yield* core.removeWorktree({ cwd: tmp, path: wtPath, force: false });
        const deletion = yield* Effect.exit(
          core.deleteBranchIfUnchanged({
            cwd: tmp,
            branch: "wt-head-moved",
            expectedHead: proof.head,
          }),
        );
        expect(Exit.isFailure(deletion)).toBe(true);
        expect(
          (yield* core.listBranches({ cwd: tmp })).branches.some(
            (branch) => branch.name === "wt-head-moved",
          ),
        ).toBe(true);
        yield* core.deleteBranch({ cwd: tmp, branch: "wt-head-moved", force: true });
      }),
    );
  });

  // ── Full flow: worktree creation from base branch ──

  // ── Full flow: thread switching simulation ──

  // ── Full flow: checkout conflict ──

  describe("GitCore", () => {
    it.effect("prepareCommitContext stages only selected files when filePaths provided", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const core = yield* GitCore;

        yield* writeTextFile(path.join(tmp, "a.txt"), "file a\n");
        yield* writeTextFile(path.join(tmp, "b.txt"), "file b\n");

        const context = yield* core.prepareCommitContext(tmp, ["a.txt"]);
        expect(context).not.toBeNull();
        expect(context!.stagedSummary).toContain("a.txt");
        expect(context!.stagedSummary).not.toContain("b.txt");

        yield* core.commit(tmp, "Add only a.txt", "");

        // b.txt should still be untracked after commit
        const statusAfter = yield* git(tmp, ["status", "--porcelain"]);
        expect(statusAfter).toContain("b.txt");
        expect(statusAfter).not.toContain("a.txt");
      }),
    );
  });
});
