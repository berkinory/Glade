import {
  prepareScopedRestore,
  validateRestoreConfirmation,
  validateRestorePaths,
} from "../scopedRestore";
import { randomUUID } from "node:crypto";

import { Cause, Deferred, Effect, Exit, Layer, FileSystem, Option, Path, Semaphore } from "effect";

import { CheckpointInvariantError, type CheckpointStoreError } from "../Errors.ts";
import { GitCommandError } from "../../git/Errors.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { CheckpointStore, type CheckpointStoreShape } from "../Services/CheckpointStore.ts";
import { CheckpointRef } from "@glade/contracts/core/baseSchemas";
import { parseCheckpointFilesFromRawNumstat } from "../Diffs.ts";

const CHECKPOINT_DIFF_MAX_OUTPUT_BYTES = 10_000_000;

// Individual git commands are already bounded by GitCore's default timeout; this aggregate cap
// exists to unstick the shared in-flight capture slot if a step without its own bound (e.g.
// temp-dir filesystem work) hangs. It exceeds the worst per-command-capped chain, so it never
// truncates a capture the per-command timeouts would allow.
const CHECKPOINT_CAPTURE_TIMEOUT_MS = 180_000;

const makeCheckpointStore = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitCore;
  const captureLock = yield* Semaphore.make(1);
  const inFlightCaptures = new Map<string, Deferred.Deferred<void, CheckpointStoreError>>();

  const captureKey = (input: { readonly cwd: string; readonly checkpointRef: CheckpointRef }) =>
    `${path.resolve(input.cwd)}\0${input.checkpointRef}`;

  const resolveHeadCommit = (cwd: string): Effect.Effect<string | null, GitCommandError> =>
    git
      .execute({
        operation: "CheckpointStore.resolveHeadCommit",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => {
          if (result.code !== 0) {
            return null;
          }
          const commit = result.stdout.trim();
          return commit.length > 0 ? commit : null;
        }),
      );

  const hasHeadCommit = (cwd: string): Effect.Effect<boolean, GitCommandError> =>
    git
      .execute({
        operation: "CheckpointStore.hasHeadCommit",
        cwd,
        args: ["rev-parse", "--verify", "HEAD"],
        allowNonZeroExit: true,
      })
      .pipe(Effect.map((result) => result.code === 0));

  const seedCheckpointIndex = (cwd: string, tempIndexPath: string) =>
    Effect.gen(function* () {
      const indexPathResult = yield* git.execute({
        operation: "CheckpointStore.resolveWorkingIndex",
        cwd,
        args: ["rev-parse", "--git-path", "index"],
        allowNonZeroExit: true,
      });
      const indexPathRaw = indexPathResult.stdout.trim();
      if (indexPathResult.code !== 0 || indexPathRaw.length === 0) {
        return null;
      }

      const indexPath = path.isAbsolute(indexPathRaw)
        ? indexPathRaw
        : path.resolve(cwd, indexPathRaw);
      const indexExists = yield* fs.exists(indexPath).pipe(Effect.orElseSucceed(() => false));
      if (!indexExists) {
        return null;
      }

      const indexInfo = yield* fs.stat(indexPath);
      yield* fs.copyFile(indexPath, tempIndexPath);
      return indexInfo;
    });

  const resolveCheckpointCommit = (
    cwd: string,
    checkpointRef: CheckpointRef,
  ): Effect.Effect<string | null, GitCommandError> =>
    git
      .execute({
        operation: "CheckpointStore.resolveCheckpointCommit",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", `${checkpointRef}^{commit}`],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => {
          if (result.code !== 0) {
            return null;
          }
          const commit = result.stdout.trim();
          return commit.length > 0 ? commit : null;
        }),
      );

  const isGitRepository: CheckpointStoreShape["isGitRepository"] = (cwd) =>
    git
      .execute({
        operation: "CheckpointStore.isGitRepository",
        cwd,
        args: ["rev-parse", "--is-inside-work-tree"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => result.code === 0 && result.stdout.trim() === "true"),
        Effect.catch(() => Effect.succeed(false)),
      );

  const captureCheckpointOnce: CheckpointStoreShape["captureCheckpoint"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.captureCheckpoint";

      if (input.skipIfExists) {
        const existingCommit = yield* resolveCheckpointCommit(input.cwd, input.checkpointRef);
        if (existingCommit !== null) {
          return;
        }
      }

      yield* Effect.acquireUseRelease(
        fs.makeTempDirectory({ prefix: "glade-fs-checkpoint-" }),
        (tempDir) =>
          Effect.gen(function* () {
            const tempIndexPath = path.join(tempDir, `index-${randomUUID()}`);
            const commitEnv: NodeJS.ProcessEnv = {
              ...process.env,
              GIT_INDEX_FILE: tempIndexPath,
              GIT_AUTHOR_NAME: "Glade",
              GIT_AUTHOR_EMAIL: "glade@users.noreply.github.com",
              GIT_COMMITTER_NAME: "Glade",
              GIT_COMMITTER_EMAIL: "glade@users.noreply.github.com",
            };

            const workingIndexInfo = yield* seedCheckpointIndex(input.cwd, tempIndexPath);
            if (workingIndexInfo === null && (yield* hasHeadCommit(input.cwd))) {
              yield* git.execute({
                operation,
                cwd: input.cwd,
                args: ["read-tree", "HEAD"],
                env: commitEnv,
              });
            }
            if (workingIndexInfo !== null) {
              yield* git.execute({
                operation,
                cwd: input.cwd,
                args: ["update-index", "--really-refresh"],
                env: commitEnv,
                allowNonZeroExit: true,
              });

              if (workingIndexInfo.mtime !== undefined) {
                yield* fs.utimes(
                  tempIndexPath,
                  workingIndexInfo.atime ?? workingIndexInfo.mtime,
                  workingIndexInfo.mtime,
                );
              }
            }

            yield* git.execute({
              operation,
              cwd: input.cwd,
              args: ["add", "-A", "--", "."],
              env: commitEnv,
            });

            const writeTreeResult = yield* git.execute({
              operation,
              cwd: input.cwd,
              args: ["write-tree"],
              env: commitEnv,
            });
            const treeOid = writeTreeResult.stdout.trim();
            if (treeOid.length === 0) {
              return yield* new GitCommandError({
                operation,
                command: "git write-tree",
                cwd: input.cwd,
                detail: "git write-tree returned an empty tree oid.",
              });
            }

            const message = `Glade checkpoint ref=${input.checkpointRef}`;
            const commitTreeResult = yield* git.execute({
              operation,
              cwd: input.cwd,
              args: ["commit-tree", treeOid, "-m", message],
              env: commitEnv,
            });
            const commitOid = commitTreeResult.stdout.trim();
            if (commitOid.length === 0) {
              return yield* new GitCommandError({
                operation,
                command: "git commit-tree",
                cwd: input.cwd,
                detail: "git commit-tree returned an empty commit oid.",
              });
            }

            yield* git.execute({
              operation,
              cwd: input.cwd,
              args: ["update-ref", input.checkpointRef, commitOid],
            });
          }),
        (tempDir) => fs.remove(tempDir, { recursive: true }),
      ).pipe(
        Effect.catchTags({
          PlatformError: (error) =>
            Effect.fail(
              new CheckpointInvariantError({
                operation: "CheckpointStore.captureCheckpoint",
                detail: "Failed to capture checkpoint.",
                cause: error,
              }),
            ),
        }),
      );
    });

  const captureCheckpoint: CheckpointStoreShape["captureCheckpoint"] = (input) =>
    Effect.gen(function* () {
      const key = captureKey(input);
      const registration = yield* captureLock.withPermits(1)(
        Effect.gen(function* () {
          const existing = inFlightCaptures.get(key);
          if (existing) {
            return { owner: false as const, deferred: existing };
          }
          const deferred = yield* Deferred.make<void, CheckpointStoreError>();
          inFlightCaptures.set(key, deferred);
          return { owner: true as const, deferred };
        }),
      );

      if (!registration.owner) {
        return yield* Deferred.await(registration.deferred);
      }

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            restore(
              captureCheckpointOnce(input).pipe(
                Effect.timeoutOption(CHECKPOINT_CAPTURE_TIMEOUT_MS),
                Effect.flatMap((completed) =>
                  Option.isSome(completed)
                    ? Effect.void
                    : Effect.fail(
                        new CheckpointInvariantError({
                          operation: "CheckpointStore.captureCheckpoint",
                          detail: `Checkpoint capture timed out after ${CHECKPOINT_CAPTURE_TIMEOUT_MS}ms.`,
                        }),
                      ),
                ),
              ),
            ),
          );

          const waiterExit =
            Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
              ? Exit.fail(
                  new CheckpointInvariantError({
                    operation: "CheckpointStore.captureCheckpoint",
                    detail: "Checkpoint capture was interrupted before completion.",
                  }),
                )
              : exit;
          yield* Deferred.done(registration.deferred, waiterExit);
          yield* captureLock.withPermits(1)(Effect.sync(() => inFlightCaptures.delete(key)));
          if (Exit.isFailure(exit)) {
            return yield* Effect.failCause(exit.cause);
          }
        }),
      );
    });

  const hasCheckpointRef: CheckpointStoreShape["hasCheckpointRef"] = (input) =>
    resolveCheckpointCommit(input.cwd, input.checkpointRef).pipe(
      Effect.map((commit) => commit !== null),
    );

  const copyCheckpointRef: CheckpointStoreShape["copyCheckpointRef"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.copyCheckpointRef";
      const commitOid = yield* resolveCheckpointCommit(input.cwd, input.fromCheckpointRef);
      if (!commitOid) {
        return false;
      }

      yield* git.execute({
        operation,
        cwd: input.cwd,
        args: ["update-ref", input.toCheckpointRef, commitOid],
      });
      return true;
    });

  const previewScopedRestore: CheckpointStoreShape["previewScopedRestore"] = (input) =>
    prepareScopedRestore(input, { git, fs, path, resolveCommit: resolveCheckpointCommit }).pipe(
      Effect.map(({ fingerprint, files }) => ({ fingerprint, files })),
    );
  const restoreScopedCheckpoint: CheckpointStoreShape["restoreScopedCheckpoint"] = (input) =>
    Effect.gen(function* () {
      const plan = yield* prepareScopedRestore(input, {
        git,
        fs,
        path,
        resolveCommit: resolveCheckpointCommit,
      });
      yield* validateRestoreConfirmation(plan, input.confirmation);
      for (const restore of plan.restores) {
        yield* restoreWorktreePathsFromTree({
          cwd: input.cwd,
          treeOid: restore.treeOid,
          paths: [restore.path],
        });
      }
    }).pipe(
      Effect.catchTag("PlatformError", (cause) =>
        Effect.fail(
          new CheckpointInvariantError({
            operation: "restoreScopedCheckpoint",
            detail: "Failed to restore scoped files.",
            cause,
          }),
        ),
      ),
    );

  const resolveDiffCommits = (
    operation: string,
    input: {
      readonly cwd: string;
      readonly fromCheckpointRef: CheckpointRef;
      readonly toCheckpointRef: CheckpointRef;
      readonly fallbackFromToHead?: boolean;
    },
  ) =>
    Effect.gen(function* () {
      let [fromCommitOid, toCommitOid] = yield* Effect.all(
        [
          resolveCheckpointCommit(input.cwd, input.fromCheckpointRef),
          resolveCheckpointCommit(input.cwd, input.toCheckpointRef),
        ],
        { concurrency: "unbounded" },
      );

      if (!fromCommitOid && input.fallbackFromToHead === true) {
        const headCommit = yield* resolveHeadCommit(input.cwd);
        if (headCommit) {
          fromCommitOid = headCommit;
        }
      }

      if (!fromCommitOid || !toCommitOid) {
        return yield* new GitCommandError({
          operation,
          command: "git diff",
          cwd: input.cwd,
          detail: "Checkpoint ref is unavailable for diff operation.",
        });
      }
      return [fromCommitOid, toCommitOid] as const;
    });

  const diffCheckpoints: CheckpointStoreShape["diffCheckpoints"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.diffCheckpoints";
      const [fromCommitOid, toCommitOid] = yield* resolveDiffCommits(operation, input);

      const result = yield* git.execute({
        operation,
        cwd: input.cwd,
        args: [
          "diff",
          "--patch",
          "--minimal",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          ...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
          fromCommitOid,
          toCommitOid,
        ],
        maxOutputBytes: input.maxOutputBytes ?? CHECKPOINT_DIFF_MAX_OUTPUT_BYTES,
      });

      return result.stdout;
    });

  // Rename detection follows the same `git diff` defaults as diffCheckpoints, and `--minimal` keeps
  // the line counts identical to the patch the UI renders.
  const summarizeCheckpointDiff: CheckpointStoreShape["summarizeCheckpointDiff"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.summarizeCheckpointDiff";
      const [fromCommitOid, toCommitOid] = yield* resolveDiffCommits(operation, input);

      const result = yield* git.execute({
        operation,
        cwd: input.cwd,
        args: [
          "diff",
          "--raw",
          "--numstat",
          "-z",
          "--minimal",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          fromCommitOid,
          toCommitOid,
        ],
        maxOutputBytes: CHECKPOINT_DIFF_MAX_OUTPUT_BYTES,
      });

      return parseCheckpointFilesFromRawNumstat(result.stdout);
    });

  // Rolls the working tree back to `treeOid` for the provided paths without touching the repository
  // index: paths absent from the tree did not exist before the aborted apply, so they are deleted
  // instead of restored.
  const restoreWorktreePathsFromTree = (input: {
    readonly cwd: string;
    readonly treeOid: string;
    readonly paths: ReadonlyArray<string>;
  }) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.restoreWorktreePathsFromTree";
      if (input.paths.length === 0) {
        return;
      }

      yield* validateRestorePaths(input.cwd, input.paths, { fs, path });
      const env = { ...process.env, GIT_LITERAL_PATHSPECS: "1" };
      const trackedResult = yield* git.execute({
        env,
        operation,
        cwd: input.cwd,
        args: ["ls-tree", "-r", "--name-only", "-z", input.treeOid, "--", ...input.paths],
        allowNonZeroExit: true,
      });
      const trackedPaths = trackedResult.stdout.split("\0").filter((entry) => entry.length > 0);
      if (trackedPaths.length > 0) {
        yield* git.execute({
          operation,
          cwd: input.cwd,
          args: ["restore", "--source", input.treeOid, "--worktree", "--", ...trackedPaths],
          env,
        });
      }

      const trackedPathSet = new Set(trackedPaths);
      yield* Effect.forEach(
        input.paths.filter((entry) => !trackedPathSet.has(entry)),
        (relativePath) => fs.remove(path.join(input.cwd, relativePath), { force: true }),
        { discard: true },
      );
    });

  const deleteCheckpointRefs: CheckpointStoreShape["deleteCheckpointRefs"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.deleteCheckpointRefs";

      // Ref deletion writes contend on packed-refs.lock, so a concurrent delete can lose the lock race.
      // `allowNonZeroExit` keeps one loser from abandoning the rest of the batch, but the exit codes must
      // still be inspected: silently discarding them made every caller's cleanup error handling
      // unreachable. Deleting an already-absent ref exits 0, so the "missing refs are tolerated" contract
      // is unaffected.
      const results = yield* Effect.forEach(input.checkpointRefs, (checkpointRef) =>
        git
          .execute({
            operation,
            cwd: input.cwd,
            args: ["update-ref", "-d", checkpointRef],
            allowNonZeroExit: true,
          })
          .pipe(Effect.map((result) => ({ checkpointRef, result }))),
      );

      const failures = results.filter((entry) => entry.result.code !== 0);
      if (failures.length === 0) {
        return;
      }

      return yield* new GitCommandError({
        operation,
        command: "git update-ref -d",
        cwd: input.cwd,
        detail: `Failed to delete ${failures.length} of ${results.length} checkpoint ref(s): ${failures
          .map(
            (entry) =>
              `${entry.checkpointRef} (${entry.result.stderr.trim() || `exit code ${entry.result.code}`})`,
          )
          .join("; ")}`,
      });
    });

  return {
    isGitRepository,
    captureCheckpoint,
    copyCheckpointRef,
    hasCheckpointRef,
    previewScopedRestore,
    restoreScopedCheckpoint,
    diffCheckpoints,
    summarizeCheckpointDiff,
    deleteCheckpointRefs,
  } satisfies CheckpointStoreShape;
});

export const CheckpointStoreLive = Layer.effect(CheckpointStore, makeCheckpointStore);
