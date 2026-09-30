import { Effect, FileSystem, Layer, Semaphore } from "effect";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { isWorkspaceRelativePathSafe } from "@glade/shared/platform/path";

import { GitCommandError } from "../Errors.ts";
import { GitCore, type GitCommitOptions, type GitCoreShape } from "../Services/GitCore.ts";
import { GitCommands } from "../Services/GitCommands.ts";
import { GitStatus } from "../Services/GitStatus.ts";
import { GitDiff } from "../Services/GitDiff.ts";
import { GitWorktrees } from "../Services/GitWorktrees.ts";
import { GitRefs } from "../Services/GitRefs.ts";
import { GitBranches } from "../Services/GitBranches.ts";
import { GitBranchesLive } from "./GitBranches.ts";
import { GitRefsLive } from "./GitRefs.ts";
import { GitWorktreesLive } from "./GitWorktrees.ts";
import { GitDiffLive } from "./GitDiff.ts";
import { GitStatusLive } from "./GitStatus.ts";
import { GitCommandsLive, createGitCommandError } from "./GitCommands.ts";
const MAX_QUEUED_REPOSITORY_MUTATIONS = 64;

const makeGitCore = () =>
  Effect.gen(function* () {
    const {
      pushCurrentBranch,
      pullCurrentBranch,
      fetchPullRequestBranch,
      fetchPullRequestCommit,
      ensureRemote,
      fetchRemoteBranch,
      setBranchUpstream,
      deleteBranch,
      deleteBranchIfUnchanged,
      renameBranch,
      createBranch,
      publishBranch,
      checkoutBranch,
      stashAndCheckout,
      stashDrop,
      stashInfo,
    } = yield* GitBranches;
    const {
      readRangeContext,
      readConfigValue,
      listBranches,
      listRecentCommits,
      readCommit,
      listLocalBranchNames,
    } = yield* GitRefs;
    const {
      createWorktree,
      recordWorktreeOwnership,
      verifyWorktreeOwnership,
      snapshotWorktree,
      createDetachedWorktree,
      removeWorktree,
    } = yield* GitWorktrees;
    const {
      readWorkingTreePatch,
      readUnstagedPatch,
      readStagedPatch,
      readSourceControlFiles,
      readBranchPatch,
      blameLine,
      readFileAtRev,
      readRefPatch,
      readDiffStats,
    } = yield* GitDiff;
    const { status, statusDetails, readBranchContext } = yield* GitStatus;
    const fileSystem = yield* FileSystem.FileSystem;

    const { execute, executeGit, runGit, runGitStdout } = yield* GitCommands;

    const repositoryMutationLocks = new Map<string, Semaphore.Semaphore>();
    const repositoryMutationCounts = new Map<string, number>();
    const repositoryMutationMapLock = yield* Semaphore.make(1);
    const resolveRepositoryMutationKey = (cwd: string) =>
      executeGit("GitCore.withMutation.commonDir", cwd, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((commonDir) =>
          Effect.tryPromise(() => nodeFs.realpath(nodePath.resolve(cwd, commonDir))),
        ),
        Effect.catch(() =>
          Effect.tryPromise(() => nodeFs.realpath(cwd)).pipe(
            Effect.catch(() => Effect.succeed(nodePath.resolve(cwd))),
          ),
        ),
      );
    const withMutation: GitCoreShape["withMutation"] = (cwd, effect) =>
      Effect.gen(function* () {
        const key = yield* resolveRepositoryMutationKey(cwd);
        const lock = yield* repositoryMutationMapLock.withPermit(
          Effect.gen(function* () {
            const count = repositoryMutationCounts.get(key) ?? 0;
            if (count >= MAX_QUEUED_REPOSITORY_MUTATIONS) {
              return yield* new GitCommandError({
                operation: "GitCore.withMutation",
                command: "repository mutation queue",
                cwd,
                detail: "Repository mutation queue is full.",
              });
            }
            let existing = repositoryMutationLocks.get(key);
            if (!existing) {
              existing = yield* Semaphore.make(1);
              repositoryMutationLocks.set(key, existing);
            }
            repositoryMutationCounts.set(key, count + 1);
            return existing;
          }),
        );
        return yield* lock.withPermit(effect).pipe(
          Effect.ensuring(
            repositoryMutationMapLock.withPermit(
              Effect.sync(() => {
                const remaining = (repositoryMutationCounts.get(key) ?? 1) - 1;
                if (remaining <= 0) {
                  repositoryMutationCounts.delete(key);
                  repositoryMutationLocks.delete(key);
                } else {
                  repositoryMutationCounts.set(key, remaining);
                }
              }),
            ),
          ),
        );
      });

    const prepareCommitContext: GitCoreShape["prepareCommitContext"] = (cwd, filePaths) =>
      Effect.gen(function* () {
        if (filePaths && filePaths.length > 0) {
          yield* runGit("GitCore.prepareCommitContext.reset", cwd, ["reset"]).pipe(
            Effect.catch(() => Effect.void),
          );
          yield* runGit("GitCore.prepareCommitContext.addSelected", cwd, [
            "add",
            "-A",
            "--",
            ...filePaths,
          ]);
        } else {
          yield* runGit("GitCore.prepareCommitContext.addAll", cwd, ["add", "-A"]);
        }

        const stagedSummary = yield* runGitStdout(
          "GitCore.prepareCommitContext.stagedSummary",
          cwd,
          ["diff", "--cached", "--name-status"],
        ).pipe(Effect.map((stdout) => stdout.trim()));
        if (stagedSummary.length === 0) {
          return null;
        }

        const stagedPatch = yield* runGitStdout("GitCore.prepareCommitContext.stagedPatch", cwd, [
          "diff",
          "--cached",
          "--patch",
          "--minimal",
        ]);

        return {
          stagedSummary,
          stagedPatch,
        };
      });

    const commit: GitCoreShape["commit"] = (cwd, subject, body, options?: GitCommitOptions) =>
      Effect.gen(function* () {
        const args = ["commit", "-m", subject];
        const trimmedBody = body.trim();
        if (trimmedBody.length > 0) {
          args.push("-m", trimmedBody);
        }
        const progress = options?.progress
          ? {
              ...(options.progress.onOutputLine
                ? {
                    onStdoutLine: (line: string) =>
                      options.progress?.onOutputLine?.({ stream: "stdout", text: line }) ??
                      Effect.void,
                    onStderrLine: (line: string) =>
                      options.progress?.onOutputLine?.({ stream: "stderr", text: line }) ??
                      Effect.void,
                  }
                : {}),
              ...(options.progress.onHookStarted
                ? { onHookStarted: options.progress.onHookStarted }
                : {}),
              ...(options.progress.onHookFinished
                ? { onHookFinished: options.progress.onHookFinished }
                : {}),
            }
          : null;
        yield* executeGit("GitCore.commit.commit", cwd, args, {
          ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          ...(progress ? { progress } : {}),
        }).pipe(Effect.asVoid);
        const commitSha = yield* runGitStdout("GitCore.commit.revParseHead", cwd, [
          "rev-parse",
          "HEAD",
        ]).pipe(Effect.map((stdout) => stdout.trim()));

        return { commitSha };
      });

    const removeIndexLock: GitCoreShape["removeIndexLock"] = (input) =>
      Effect.gen(function* () {
        const lockPathOutput = yield* runGitStdout(
          "GitCore.removeIndexLock.resolvePath",
          input.cwd,
          ["rev-parse", "--git-path", "index.lock"],
        );
        const rawLockPath = lockPathOutput.trim();
        if (rawLockPath.length === 0 || nodePath.basename(rawLockPath) !== "index.lock") {
          return yield* createGitCommandError(
            "GitCore.removeIndexLock",
            input.cwd,
            ["rev-parse", "--git-path", "index.lock"],
            "Git did not return a valid index lock path.",
          );
        }

        const lockPath = nodePath.isAbsolute(rawLockPath)
          ? rawLockPath
          : nodePath.resolve(input.cwd, rawLockPath);
        yield* fileSystem
          .remove(lockPath)
          .pipe(
            Effect.mapError((cause) =>
              createGitCommandError(
                "GitCore.removeIndexLock",
                input.cwd,
                ["rm", lockPath],
                cause.message,
                cause,
              ),
            ),
          );
      });

    const initRepo: GitCoreShape["initRepo"] = (input) =>
      executeGit("GitCore.initRepo", input.cwd, ["init"], {
        timeoutMs: 10_000,
        fallbackErrorMessage: "git init failed",
      }).pipe(Effect.asVoid);

    const stageFiles: GitCoreShape["stageFiles"] = (cwd, paths) =>
      runGit("GitCore.stageFiles", cwd, ["add", "--", ...paths]);

    const revertUnstagedFile: GitCoreShape["revertUnstagedFile"] = (cwd, filePath) =>
      Effect.gen(function* () {
        const operation = "GitCore.revertUnstagedFile";
        if (!isWorkspaceRelativePathSafe(filePath) || filePath.includes("\0")) {
          return yield* createGitCommandError(
            operation,
            cwd,
            ["restore"],
            "File path must be a workspace-relative file path.",
          );
        }
        const pathspec = `:(literal)${filePath}`;
        const status = yield* runGitStdout(operation, cwd, [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--",
          pathspec,
        ]);
        const record = status.split("\0").find((entry) => entry.slice(3) === filePath);
        const code = record?.slice(0, 2);
        if (
          !code ||
          (code !== "??" && ![" M", " D", " T", "MM", "AM", "MD", "MT"].includes(code))
        ) {
          return yield* createGitCommandError(
            operation,
            cwd,
            ["status", "--", pathspec],
            "This file has no supported unstaged change to revert.",
          );
        }
        if (code === "??") {
          yield* Effect.tryPromise({
            try: () => nodeFs.unlink(nodePath.join(cwd, filePath)),
            catch: (cause) =>
              createGitCommandError(operation, cwd, ["unlink", "--", filePath], String(cause)),
          });
        } else {
          yield* runGit(operation, cwd, ["restore", "--worktree", "--", pathspec]);
        }
      });

    const unstageFiles: GitCoreShape["unstageFiles"] = (cwd, paths) =>
      Effect.gen(function* () {
        const headExists = yield* executeGit(
          "GitCore.unstageFiles.headExists",
          cwd,
          ["rev-parse", "--verify", "HEAD"],
          { allowNonZeroExit: true },
        ).pipe(Effect.map((result) => result.code === 0));

        yield* runGit(
          "GitCore.unstageFiles",
          cwd,
          headExists
            ? ["reset", "-q", "HEAD", "--", ...paths]
            : ["rm", "--cached", "-q", "--", ...paths],
        );
      });

    return {
      withMutation,
      execute,
      status,
      statusDetails,
      readBranchContext,
      readWorkingTreePatch,
      readUnstagedPatch,
      readStagedPatch,
      readSourceControlFiles,
      readBranchPatch,
      blameLine,
      readFileAtRev,
      readRefPatch,
      readDiffStats,
      prepareCommitContext,
      commit,
      pushCurrentBranch,
      pullCurrentBranch,
      readRangeContext,
      readConfigValue,
      listBranches,
      listRecentCommits,
      readCommit,
      createWorktree,
      recordWorktreeOwnership,
      verifyWorktreeOwnership,
      snapshotWorktree,
      createDetachedWorktree,
      fetchPullRequestBranch,
      fetchPullRequestCommit,
      ensureRemote,
      fetchRemoteBranch,
      setBranchUpstream,
      removeWorktree,
      deleteBranch,
      deleteBranchIfUnchanged,
      renameBranch,
      createBranch,
      publishBranch,
      checkoutBranch,
      stashAndCheckout,
      stashDrop,
      stashInfo,
      removeIndexLock,
      initRepo,
      listLocalBranchNames,
      stageFiles,
      revertUnstagedFile,
      unstageFiles,
    } satisfies GitCoreShape;
  });

export const GitCoreLive = Layer.effect(GitCore, makeGitCore()).pipe(
  Layer.provide(
    Layer.mergeAll(GitWorktreesLive, GitRefsLive, GitDiffLive, GitBranchesLive).pipe(
      Layer.provideMerge(GitStatusLive),
      Layer.provideMerge(GitCommandsLive),
    ),
  ),
);
