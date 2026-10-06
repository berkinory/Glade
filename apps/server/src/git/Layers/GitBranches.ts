import { synchronizePush } from "../pushSynchronization";
import { Effect, Exit, Layer } from "effect";
import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@glade/shared/git/githubRepository";
import { GitCheckoutDirtyWorktreeError, GitCommandError } from "../Errors.ts";
import type { GitCoreShape } from "../Services/GitCore.ts";
import { GIT_WRITE_EXECUTION, GitCommands } from "../Services/GitCommands.ts";
import { GitStatus } from "../Services/GitStatus.ts";
import { GitBranches } from "../Services/GitBranches.ts";
import { commandLabel, createGitCommandError } from "./GitCommands.ts";

function sanitizeRemoteName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "fork";
}

function normalizeRemoteUrl(value: string): string {
  return value
    .trim()
    .replace(/\/+$/g, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function parseRemoteFetchUrls(stdout: string): Map<string, string> {
  const remotes = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(trimmed);
    if (!match) continue;
    const [, remoteName = "", remoteUrl = "", direction = ""] = match;
    if (direction !== "fetch" || remoteName.length === 0 || remoteUrl.length === 0) {
      continue;
    }
    remotes.set(remoteName, remoteUrl);
  }
  return remotes;
}

function parseTrackingBranchByUpstreamRef(stdout: string, upstreamRef: string): string | null {
  for (const line of stdout.split("\n")) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      continue;
    }
    const [branchNameRaw, upstreamBranchRaw = ""] = trimmedLine.split("\t");
    const branchName = branchNameRaw?.trim() ?? "";
    const upstreamBranch = upstreamBranchRaw.trim();
    if (branchName.length === 0 || upstreamBranch.length === 0) {
      continue;
    }
    if (upstreamBranch === upstreamRef) {
      return branchName;
    }
  }

  return null;
}

function deriveLocalBranchNameFromRemoteRef(branchName: string): string | null {
  const separatorIndex = branchName.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === branchName.length - 1) {
    return null;
  }
  const localBranch = branchName.slice(separatorIndex + 1).trim();
  return localBranch.length > 0 ? localBranch : null;
}

const DIRTY_WORKTREE_PATTERN =
  /Your local changes to the following files would be overwritten by (?:checkout|merge):\s*([\s\S]*?)Please commit your changes or stash them/;

const UNTRACKED_OVERWRITE_PATTERN =
  /The following untracked working tree files would be overwritten by (?:checkout|merge):\s*([\s\S]*?)Please move or remove them/;

function parseDirtyWorktreeFiles(stderr: string): string[] | null {
  const match = DIRTY_WORKTREE_PATTERN.exec(stderr) ?? UNTRACKED_OVERWRITE_PATTERN.exec(stderr);
  if (!match?.[1]) return null;
  const files = match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return files.length > 0 ? files : null;
}

function explainPullBlockedByLocalChanges(error: GitCommandError): string | null {
  const files = parseDirtyWorktreeFiles(error.detail);
  if (!files) return null;
  const fileList = files.map((file) => `  - ${file}`).join("\n");
  return `Local changes block pull. Commit or stash these files first:\n${fileList}`;
}

