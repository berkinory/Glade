import { Effect, FileSystem, Layer, Path } from "effect";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import { isTemporaryWorktreeBranch } from "@glade/shared/git/git";
import type { GitCoreShape } from "../Services/GitCore.ts";
import { GitCommands } from "../Services/GitCommands.ts";
import { GitWorktrees } from "../Services/GitWorktrees.ts";
import { GitCommandError } from "../Errors.ts";
import { ServerConfig } from "../../server/config.ts";
import { commandLabel, createGitCommandError } from "./GitCommands.ts";
import { hasNodeErrorCode } from "./GitStatus.ts";

const AUTO_DETACHED_WORKTREE_DIRNAME = "glade";

const WORKTREE_OWNERSHIP_MARKER = "glade-agent-gateway-owner.json";

const WORKTREE_TRANSFER_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const makeGitWorktrees = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { worktreesDir } = yield* ServerConfig;
  const { executeGit } = yield* GitCommands;
  const buildGeneratedDetachedWorktreePath = () =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const shortId = randomUUID().replace(/-/g, "").slice(0, 4);
        const candidateParent = path.join(worktreesDir, shortId);
        const candidatePath = path.join(candidateParent, AUTO_DETACHED_WORKTREE_DIRNAME);
        if (yield* fileSystem.exists(candidatePath)) {
          continue;
        }
        yield* fileSystem.makeDirectory(candidateParent, { recursive: true });
        return candidatePath;
      }

      const fallbackId = randomUUID().replace(/-/g, "");
      const fallbackParent = path.join(worktreesDir, fallbackId);
      yield* fileSystem.makeDirectory(fallbackParent, { recursive: true });
      return path.join(fallbackParent, AUTO_DETACHED_WORKTREE_DIRNAME);
    });

  const createWorktree: GitCoreShape["createWorktree"] = (input) =>
    Effect.gen(function* () {
      const targetBranch = input.newBranch ?? input.branch;
      const sanitizedBranch = targetBranch.replace(/\//g, "-");
      const repoName = path.basename(input.cwd);
      const worktreePath = input.path ?? path.join(worktreesDir, repoName, sanitizedBranch);
      const args = input.newBranch
        ? ["worktree", "add", "-b", input.newBranch, worktreePath, input.branch]
        : ["worktree", "add", worktreePath, input.branch];

      yield* executeGit("GitCore.createWorktree", input.cwd, args, {
        fallbackErrorMessage: "git worktree add failed",
      });

      return {
        worktree: {
          path: worktreePath,
          branch: targetBranch,
        },
      };
    });

  const parseNullSeparatedPaths = (stdout: string): ReadonlyArray<string> =>
    stdout
      .split("\0")
      .filter((entry) => entry.length > 0)
      .filter(
        (entry) =>
          !nodePath.isAbsolute(entry) &&
          entry !== ".." &&
          !entry.startsWith(`..${nodePath.sep}`) &&
          !entry.split(/[\\/]/u).includes(".."),
      );

  const updateHashFromFile = async (
    hash: ReturnType<typeof createHash>,
    filePath: string,
  ): Promise<void> => {
    for await (const chunk of createReadStream(filePath)) {
      hash.update(chunk);
    }
  };

  const listWorktreeTransferPaths = (cwd: string) =>
    Effect.gen(function* () {
      const untracked = yield* executeGit(
        "GitCore.listWorktreeTransferPaths.untracked",
        cwd,
        ["ls-files", "--others", "--exclude-standard", "-z"],
        { maxOutputBytes: WORKTREE_TRANSFER_MAX_OUTPUT_BYTES },
      ).pipe(Effect.map((result) => parseNullSeparatedPaths(result.stdout)));
      const includeFile = nodePath.join(cwd, ".worktreeinclude");
      const hasIncludeFile = yield* Effect.tryPromise({
        try: () =>
          nodeFs
            .stat(includeFile)
            .then((entry) => entry.isFile())
            .catch((cause: unknown) => {
              if (hasNodeErrorCode(cause, "ENOENT")) return false;
              throw cause;
            }),
        catch: (cause) =>
          createGitCommandError(
            "GitCore.listWorktreeTransferPaths",
            cwd,
            ["worktree", "include", "read"],
            "could not inspect .worktreeinclude.",
            cause,
          ),
      });
      const included = hasIncludeFile
        ? yield* executeGit(
            "GitCore.listWorktreeTransferPaths.included",
            cwd,
            ["ls-files", "--others", "--ignored", "--exclude-from=.worktreeinclude", "-z"],
            { maxOutputBytes: WORKTREE_TRANSFER_MAX_OUTPUT_BYTES },
          ).pipe(Effect.map((result) => parseNullSeparatedPaths(result.stdout)))
        : [];
      return [...new Set([...untracked, ...included])].toSorted();
    });

  const readWorktreeStateHash = (cwd: string) =>
    Effect.gen(function* () {
      const [staged, unstaged, transferPaths] = yield* Effect.all(
        [
          executeGit(
            "GitCore.readWorktreeStateHash.staged",
            cwd,
            ["diff", "--cached", "--binary", "--full-index", "HEAD", "--"],
            { maxOutputBytes: WORKTREE_TRANSFER_MAX_OUTPUT_BYTES },
          ),
          executeGit(
            "GitCore.readWorktreeStateHash.unstaged",
            cwd,
            ["diff", "--binary", "--full-index", "--"],
            { maxOutputBytes: WORKTREE_TRANSFER_MAX_OUTPUT_BYTES },
          ),
          listWorktreeTransferPaths(cwd),
        ],
        { concurrency: "unbounded" },
      );
      return yield* Effect.tryPromise({
        try: async () => {
          const hash = createHash("sha256");
          hash.update("staged\0").update(staged.stdout);
          hash.update("unstaged\0").update(unstaged.stdout);
          for (const relativePath of transferPaths) {
            const absolutePath = nodePath.join(cwd, relativePath);
            const entry = await nodeFs.lstat(absolutePath);
            hash.update("path\0").update(relativePath).update("\0");
            if (entry.isSymbolicLink()) {
              hash.update("symlink\0").update(await nodeFs.readlink(absolutePath));
            } else if (entry.isFile()) {
              hash.update("file\0");
              await updateHashFromFile(hash, absolutePath);
            } else {
              hash.update("other\0").update(String(entry.mode));
            }
          }
          return hash.digest("hex");
        },
        catch: (cause) =>
          createGitCommandError(
            "GitCore.readWorktreeStateHash",
            cwd,
            ["worktree", "state", "hash"],
            "could not fingerprint the linked worktree state.",
            cause,
          ),
      });
    });

  const copyCheckoutChanges = (sourceCwd: string, worktreePath: string) =>
    Effect.gen(function* () {
      const [patch, listedTransferPaths] = yield* Effect.all(
        [
          executeGit(
            "GitCore.copyCheckoutChanges.patch",
            sourceCwd,
            ["diff", "--binary", "--full-index", "HEAD", "--"],
            { maxOutputBytes: WORKTREE_TRANSFER_MAX_OUTPUT_BYTES },
          ).pipe(Effect.map((result) => result.stdout)),
          listWorktreeTransferPaths(sourceCwd),
        ],
        { concurrency: "unbounded" },
      );
      const transferPaths = listedTransferPaths.filter((relativePath) => {
        const relativeToTarget = nodePath.relative(
          worktreePath,
          nodePath.join(sourceCwd, relativePath),
        );
        return (
          relativeToTarget === ".." ||
          relativeToTarget.startsWith(`..${nodePath.sep}`) ||
          nodePath.isAbsolute(relativeToTarget)
        );
      });

      if (patch.length > 0) {
        yield* Effect.acquireUseRelease(
          Effect.tryPromise({
            try: () => nodeFs.mkdtemp(nodePath.join(tmpdir(), "glade-worktree-patch-")),
            catch: (cause) =>
              createGitCommandError(
                "GitCore.copyCheckoutChanges",
                sourceCwd,
                ["worktree", "copy", "changes"],
                "could not create a temporary patch directory.",
                cause,
              ),
          }),
          (temporaryDirectory) =>
            Effect.gen(function* () {
              const patchPath = nodePath.join(temporaryDirectory, "changes.patch");
              yield* Effect.tryPromise({
                try: () => nodeFs.writeFile(patchPath, patch, "utf8"),
                catch: (cause) =>
                  createGitCommandError(
                    "GitCore.copyCheckoutChanges",
                    sourceCwd,
                    ["worktree", "copy", "changes"],
                    "could not write the temporary worktree patch.",
                    cause,
                  ),
              });
              yield* executeGit(
                "GitCore.copyCheckoutChanges.apply",
                worktreePath,
                ["apply", "--whitespace=nowarn", patchPath],
                { timeoutMs: 30_000 },
              );
            }),
          (temporaryDirectory) =>
            Effect.promise(() =>
              nodeFs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {}),
            ),
        );
      }

      yield* Effect.forEach(
        transferPaths,
        (relativePath) =>
          Effect.tryPromise({
            try: async () => {
              const sourcePath = nodePath.join(sourceCwd, relativePath);
              const targetPath = nodePath.join(worktreePath, relativePath);
              await nodeFs.mkdir(nodePath.dirname(targetPath), { recursive: true });
              await nodeFs.cp(sourcePath, targetPath, {
                recursive: true,
                force: false,
                errorOnExist: true,
                preserveTimestamps: true,
              });
            },
            catch: (cause) =>
              createGitCommandError(
                "GitCore.copyCheckoutChanges",
                sourceCwd,
                ["worktree", "copy", relativePath],
                `could not copy ${relativePath} into the detached worktree.`,
                cause,
              ),
          }),
        { discard: true, concurrency: 4 },
      );
    });

  const snapshotWorktree: GitCoreShape["snapshotWorktree"] = (input) =>
    Effect.gen(function* () {
      const [patch, transferPaths, head] = yield* Effect.all(
        [
          executeGit(
            "GitCore.snapshotWorktree.patch",
            input.cwd,
            ["diff", "--binary", "--full-index", "HEAD", "--"],
            { maxOutputBytes: WORKTREE_TRANSFER_MAX_OUTPUT_BYTES },
          ).pipe(Effect.map((result) => result.stdout)),
          listWorktreeTransferPaths(input.cwd),
          executeGit("GitCore.snapshotWorktree.head", input.cwd, [
            "rev-parse",
            "--verify",
            "HEAD^{commit}",
          ]).pipe(Effect.map((result) => result.stdout.trim())),
        ],
        { concurrency: "unbounded" },
      );
      yield* Effect.tryPromise({
        try: async () => {
          const outputParent = nodePath.dirname(input.outputPath);
          const temporaryPath = await nodeFs.mkdtemp(
            nodePath.join(outputParent, `${nodePath.basename(input.outputPath)}.tmp-`),
          );
          try {
            await nodeFs.chmod(temporaryPath, 0o700);
            await nodeFs.writeFile(nodePath.join(temporaryPath, "changes.patch"), patch, {
              encoding: "utf8",
              mode: 0o600,
            });
            const filesRoot = nodePath.join(temporaryPath, "files");
            for (const relativePath of transferPaths) {
              const targetPath = nodePath.join(filesRoot, relativePath);
              await nodeFs.mkdir(nodePath.dirname(targetPath), {
                recursive: true,
                mode: 0o700,
              });
              await nodeFs.cp(nodePath.join(input.cwd, relativePath), targetPath, {
                recursive: true,
                force: false,
                errorOnExist: true,
                preserveTimestamps: true,
              });
            }
            await nodeFs.writeFile(
              nodePath.join(temporaryPath, "snapshot.json"),
              JSON.stringify(
                {
                  sourceWorktree: input.cwd,
                  head,
                  copiedPaths: transferPaths,
                  createdAt: new Date().toISOString(),
                },
                null,
                2,
              ),
              { encoding: "utf8", mode: 0o600 },
            );
            await nodeFs.rm(input.outputPath, { recursive: true, force: true });
            await nodeFs.rename(temporaryPath, input.outputPath);
          } finally {
            await nodeFs.rm(temporaryPath, { recursive: true, force: true }).catch(() => {});
          }
        },
        catch: (cause) =>
          createGitCommandError(
            "GitCore.snapshotWorktree",
            input.cwd,
            ["worktree", "snapshot", input.outputPath],
            "could not snapshot the managed worktree.",
            cause,
          ),
      });
    });

  const readWorktreeIdentity = (worktreePath: string) =>
    Effect.gen(function* () {
      const gitDirResult = yield* executeGit("GitCore.readWorktreeIdentity.gitDir", worktreePath, [
        "rev-parse",
        "--absolute-git-dir",
      ]);
      const branchResult = yield* executeGit(
        "GitCore.readWorktreeIdentity.branch",
        worktreePath,
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        { allowNonZeroExit: true },
      );
      const headResult = yield* executeGit("GitCore.readWorktreeIdentity.head", worktreePath, [
        "rev-parse",
        "--verify",
        "HEAD",
      ]);
      const statusResult = yield* executeGit("GitCore.readWorktreeIdentity.status", worktreePath, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]);
      const rawGitDir = gitDirResult.stdout.trim();
      const gitDir = yield* Effect.tryPromise({
        try: () => nodeFs.realpath(rawGitDir),
        catch: (cause) =>
          createGitCommandError(
            "GitCore.readWorktreeIdentity.gitDir",
            worktreePath,
            ["rev-parse", "--absolute-git-dir"],
            "could not canonicalize the linked worktree Git directory.",
            cause,
          ),
      });
      return {
        gitDir,
        branch: branchResult.code === 0 ? branchResult.stdout.trim() || null : null,
        head: headResult.stdout.trim(),
        clean: statusResult.stdout.length === 0,
      };
    });

  const recordWorktreeOwnership: GitCoreShape["recordWorktreeOwnership"] = (input) =>
    Effect.gen(function* () {
      const identity = yield* readWorktreeIdentity(input.path);
      if (identity.branch !== input.branch) {
        return yield* new GitCommandError({
          operation: "GitCore.recordWorktreeOwnership",
          command: "git worktree ownership record",
          cwd: input.path,
          detail: `Expected ${input.branch ? `branch ${input.branch}` : "detached HEAD"}, found ${
            identity.branch ? `branch ${identity.branch}` : "detached HEAD"
          }.`,
        });
      }
      const stateHash = yield* readWorktreeStateHash(input.path);
      const proof = {
        token: input.token,
        gitDir: identity.gitDir,
        branch: identity.branch,
        head: identity.head,
        stateHash,
      };
      const markerPath = nodePath.join(identity.gitDir, WORKTREE_OWNERSHIP_MARKER);
      yield* Effect.tryPromise({
        try: () =>
          nodeFs.writeFile(markerPath, JSON.stringify(proof), {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          }),
        catch: (cause) =>
          createGitCommandError(
            "GitCore.recordWorktreeOwnership",
            input.path,
            ["worktree", "ownership", "record"],
            "could not persist the linked worktree ownership marker.",
            cause,
          ),
      });
      return proof;
    });

  const verifyWorktreeOwnership: GitCoreShape["verifyWorktreeOwnership"] = (input) =>
    Effect.gen(function* () {
      const identity = yield* readWorktreeIdentity(input.path);
      if (identity.gitDir !== input.proof.gitDir) {
        return { verified: false, reason: "linked worktree Git directory changed" };
      }
      const markerPath = nodePath.join(identity.gitDir, WORKTREE_OWNERSHIP_MARKER);
      const markerText = yield* Effect.tryPromise({
        try: () =>
          nodeFs.readFile(markerPath, "utf8").catch((cause: unknown) => {
            if (hasNodeErrorCode(cause, "ENOENT")) return null;
            throw cause;
          }),
        catch: (cause) =>
          createGitCommandError(
            "GitCore.verifyWorktreeOwnership",
            input.path,
            ["worktree", "ownership", "verify"],
            "could not read the linked worktree ownership marker.",
            cause,
          ),
      });
      if (markerText === null) {
        return { verified: false, reason: "ownership marker is missing" };
      }
      let marker: unknown;
      try {
        marker = JSON.parse(markerText);
      } catch {
        return { verified: false, reason: "ownership marker is invalid" };
      }
      if (
        typeof marker !== "object" ||
        marker === null ||
        !("token" in marker) ||
        marker.token !== input.proof.token ||
        !("gitDir" in marker) ||
        marker.gitDir !== input.proof.gitDir ||
        !("branch" in marker) ||
        marker.branch !== input.proof.branch ||
        !("head" in marker) ||
        marker.head !== input.proof.head ||
        (input.proof.stateHash === undefined
          ? "stateHash" in marker
          : !("stateHash" in marker) || marker.stateHash !== input.proof.stateHash)
      ) {
        return { verified: false, reason: "ownership marker does not match" };
      }
      if (identity.branch !== input.proof.branch) {
        return { verified: false, reason: "worktree branch changed" };
      }
      if (identity.head !== input.proof.head) {
        return { verified: false, reason: "worktree HEAD changed" };
      }
      if (input.proof.stateHash === undefined) {
        if (!identity.clean) {
          return { verified: false, reason: "worktree has uncommitted changes" };
        }
      } else {
        const stateHash = yield* readWorktreeStateHash(input.path);
        if (stateHash !== input.proof.stateHash) {
          return { verified: false, reason: "worktree state changed" };
        }
      }
      return { verified: true, reason: null };
    });

  const createDetachedWorktree: GitCoreShape["createDetachedWorktree"] = (input, options) =>
    Effect.gen(function* () {
      const onPhase = options?.onPhase ?? (() => Effect.void);
      const newBranch = input.newBranch ?? null;
      const refResult = yield* executeGit("GitCore.createDetachedWorktree.resolveRef", input.cwd, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${input.ref}^{commit}`,
      ]);
      const resolvedRef = refResult.stdout.trim();
      if (input.copyChangesFrom) {
        const sourceHead = yield* executeGit(
          "GitCore.createDetachedWorktree.resolveCopySource",
          input.copyChangesFrom,
          ["rev-parse", "--verify", "HEAD^{commit}"],
        ).pipe(Effect.map((result) => result.stdout.trim()));
        if (sourceHead !== resolvedRef) {
          return yield* createGitCommandError(
            "GitCore.createDetachedWorktree",
            input.cwd,
            ["worktree", "add", "--detach", "<path>", input.ref],
            "Cannot copy checkout changes because the selected ref is not that checkout's HEAD.",
          );
        }
      }
      const worktreePath =
        input.path ??
        (yield* buildGeneratedDetachedWorktreePath().pipe(
          Effect.mapError((cause: unknown) =>
            createGitCommandError(
              "GitCore.createDetachedWorktree",
              input.cwd,
              ["worktree", "add", "--detach", "<generated>", input.ref],
              "failed to prepare detached worktree path.",
              cause,
            ),
          ),
        ));

      if (newBranch) {
        yield* onPhase("branch");
        yield* executeGit("GitCore.createDetachedWorktree.createBranch", input.cwd, [
          "branch",
          newBranch,
          resolvedRef,
        ]);
      }
      yield* onPhase("worktree");
      const addWorktree = executeGit(
        "GitCore.createDetachedWorktree",
        input.cwd,
        newBranch
          ? ["worktree", "add", worktreePath, newBranch]
          : ["worktree", "add", "--detach", worktreePath, resolvedRef],
      );
      yield* newBranch
        ? addWorktree.pipe(
            Effect.onError(() =>
              executeGit(
                "GitCore.createDetachedWorktree.rollbackBranch",
                input.cwd,
                ["branch", "-D", newBranch],
                { allowNonZeroExit: true },
              ).pipe(Effect.ignore),
            ),
          )
        : addWorktree;

      if (input.copyChangesFrom) {
        yield* onPhase("copy-changes");
        yield* copyCheckoutChanges(input.copyChangesFrom, worktreePath).pipe(
          Effect.onError(() =>
            executeGit(
              "GitCore.createDetachedWorktree.rollback",
              input.cwd,
              ["worktree", "remove", "--force", worktreePath],
              { allowNonZeroExit: true },
            ).pipe(
              Effect.andThen(
                newBranch
                  ? executeGit(
                      "GitCore.createDetachedWorktree.rollbackBranch",
                      input.cwd,
                      ["branch", "-D", newBranch],
                      { allowNonZeroExit: true },
                    )
                  : Effect.void,
              ),
              Effect.ignore,
            ),
          ),
        );
      }

      return {
        worktree: {
          path: worktreePath,
          ref: resolvedRef,
          branch: newBranch,
        },
      };
    });

  const removeWorktree: GitCoreShape["removeWorktree"] = (input) =>
    Effect.gen(function* () {
      const temporaryBranch = input.reclaimTemporaryBranch
        ? yield* executeGit(
            "GitCore.removeWorktree.readBranch",
            input.path,
            ["symbolic-ref", "--quiet", "--short", "HEAD"],
            { allowNonZeroExit: true, timeoutMs: 5_000 },
          ).pipe(
            Effect.flatMap((result) => {
              if (result.code !== 0) return Effect.succeed(null);
              const branch = result.stdout.trim();
              if (branch.length === 0 || !isTemporaryWorktreeBranch(branch)) {
                return Effect.succeed(null);
              }
              return executeGit(
                "GitCore.removeWorktree.readBranchHead",
                input.path,
                ["rev-parse", "--verify", `refs/heads/${branch}`],
                { timeoutMs: 5_000 },
              ).pipe(Effect.map((head) => ({ branch, head: head.stdout.trim() })));
            }),
            Effect.catch(() => Effect.succeed(null)),
          )
        : null;
      const args = ["worktree", "remove"];
      if (input.force) {
        args.push("--force");
      }
      args.push(input.path);
      yield* executeGit("GitCore.removeWorktree", input.cwd, args, {
        timeoutMs: 15_000,
        fallbackErrorMessage: "git worktree remove failed",
      }).pipe(
        Effect.mapError((error) =>
          createGitCommandError(
            "GitCore.removeWorktree",
            input.cwd,
            args,
            `${commandLabel(args)} failed (cwd: ${input.cwd}): ${error instanceof Error ? error.message : String(error)}`,
            error,
          ),
        ),
      );
      // Drop administrative entries for worktrees whose directories vanished out of band, so stale
      // `.git/worktrees/<name>` metadata cannot pin their branches or confuse later listings. The removal
      // itself already succeeded; a prune failure is logged, never surfaced.
      yield* executeGit("GitCore.removeWorktree.prune", input.cwd, ["worktree", "prune"], {
        timeoutMs: 10_000,
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("worktree removal could not prune stale worktree metadata", {
            cwd: input.cwd,
            path: input.path,
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
        Effect.asVoid,
      );
      if (temporaryBranch !== null) {
        // The removal itself already succeeded; a branch cleanup failure must not surface as a failed
        // removal, but it must be logged — a stranded deterministic branch blocks later reuse of its name.
        yield* executeGit(
          "GitCore.removeWorktree.reclaimBranch",
          input.cwd,
          ["update-ref", "-d", `refs/heads/${temporaryBranch.branch}`, temporaryBranch.head],
          { timeoutMs: 10_000 },
        ).pipe(
          Effect.catch((error) =>
            Effect.logWarning("worktree removal could not reclaim its temporary branch", {
              cwd: input.cwd,
              path: input.path,
              branch: temporaryBranch.branch,
              expectedHead: temporaryBranch.head,
              error: error instanceof Error ? error.message : String(error),
            }),
          ),
          Effect.asVoid,
        );
      }
    });
  return {
    createWorktree,
    recordWorktreeOwnership,
    verifyWorktreeOwnership,
    snapshotWorktree,
    createDetachedWorktree,
    removeWorktree,
  };
});

export const GitWorktreesLive = Layer.effect(GitWorktrees, makeGitWorktrees);