function parseNonEmptyLineList(input: string): string[] {
  return input
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

type StashEntry = {
  ref: string;
  hash: string;
};

function parseStashEntries(input: string): StashEntry[] {
  return parseNonEmptyLineList(input).flatMap((line) => {
    const [ref, hash] = line.split(" ");
    return ref && hash ? [{ ref, hash }] : [];
  });
}

const makeGitBranches = Effect.gen(function* () {
  const { execute, executeGit, runGit, runGitStdout } = yield* GitCommands;
  const {
    branchExists,
    resolveCurrentUpstream,
    refreshCheckedOutBranchUpstream,
    resolvePrimaryRemoteName,
    statusDetails,
  } = yield* GitStatus;
  const listStashEntries = (
    operation: string,
    cwd: string,
  ): Effect.Effect<StashEntry[], GitCommandError> =>
    executeGit(operation, cwd, ["stash", "list", "--format=%gd %H"], {
      timeoutMs: 10_000,
    }).pipe(Effect.map((result) => parseStashEntries(result.stdout)));

  const dropStashByHash = (cwd: string, hash: string): Effect.Effect<void, GitCommandError> =>
    Effect.gen(function* () {
      const entries = yield* listStashEntries("GitCore.dropStashByHash.list", cwd);
      const entry = entries.find((candidate) => candidate.hash === hash);
      if (!entry) return;
      yield* executeGit("GitCore.dropStashByHash.drop", cwd, ["stash", "drop", entry.ref], {
        timeoutMs: 10_000,
        fallbackErrorMessage: "git stash drop failed",
      });
    });

  const resolveAvailableBranchName = (
    cwd: string,
    desiredBranch: string,
  ): Effect.Effect<string, GitCommandError> =>
    Effect.gen(function* () {
      const isDesiredTaken = yield* branchExists(cwd, desiredBranch);
      if (!isDesiredTaken) {
        return desiredBranch;
      }

      for (let suffix = 1; suffix <= 100; suffix += 1) {
        const candidate = `${desiredBranch}-${suffix}`;
        const isCandidateTaken = yield* branchExists(cwd, candidate);
        if (!isCandidateTaken) {
          return candidate;
        }
      }

      return yield* createGitCommandError(
        "GitCore.renameBranch",
        cwd,
        ["branch", "-m", "--", desiredBranch],
        `Could not find an available branch name for '${desiredBranch}'.`,
      );
    });

  const resolvePushRemoteName = (
    cwd: string,
    branch: string,
  ): Effect.Effect<string | null, GitCommandError> =>
    Effect.gen(function* () {
      const branchPushRemote = yield* runGitStdout(
        "GitCore.resolvePushRemoteName.branchPushRemote",
        cwd,
        ["config", "--get", `branch.${branch}.pushRemote`],
        true,
      ).pipe(Effect.map((stdout) => stdout.trim()));
      if (branchPushRemote.length > 0) {
        return branchPushRemote;
      }

      const pushDefaultRemote = yield* runGitStdout(
        "GitCore.resolvePushRemoteName.remotePushDefault",
        cwd,
        ["config", "--get", "remote.pushDefault"],
        true,
      ).pipe(Effect.map((stdout) => stdout.trim()));
      if (pushDefaultRemote.length > 0) {
        return pushDefaultRemote;
      }

      return yield* resolvePrimaryRemoteName(cwd).pipe(Effect.catch(() => Effect.succeed(null)));
    });

  const ensureRemote: GitCoreShape["ensureRemote"] = (input) =>
    Effect.gen(function* () {
      const preferredName = sanitizeRemoteName(input.preferredName);
      const normalizedTargetUrl = normalizeRemoteUrl(input.url);
      const remoteFetchUrls = yield* runGitStdout(
        "GitCore.ensureRemote.listRemoteUrls",
        input.cwd,
        ["remote", "-v"],
      ).pipe(Effect.map((stdout) => parseRemoteFetchUrls(stdout)));

      for (const [remoteName, remoteUrl] of remoteFetchUrls.entries()) {
        if (normalizeRemoteUrl(remoteUrl) === normalizedTargetUrl) {
          return remoteName;
        }
      }

      let remoteName = preferredName;
      let suffix = 1;
      while (remoteFetchUrls.has(remoteName)) {
        remoteName = `${preferredName}-${suffix}`;
        suffix += 1;
      }

      yield* runGit("GitCore.ensureRemote.add", input.cwd, [
        "remote",
        "add",
        remoteName,
        input.url,
      ]);
      return remoteName;
    });

  const pushCurrentBranch: GitCoreShape["pushCurrentBranch"] = (
    cwd,
    _fallbackBranch,
    allowIntegration = true,
  ) =>
    Effect.gen(function* () {
      const branch = (yield* runGitStdout("push", cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
      const upstream = yield* resolveCurrentUpstream(cwd);
      const configuredUpstream = (yield* runGitStdout(
        "push",
        cwd,
        ["config", "--get", `branch.${branch}.merge`],
        true,
      )).trim();
      if (!upstream && configuredUpstream)
        return yield* createGitCommandError(
          "push",
          cwd,
          ["push"],
          "The configured upstream is unavailable. Fetch or repair the upstream configuration before pushing.",
        );
      const configuredRemote =
        (yield* runGitStdout(
          "push",
          cwd,
          ["config", "--get", `branch.${branch}.pushRemote`],
          true,
        )).trim() ||
        (yield* runGitStdout("push", cwd, ["config", "--get", "remote.pushDefault"], true)).trim();
      if (upstream && configuredRemote && configuredRemote !== upstream.remoteName)
        return yield* createGitCommandError(
          "push",
          cwd,
          ["push"],
          "Push remote differs from upstream. Configure matching destinations before automatic synchronization.",
        );
      const remote = upstream?.remoteName ?? (yield* resolvePushRemoteName(cwd, branch));
      if (!remote)
        return yield* createGitCommandError("push", cwd, ["push"], "No remote is configured.");
      return yield* synchronizePush(
        {
          cwd,
          branch,
          remote,
          target: upstream?.upstreamBranch ?? branch,
          hasUpstream: upstream !== null,
          allowIntegration,
        },
        execute,
      );
    });

  const pullCurrentBranch: GitCoreShape["pullCurrentBranch"] = (cwd) =>
    Effect.gen(function* () {
      const details = yield* statusDetails(cwd);
      const branch = details.branch;
      if (!branch) {
        return yield* createGitCommandError(
          "GitCore.pullCurrentBranch",
          cwd,
          ["pull", "--ff-only"],
          "Cannot pull from detached HEAD.",
        );
      }
      if (!details.hasUpstream) {
        return yield* createGitCommandError(
          "GitCore.pullCurrentBranch",
          cwd,
          ["pull", "--ff-only"],
          "Current branch has no upstream configured. Push with upstream first.",
        );
      }
      const beforeSha = yield* runGitStdout(
        "GitCore.pullCurrentBranch.beforeSha",
        cwd,
        ["rev-parse", "HEAD"],
        true,
      ).pipe(Effect.map((stdout) => stdout.trim()));
      yield* executeGit("GitCore.pullCurrentBranch.pull", cwd, ["pull", "--ff-only"], {
        ...GIT_WRITE_EXECUTION,
        fallbackErrorMessage: "git pull failed",
      }).pipe(
        Effect.mapError((error) => {
          const friendlyDetail = explainPullBlockedByLocalChanges(error);
          if (!friendlyDetail) return error;
          return createGitCommandError(
            "GitCore.pullCurrentBranch.pull",
            cwd,
            ["pull", "--ff-only"],
            friendlyDetail,
            error,
          );
        }),
      );
      const afterSha = yield* runGitStdout(
        "GitCore.pullCurrentBranch.afterSha",
        cwd,
        ["rev-parse", "HEAD"],
        true,
      ).pipe(Effect.map((stdout) => stdout.trim()));

      const refreshed = yield* statusDetails(cwd);
      return {
        status: beforeSha.length > 0 && beforeSha === afterSha ? "skipped_up_to_date" : "pulled",
        branch,
        upstreamBranch: refreshed.upstreamRef,
      };
    });

  const fetchPullRequestBranch: GitCoreShape["fetchPullRequestBranch"] = (input) =>
    Effect.gen(function* () {
      const remoteName = yield* resolvePrimaryRemoteName(input.cwd);
      yield* executeGit(
        "GitCore.fetchPullRequestBranch",
        input.cwd,
        [
          "fetch",
          "--quiet",
          "--no-tags",
          remoteName,
          `+refs/pull/${input.prNumber}/head:refs/heads/${input.branch}`,
        ],
        {
          fallbackErrorMessage: "git fetch pull request branch failed",
        },
      );
    }).pipe(Effect.asVoid);

  const fetchPullRequestCommit: GitCoreShape["fetchPullRequestCommit"] = (input) =>
    Effect.gen(function* () {
      const remoteName = yield* resolvePrimaryRemoteName(input.cwd);
      if (input.expectedRepositoryNameWithOwner) {
        const remoteUrl = yield* runGitStdout(
          "GitCore.fetchPullRequestCommit.remoteUrl",
          input.cwd,
          ["remote", "get-url", remoteName],
        );
        const actualRepositoryNameWithOwner =
          parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remoteUrl);
        if (
          actualRepositoryNameWithOwner?.toLowerCase() !==
          input.expectedRepositoryNameWithOwner.toLowerCase()
        ) {
          return yield* createGitCommandError(
            "GitCore.fetchPullRequestCommit.remoteMismatch",
            input.cwd,
            ["remote", "get-url", remoteName],
            `Pull request URL targets ${input.expectedRepositoryNameWithOwner}, but remote ${remoteName} targets ${actualRepositoryNameWithOwner ?? "a non-GitHub repository"}.`,
          );
        }
      }
      yield* executeGit(
        "GitCore.fetchPullRequestCommit",
        input.cwd,
        ["fetch", "--quiet", "--no-tags", remoteName, `refs/pull/${input.prNumber}/head`],
        { fallbackErrorMessage: "git fetch pull request head failed" },
      );
      return yield* executeGit("GitCore.fetchPullRequestCommit.resolve", input.cwd, [
        "rev-parse",
        "--verify",
        "FETCH_HEAD^{commit}",
      ]).pipe(Effect.map((result) => result.stdout.trim()));
    });

  const fetchRemoteBranch: GitCoreShape["fetchRemoteBranch"] = (input) =>
    Effect.gen(function* () {
      yield* runGit("GitCore.fetchRemoteBranch.fetch", input.cwd, [
        "fetch",
        "--quiet",
        "--no-tags",
        input.remoteName,
        `+refs/heads/${input.remoteBranch}:refs/remotes/${input.remoteName}/${input.remoteBranch}`,
      ]);

      const localBranchAlreadyExists = yield* branchExists(input.cwd, input.localBranch);
      const targetRef = `${input.remoteName}/${input.remoteBranch}`;
      yield* runGit(
        "GitCore.fetchRemoteBranch.materialize",
        input.cwd,
        localBranchAlreadyExists
          ? ["branch", "--force", input.localBranch, targetRef]
          : ["branch", input.localBranch, targetRef],
      );
    }).pipe(Effect.asVoid);

  const setBranchUpstream: GitCoreShape["setBranchUpstream"] = (input) =>
    runGit("GitCore.setBranchUpstream", input.cwd, [
      "branch",
      "--set-upstream-to",
      `${input.remoteName}/${input.remoteBranch}`,
      input.branch,
    ]);

  const deleteBranch: GitCoreShape["deleteBranch"] = (input) =>
    Effect.gen(function* () {
      const args = ["branch", input.force ? "-D" : "-d", "--", input.branch];
      yield* executeGit("GitCore.deleteBranch", input.cwd, args, {
        timeoutMs: 10_000,
        fallbackErrorMessage: "git branch delete failed",
      }).pipe(
        Effect.mapError((error) =>
          createGitCommandError(
            "GitCore.deleteBranch",
            input.cwd,
            args,
            `${commandLabel(args)} failed (cwd: ${input.cwd}): ${error instanceof Error ? error.message : String(error)}`,
            error,
          ),
        ),
      );
    });

  const deleteBranchIfUnchanged: GitCoreShape["deleteBranchIfUnchanged"] = (input) =>
    executeGit("GitCore.deleteBranchIfUnchanged", input.cwd, [
      "update-ref",
      "-d",
      `refs/heads/${input.branch}`,
      input.expectedHead,
    ]).pipe(Effect.asVoid);

  const renameBranch: GitCoreShape["renameBranch"] = (input) =>
    Effect.gen(function* () {
      if (input.oldBranch === input.newBranch) {
        return { branch: input.newBranch };
      }
      const targetBranch = yield* resolveAvailableBranchName(input.cwd, input.newBranch);

      yield* executeGit(
        "GitCore.renameBranch",
        input.cwd,
        ["branch", "-m", "--", input.oldBranch, targetBranch],
        {
          timeoutMs: 10_000,
          fallbackErrorMessage: "git branch rename failed",
        },
      );

      return { branch: targetBranch };
    });

  const publishBranch: GitCoreShape["publishBranch"] = (input) =>
    Effect.gen(function* () {
      const remoteName = yield* resolvePushRemoteName(input.cwd, input.branch);
      if (!remoteName) {
        return yield* createGitCommandError(
          "GitCore.publishBranch",
          input.cwd,
          ["push", "-u", "<remote>", input.branch],
          "Cannot publish branch because no git remote is configured for this repository.",
        );
      }
      yield* executeGit(
        "GitCore.publishBranch",
        input.cwd,
        ["push", "-u", remoteName, input.branch],
        {
          ...GIT_WRITE_EXECUTION,
          fallbackErrorMessage: "git branch publish failed",
        },
      );
    }).pipe(Effect.asVoid);

  const createBranch: GitCoreShape["createBranch"] = (input) =>
    Effect.gen(function* () {
      yield* executeGit("GitCore.createBranch", input.cwd, ["branch", input.branch], {
        timeoutMs: 10_000,
        fallbackErrorMessage: "git branch create failed",
      });
      if (input.publish === true) {
        yield* publishBranch({ cwd: input.cwd, branch: input.branch });
      }
    }).pipe(Effect.asVoid);

  const resolveCheckoutBranchArgs = (input: {
    cwd: string;
    branch: string;
  }): Effect.Effect<readonly string[], GitCommandError> =>
    Effect.gen(function* () {
      const [localInputExists, remoteExists] = yield* Effect.all(
        [
          executeGit(
            "GitCore.checkoutBranch.localInputExists",
            input.cwd,
            ["show-ref", "--verify", "--quiet", `refs/heads/${input.branch}`],
            {
              timeoutMs: 5_000,
              allowNonZeroExit: true,
            },
          ).pipe(Effect.map((result) => result.code === 0)),
          executeGit(
            "GitCore.checkoutBranch.remoteExists",
            input.cwd,
            ["show-ref", "--verify", "--quiet", `refs/remotes/${input.branch}`],
            {
              timeoutMs: 5_000,
              allowNonZeroExit: true,
            },
          ).pipe(Effect.map((result) => result.code === 0)),
        ],
        { concurrency: "unbounded" },
      );

      const localTrackingBranch = remoteExists
        ? yield* executeGit(
            "GitCore.checkoutBranch.localTrackingBranch",
            input.cwd,
            ["for-each-ref", "--format=%(refname:short)\t%(upstream:short)", "refs/heads"],
            {
              timeoutMs: 5_000,
              allowNonZeroExit: true,
            },
          ).pipe(
            Effect.map((result) =>
              result.code === 0
                ? parseTrackingBranchByUpstreamRef(result.stdout, input.branch)
                : null,
            ),
          )
        : null;

      const localTrackedBranchCandidate = deriveLocalBranchNameFromRemoteRef(input.branch);
      const localTrackedBranchTargetExists =
        remoteExists && localTrackedBranchCandidate
          ? yield* executeGit(
              "GitCore.checkoutBranch.localTrackedBranchTargetExists",
              input.cwd,
              ["show-ref", "--verify", "--quiet", `refs/heads/${localTrackedBranchCandidate}`],
              {
                timeoutMs: 5_000,
                allowNonZeroExit: true,
              },
            ).pipe(Effect.map((result) => result.code === 0))
          : false;

      const checkoutArgs = localInputExists
        ? ["checkout", input.branch]
        : remoteExists && !localTrackingBranch && localTrackedBranchTargetExists
          ? ["checkout", input.branch]
          : remoteExists && !localTrackingBranch
            ? ["checkout", "--track", input.branch]
            : remoteExists && localTrackingBranch
              ? ["checkout", localTrackingBranch]
              : ["checkout", input.branch];

      return checkoutArgs;
    });

  const checkoutBranch: GitCoreShape["checkoutBranch"] = (input) =>
    Effect.gen(function* () {
      const checkoutArgs = yield* resolveCheckoutBranchArgs(input);
      const result = yield* executeGit("GitCore.checkoutBranch.checkout", input.cwd, checkoutArgs, {
        timeoutMs: 10_000,
        allowNonZeroExit: true,
        fallbackErrorMessage: "git checkout failed",
      });
      if (result.code !== 0) {
        const conflictingFiles = parseDirtyWorktreeFiles(result.stderr);
        if (conflictingFiles) {
          return yield* new GitCheckoutDirtyWorktreeError({
            branch: input.branch,
            cwd: input.cwd,
            conflictingFiles,
          });
        }
        const stderr = result.stderr.trim();
        return yield* createGitCommandError(
          "GitCore.checkoutBranch.checkout",
          input.cwd,
          checkoutArgs,
          stderr.length > 0 ? stderr : "git checkout failed",
        );
      }

      yield* Effect.forkScoped(
        refreshCheckedOutBranchUpstream(input.cwd).pipe(Effect.ignoreCause({ log: true })),
      );
    });

  const stashAndCheckout: GitCoreShape["stashAndCheckout"] = (input) =>
    Effect.gen(function* () {
      const stashBefore = yield* listStashEntries(
        "GitCore.stashAndCheckout.stashListBefore",
        input.cwd,
      );

      yield* executeGit(
        "GitCore.stashAndCheckout.stashPush",
        input.cwd,
        ["stash", "push", "-u", "-m", `glade: stash before switching to ${input.branch}`],
        {
          timeoutMs: 30_000,
          fallbackErrorMessage: "git stash failed",
        },
      );

      const stashAfter = yield* listStashEntries(
        "GitCore.stashAndCheckout.stashListAfter",
        input.cwd,
      );
      const stashBeforeHashes = new Set(stashBefore.map((entry) => entry.hash));
      const createdStash =
        stashAfter.find((entry) => !stashBeforeHashes.has(entry.hash)) ??
        (stashAfter.length > stashBefore.length ? stashAfter[0] : undefined);

      const checkoutResult = yield* Effect.exit(checkoutBranch(input));
      if (Exit.isFailure(checkoutResult)) {
        if (createdStash) {
          const restoreResult = yield* executeGit(
            "GitCore.stashAndCheckout.restoreAfterCheckoutFailure.apply",
            input.cwd,
            ["stash", "apply", createdStash.hash],
            { timeoutMs: 30_000, allowNonZeroExit: true },
          );
          if (restoreResult.code === 0) {
            yield* dropStashByHash(input.cwd, createdStash.hash).pipe(
              Effect.catchTag("GitCommandError", (error) =>
                Effect.logWarning(
                  `Could not drop restored stash ${createdStash.hash}: ${error.message}`,
                ),
              ),
            );
          }
        }
        return yield* Effect.failCause(checkoutResult.cause);
      }

      if (!createdStash) return;

      const applyResult = yield* executeGit(
        "GitCore.stashAndCheckout.stashApply",
        input.cwd,
        ["stash", "apply", createdStash.hash],
        { timeoutMs: 30_000, allowNonZeroExit: true },
      );
      if (applyResult.code === 0) {
        yield* dropStashByHash(input.cwd, createdStash.hash).pipe(
          Effect.catchTag("GitCommandError", (error) =>
            Effect.logWarning(
              `Could not drop reapplied stash ${createdStash.hash}: ${error.message}`,
            ),
          ),
        );
        return;
      }

      yield* executeGit(
        "GitCore.stashAndCheckout.abortConflictedApply",
        input.cwd,
        ["reset", "--hard"],
        { timeoutMs: 30_000, allowNonZeroExit: true },
      ).pipe(Effect.ignore);
      yield* executeGit(
        "GitCore.stashAndCheckout.cleanConflictedApply",
        input.cwd,
        ["clean", "-fd"],
        { timeoutMs: 30_000, allowNonZeroExit: true },
      ).pipe(Effect.ignore);

      return yield* createGitCommandError(
        "GitCore.stashAndCheckout.stashApply",
        input.cwd,
        ["stash", "apply", createdStash.hash],
        "Stash could not be applied. Your changes are still saved in the stash.",
      );
    });

  const stashDrop: GitCoreShape["stashDrop"] = (input) =>
    executeGit("GitCore.stashDrop", input.cwd, ["stash", "drop", input.stashRef], {
      timeoutMs: 10_000,
      fallbackErrorMessage: "git stash drop failed",
    }).pipe(Effect.asVoid);

  const stashInfo: GitCoreShape["stashInfo"] = (input) =>
    Effect.gen(function* () {
      const stashLine = (yield* runGitStdout("GitCore.stashInfo.list", input.cwd, [
        "stash",
        "list",
        "-n",
        "1",
        "--format=%gd%x09%gs",
      ])).trim();
      const separatorIndex = stashLine.indexOf("\t");
      const stashRef =
        separatorIndex >= 0 ? stashLine.slice(0, separatorIndex).trim() : stashLine.trim();
      const message =
        separatorIndex >= 0 ? stashLine.slice(separatorIndex + 1).trim() : stashLine.trim();
      if (stashRef.length === 0 || message.length === 0) {
        return yield* createGitCommandError(
          "GitCore.stashInfo",
          input.cwd,
          ["stash", "list", "-n", "1", "--format=%gd%x09%gs"],
          "No stash entry is available.",
        );
      }

      const branchOutput = yield* runGitStdout("GitCore.stashInfo.branch", input.cwd, [
        "branch",
        "--show-current",
      ]).pipe(Effect.catch(() => Effect.succeed("")));
      const filesOutput = yield* runGitStdout("GitCore.stashInfo.files", input.cwd, [
        "stash",
        "show",
        "--include-untracked",
        "--name-only",
        stashRef,
      ]).pipe(Effect.catch(() => Effect.succeed("")));

      return {
        cwd: input.cwd,
        branch: branchOutput.trim() || null,
        stashRef,
        message,
        files: parseNonEmptyLineList(filesOutput),
      };
    });
  return {
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
  };
});

export const GitBranchesLive = Layer.effect(GitBranches, makeGitBranches);
