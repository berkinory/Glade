import { Cache, Data, Duration, Effect, Exit, FileSystem, Layer, Scope } from "effect";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import {
  countTextFileLines,
  normalizeConfiguredMergeBranch,
  parseGitStatusPorcelain,
  summarizeGitNumstatOutputs,
} from "../gitStatusParsing.ts";
import { GitCommandError } from "../Errors.ts";
import type { GitCoreShape } from "../Services/GitCore.ts";
import { GitCommands } from "../Services/GitCommands.ts";
import { GitStatus } from "../Services/GitStatus.ts";
import { commandLabel, createGitCommandError, isMissingGitCwdError } from "./GitCommands.ts";

const DEFAULT_BASE_BRANCH_CANDIDATES = ["main", "master"] as const;
const MOVE_AWARE_WORKING_TREE_STATUS_TIMEOUT_MS = 15_000;

const STATUS_UPSTREAM_REFRESH_INTERVAL = Duration.seconds(15);

const STATUS_UPSTREAM_REFRESH_FAILURE_INTERVAL = Duration.seconds(30);

const STATUS_UPSTREAM_REFRESH_FAILURE_INTERVAL_MAX = Duration.seconds(300);

const STATUS_UPSTREAM_REFRESH_TIMEOUT = Duration.seconds(15);

const STATUS_UPSTREAM_REFRESH_CACHE_CAPACITY = 2_048;

type StatusUpstreamRefreshResult = "refreshed" | "failed";

interface StatusUpstreamRefreshCacheKeyFields {
  readonly cwd: string;
  readonly upstreamRef: string;
  readonly remoteName: string;
  readonly upstreamBranch: string;
}

function statusUpstreamRefreshBackoffMapKey(key: StatusUpstreamRefreshCacheKeyFields): string {
  return `${key.cwd}\u0000${key.upstreamRef}\u0000${key.remoteName}\u0000${key.upstreamBranch}`;
}

function makeStatusUpstreamRefreshCacheTimeToLive() {
  const consecutiveFailures = new Map<string, number>();
  return {
    getFailureCount(key: StatusUpstreamRefreshCacheKeyFields): number {
      return consecutiveFailures.get(statusUpstreamRefreshBackoffMapKey(key)) ?? 0;
    },
    timeToLive(
      exit: Exit.Exit<StatusUpstreamRefreshResult, never>,
      key: StatusUpstreamRefreshCacheKeyFields,
    ): Duration.Duration {
      const mapKey = statusUpstreamRefreshBackoffMapKey(key);
      if (Exit.isSuccess(exit) && exit.value === "refreshed") {
        consecutiveFailures.delete(mapKey);
        return STATUS_UPSTREAM_REFRESH_INTERVAL;
      }
      const failures = consecutiveFailures.get(mapKey) ?? 0;

      consecutiveFailures.delete(mapKey);
      consecutiveFailures.set(mapKey, Math.min(failures + 1, 5));
      if (consecutiveFailures.size > STATUS_UPSTREAM_REFRESH_CACHE_CAPACITY) {
        consecutiveFailures.delete(consecutiveFailures.keys().next().value!);
      }
      return Duration.millis(
        Math.min(
          Duration.toMillis(STATUS_UPSTREAM_REFRESH_FAILURE_INTERVAL) * 2 ** failures,
          Duration.toMillis(STATUS_UPSTREAM_REFRESH_FAILURE_INTERVAL_MAX),
        ),
      );
    },
  };
}

const NON_REPOSITORY_STATUS_DETAILS = Object.freeze({
  isRepo: false,
  hasOriginRemote: false,
  isDefaultBranch: false,
  branch: null,
  upstreamRef: null,
  upstreamBranch: null,
  configuredPrBaseBranch: null,
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
});

class StatusUpstreamRefreshCacheKey extends Data.Class<StatusUpstreamRefreshCacheKeyFields> {}

type WorkingTreeStatSummary = ReturnType<typeof summarizeGitNumstatOutputs>;

function resolveGitPath(cwd: string, gitPath: string): string {
  return nodePath.isAbsolute(gitPath) ? gitPath : nodePath.join(cwd, gitPath);
}

export function hasNodeErrorCode(cause: unknown, code: string): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === code
  );
}

export function parseRemoteNames(stdout: string): ReadonlyArray<string> {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .toSorted((a, b) => b.length - a.length);
}

function parseDefaultBranchFromRemoteHeadRef(value: string, remoteName: string): string | null {
  const trimmed = value.trim();
  const prefix = `refs/remotes/${remoteName}/`;
  if (!trimmed.startsWith(prefix)) {
    return null;
  }
  const branch = trimmed.slice(prefix.length).trim();
  return branch.length > 0 ? branch : null;
}

const makeGitStatus = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const { executeGit, runGit, runGitStdout } = yield* GitCommands;
  const statusRefreshScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );

  const readMoveAwareWorkingTreeSummary = (
    cwd: string,
  ): Effect.Effect<WorkingTreeStatSummary | null, never> =>
    Effect.scoped(
      Effect.gen(function* () {
        const indexPathRaw = yield* runGitStdout("GitCore.statusDetails.moveAwareIndexPath", cwd, [
          "rev-parse",
          "--git-path",
          "index",
        ]).pipe(Effect.map((stdout) => stdout.trim()));
        if (indexPathRaw.length === 0) {
          return null;
        }

        const tempIndexDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: `glade-git-status-index-${process.pid}-`,
        });
        const tempIndexPath = nodePath.join(tempIndexDir, "index");
        yield* Effect.tryPromise(() =>
          nodeFs.copyFile(resolveGitPath(cwd, indexPathRaw), tempIndexPath),
        ).pipe(
          Effect.catch((cause) =>
            hasNodeErrorCode(cause, "ENOENT") ? Effect.void : Effect.fail(cause),
          ),
        );

        const tempIndexEnv = { GIT_INDEX_FILE: tempIndexPath };

        yield* executeGit("GitCore.statusDetails.moveAwareAddAll", cwd, ["add", "-A", "--", ":/"], {
          env: tempIndexEnv,
          timeoutMs: MOVE_AWARE_WORKING_TREE_STATUS_TIMEOUT_MS,
          fallbackErrorMessage: "git add -A failed while summarizing working tree status",
        });

        const numstatStdout = yield* executeGit(
          "GitCore.statusDetails.moveAwareNumstat",
          cwd,
          ["diff", "--cached", "--numstat", "-z", "--find-renames"],
          {
            env: tempIndexEnv,
            allowNonZeroExit: true,
            timeoutMs: MOVE_AWARE_WORKING_TREE_STATUS_TIMEOUT_MS,
          },
        ).pipe(Effect.map((result) => result.stdout));

        return summarizeGitNumstatOutputs([numstatStdout]);
      }),
    ).pipe(
      Effect.catch((cause) =>
        Effect.logDebug(
          "GitCore.statusDetails: move-aware working tree summary failed",
          cause,
        ).pipe(Effect.as(null)),
      ),
    );

  const branchExists = (cwd: string, branch: string): Effect.Effect<boolean, GitCommandError> =>
    executeGit(
      "GitCore.branchExists",
      cwd,
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      {
        allowNonZeroExit: true,
        timeoutMs: 5_000,
      },
    ).pipe(Effect.map((result) => result.code === 0));

  const resolveCurrentUpstream = (
    cwd: string,
  ): Effect.Effect<
    { upstreamRef: string; remoteName: string; upstreamBranch: string } | null,
    GitCommandError
  > =>
    Effect.gen(function* () {
      const upstreamRef = yield* runGitStdout(
        "GitCore.resolveCurrentUpstream",
        cwd,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        true,
      ).pipe(Effect.map((stdout) => stdout.trim()));

      if (upstreamRef.length === 0 || upstreamRef === "@{upstream}") {
        return null;
      }

      const separatorIndex = upstreamRef.indexOf("/");
      if (separatorIndex <= 0) {
        return null;
      }
      const remoteName = upstreamRef.slice(0, separatorIndex);
      const upstreamBranch = upstreamRef.slice(separatorIndex + 1);
      if (remoteName.length === 0 || upstreamBranch.length === 0) {
        return null;
      }

      return {
        upstreamRef,
        remoteName,
        upstreamBranch,
      };
    });

  const fetchUpstreamRef = (
    cwd: string,
    upstream: { upstreamRef: string; remoteName: string; upstreamBranch: string },
  ): Effect.Effect<void, GitCommandError> => {
    const refspec = `+refs/heads/${upstream.upstreamBranch}:refs/remotes/${upstream.upstreamRef}`;
    return runGit(
      "GitCore.fetchUpstreamRef",
      cwd,
      ["fetch", "--quiet", "--no-tags", upstream.remoteName, refspec],
      true,
    );
  };

  const fetchUpstreamRefForStatus = (
    cwd: string,
    upstream: { upstreamRef: string; remoteName: string; upstreamBranch: string },
  ): Effect.Effect<void, GitCommandError> => {
    const refspec = `+refs/heads/${upstream.upstreamBranch}:refs/remotes/${upstream.upstreamRef}`;
    return executeGit(
      "GitCore.fetchUpstreamRefForStatus",
      cwd,
      ["fetch", "--quiet", "--no-tags", upstream.remoteName, refspec],
      {
        timeoutMs: Duration.toMillis(STATUS_UPSTREAM_REFRESH_TIMEOUT),
      },
    ).pipe(Effect.asVoid);
  };

  const upstreamRefreshPolicy = makeStatusUpstreamRefreshCacheTimeToLive();

  const statusUpstreamRefreshCache = yield* Cache.makeWith({
    capacity: STATUS_UPSTREAM_REFRESH_CACHE_CAPACITY,
    lookup: (cacheKey: StatusUpstreamRefreshCacheKey) =>
      fetchUpstreamRefForStatus(cacheKey.cwd, {
        upstreamRef: cacheKey.upstreamRef,
        remoteName: cacheKey.remoteName,
        upstreamBranch: cacheKey.upstreamBranch,
      }).pipe(
        Effect.as("refreshed" as const),
        Effect.catch((cause) => {
          const failures = upstreamRefreshPolicy.getFailureCount(cacheKey);
          const logFields = {
            cause,
            cwd: cacheKey.cwd,
            remoteName: cacheKey.remoteName,
            upstreamBranch: cacheKey.upstreamBranch,
          };
          const log =
            failures === 0
              ? Effect.logWarning(
                  "Git status upstream refresh failed; retry is temporarily paused",
                  logFields,
                )
              : Effect.logDebug("Git status upstream refresh failed again; backing off", logFields);
          return log.pipe(Effect.as("failed" as const));
        }),
      ),

    timeToLive: upstreamRefreshPolicy.timeToLive,
  });

  const refreshStatusUpstreamIfStale = (cwd: string): Effect.Effect<void, GitCommandError> =>
    Effect.gen(function* () {
      const upstream = yield* resolveCurrentUpstream(cwd);
      if (!upstream) return;
      yield* Cache.get(
        statusUpstreamRefreshCache,
        new StatusUpstreamRefreshCacheKey({
          cwd,
          upstreamRef: upstream.upstreamRef,
          remoteName: upstream.remoteName,
          upstreamBranch: upstream.upstreamBranch,
        }),
      );
    });

  const refreshCheckedOutBranchUpstream = (cwd: string): Effect.Effect<void, GitCommandError> =>
    Effect.gen(function* () {
      const upstream = yield* resolveCurrentUpstream(cwd);
      if (!upstream) return;
      yield* fetchUpstreamRef(cwd, upstream);
    });

  const resolveDefaultBranchName = (
    cwd: string,
    remoteName: string,
  ): Effect.Effect<string | null, GitCommandError> =>
    executeGit(
      "GitCore.resolveDefaultBranchName",
      cwd,
      ["symbolic-ref", `refs/remotes/${remoteName}/HEAD`],
      { allowNonZeroExit: true },
    ).pipe(
      Effect.map((result) => {
        if (result.code !== 0) {
          return null;
        }
        return parseDefaultBranchFromRemoteHeadRef(result.stdout, remoteName);
      }),
    );

  const remoteBranchExists = (
    cwd: string,
    remoteName: string,
    branch: string,
  ): Effect.Effect<boolean, GitCommandError> =>
    executeGit(
      "GitCore.remoteBranchExists",
      cwd,
      ["show-ref", "--verify", "--quiet", `refs/remotes/${remoteName}/${branch}`],
      {
        allowNonZeroExit: true,
      },
    ).pipe(Effect.map((result) => result.code === 0));

  const originRemoteExists = (cwd: string): Effect.Effect<boolean, GitCommandError> =>
    executeGit("GitCore.originRemoteExists", cwd, ["remote", "get-url", "origin"], {
      allowNonZeroExit: true,
    }).pipe(Effect.map((result) => result.code === 0));

  const listRemoteNames = (cwd: string): Effect.Effect<ReadonlyArray<string>, GitCommandError> =>
    runGitStdout("GitCore.listRemoteNames", cwd, ["remote"]).pipe(
      Effect.map((stdout) => parseRemoteNames(stdout).toReversed()),
    );

  const resolvePrimaryRemoteName = (cwd: string): Effect.Effect<string, GitCommandError> =>
    Effect.gen(function* () {
      if (yield* originRemoteExists(cwd)) {
        return "origin";
      }
      const remotes = yield* listRemoteNames(cwd);
      const [firstRemote] = remotes;
      if (firstRemote) {
        return firstRemote;
      }
      return yield* createGitCommandError(
        "GitCore.resolvePrimaryRemoteName",
        cwd,
        ["remote"],
        "No git remote is configured for this repository.",
      );
    });

  const resolveBaseBranchForNoUpstream = (
    cwd: string,
    branch: string,
  ): Effect.Effect<string | null, GitCommandError> =>
    Effect.gen(function* () {
      const configuredBaseBranch = yield* runGitStdout(
        "GitCore.resolveBaseBranchForNoUpstream.config",
        cwd,
        ["config", "--get", `branch.${branch}.gh-merge-base`],
        true,
      ).pipe(Effect.map((stdout) => stdout.trim()));

      const primaryRemoteName = yield* resolvePrimaryRemoteName(cwd).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      const defaultBranch =
        primaryRemoteName === null ? null : yield* resolveDefaultBranchName(cwd, primaryRemoteName);
      const candidates = [
        configuredBaseBranch.length > 0 ? configuredBaseBranch : null,
        defaultBranch,
        ...DEFAULT_BASE_BRANCH_CANDIDATES,
      ];

      for (const candidate of candidates) {
        if (!candidate) {
          continue;
        }

        const remotePrefix =
          primaryRemoteName && primaryRemoteName !== "origin" ? `${primaryRemoteName}/` : null;
        const normalizedCandidate = candidate.startsWith("origin/")
          ? candidate.slice("origin/".length)
          : remotePrefix && candidate.startsWith(remotePrefix)
            ? candidate.slice(remotePrefix.length)
            : candidate;
        if (normalizedCandidate.length === 0 || normalizedCandidate === branch) {
          continue;
        }

        if (yield* branchExists(cwd, normalizedCandidate)) {
          return normalizedCandidate;
        }

        if (
          primaryRemoteName &&
          (yield* remoteBranchExists(cwd, primaryRemoteName, normalizedCandidate))
        ) {
          return `${primaryRemoteName}/${normalizedCandidate}`;
        }
      }

      return null;
    });

  const computeAheadCountAgainstBase = (
    cwd: string,
    branch: string,
  ): Effect.Effect<number, GitCommandError> =>
    Effect.gen(function* () {
      const baseBranch = yield* resolveBaseBranchForNoUpstream(cwd, branch);
      if (!baseBranch) {
        return 0;
      }

      const result = yield* executeGit(
        "GitCore.computeAheadCountAgainstBase",
        cwd,
        ["rev-list", "--count", `${baseBranch}..HEAD`],
        { allowNonZeroExit: true },
      );
      if (result.code !== 0) {
        return 0;
      }

      const parsed = Number.parseInt(result.stdout.trim(), 10);
      return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    });

  const readStatusDetails = (cwd: string, refreshUpstream: boolean) =>
    Effect.gen(function* () {
      const operation = "GitCore.statusDetails.isInsideWorkTree";
      const args = ["rev-parse", "--is-inside-work-tree"] as const;
      const isInsideWorkTree = yield* executeGit(operation, cwd, args, {
        allowNonZeroExit: true,
        timeoutMs: 5_000,
      }).pipe(
        Effect.flatMap((result) => {
          if (result.code === 0) {
            return Effect.succeed(result.stdout.trim() === "true");
          }
          if (result.code === 128 && result.stderr.toLowerCase().includes("not a git repository")) {
            return Effect.succeed(false);
          }
          return Effect.fail(
            createGitCommandError(
              operation,
              cwd,
              args,
              result.stderr.trim() || `${commandLabel(args)} failed: code=${result.code}`,
            ),
          );
        }),
        Effect.catchIf(isMissingGitCwdError, () => Effect.succeed(false)),
      );
      if (!isInsideWorkTree) {
        return NON_REPOSITORY_STATUS_DETAILS;
      }

      if (refreshUpstream) {
        yield* refreshStatusUpstreamIfStale(cwd).pipe(
          Effect.catchIf(isMissingGitCwdError, () => Effect.void),
          Effect.ignoreCause({ log: true }),
        );
      }

      const statusStdout = yield* runGitStdout("GitCore.statusDetails.status", cwd, [
        "status",
        "--porcelain=2",
        "--branch",
        "-z",
      ]).pipe(Effect.catchIf(isMissingGitCwdError, () => Effect.succeed(null)));
      if (statusStdout === null) {
        return NON_REPOSITORY_STATUS_DETAILS;
      }

      const parsedStatus = parseGitStatusPorcelain(statusStdout);
      const branch = parsedStatus.branch;
      const upstreamRef = parsedStatus.upstreamRef;
      let upstreamBranch: string | null = null;
      let aheadCount = parsedStatus.aheadCount;
      let behindCount = parsedStatus.behindCount;
      const {
        hasWorkingTreeChanges,
        hasTrackedDeletion,
        hasUntrackedDirectory,
        changedFilesWithoutNumstat,
        untrackedFilesWithoutNumstat,
      } = parsedStatus;

      if (branch && upstreamRef) {
        upstreamBranch = yield* runGitStdout(
          "GitCore.statusDetails.upstreamMergeBranch",
          cwd,
          ["config", "--get", `branch.${branch}.merge`],
          true,
        ).pipe(
          Effect.map(normalizeConfiguredMergeBranch),
          Effect.catch(() => Effect.succeed(null)),
        );
      }

      const configuredPrBaseBranch = branch
        ? yield* runGitStdout(
            "GitCore.statusDetails.configuredPrBaseBranch",
            cwd,
            ["config", "--get", `branch.${branch}.gh-merge-base`],
            true,
          ).pipe(
            Effect.map((stdout) => stdout.trim()),
            Effect.map((trimmed) => (trimmed.length > 0 ? trimmed : null)),
            Effect.catch(() => Effect.succeed(null)),
          )
        : null;

      if (!upstreamRef && branch) {
        aheadCount = yield* computeAheadCountAgainstBase(cwd, branch).pipe(
          Effect.catch(() => Effect.succeed(0)),
        );
        behindCount = 0;
      }

      // Resolved from the same helpers `listGitBranches` uses so the two stay consistent; each lookup
      // degrades to a safe default on failure so it never breaks the status read.
      // `resolvePrimaryRemoteName` returns "origin" only when that remote exists, so it doubles as the
      // origin check.
      const primaryRemoteName = yield* resolvePrimaryRemoteName(cwd).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      const defaultBranchName =
        primaryRemoteName === null
          ? null
          : yield* resolveDefaultBranchName(cwd, primaryRemoteName).pipe(
              Effect.catch(() => Effect.succeed(null)),
            );
      const repoMetadata = {
        isRepo: true,
        hasOriginRemote: primaryRemoteName === "origin",
        isDefaultBranch:
          branch !== null && defaultBranchName !== null && branch === defaultBranchName,
      } as const;

      const moveAwareWorkingTree =
        hasWorkingTreeChanges &&
        untrackedFilesWithoutNumstat.size > 0 &&
        (hasTrackedDeletion || hasUntrackedDirectory)
          ? yield* readMoveAwareWorkingTreeSummary(cwd)
          : null;
      if (moveAwareWorkingTree) {
        return {
          ...repoMetadata,
          branch,
          upstreamRef,
          upstreamBranch,
          configuredPrBaseBranch,
          hasWorkingTreeChanges,
          workingTree: moveAwareWorkingTree,
          hasUpstream: upstreamRef !== null,
          aheadCount,
          behindCount,
        };
      }

      const numstatOutputs = yield* Effect.all(
        [
          runGitStdout("GitCore.statusDetails.unstagedNumstat", cwd, ["diff", "--numstat", "-z"]),
          runGitStdout("GitCore.statusDetails.stagedNumstat", cwd, [
            "diff",
            "--cached",
            "--numstat",
            "-z",
          ]),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.catchIf(isMissingGitCwdError, () => Effect.succeed(null)));
      if (numstatOutputs === null) {
        return NON_REPOSITORY_STATUS_DETAILS;
      }

      const [unstagedNumstatStdout, stagedNumstatStdout] = numstatOutputs;
      const workingTree = summarizeGitNumstatOutputs([stagedNumstatStdout, unstagedNumstatStdout]);
      const files = [...workingTree.files];
      const numstatFilePaths = new Set(files.map((file) => file.path));
      const filePathsWithStats = new Set(numstatFilePaths);
      let insertions = workingTree.insertions;
      let deletions = workingTree.deletions;

      for (const filePath of changedFilesWithoutNumstat) {
        if (filePathsWithStats.has(filePath)) continue;

        const insertions = untrackedFilesWithoutNumstat.has(filePath)
          ? yield* Effect.tryPromise(() => nodeFs.readFile(nodePath.join(cwd, filePath))).pipe(
              Effect.map((contents) => countTextFileLines(new Uint8Array(contents))),
              Effect.catch(() => Effect.succeed(0)),
            )
          : 0;

        files.push({ path: filePath, insertions, deletions: 0 });
        filePathsWithStats.add(filePath);
      }
      files.sort((a, b) => a.path.localeCompare(b.path));

      for (const file of files) {
        if (numstatFilePaths.has(file.path)) continue;
        insertions += file.insertions;
        deletions += file.deletions;
      }

      return {
        ...repoMetadata,
        branch,
        upstreamRef,
        upstreamBranch,
        configuredPrBaseBranch,
        hasWorkingTreeChanges,
        workingTree: {
          files,
          insertions,
          deletions,
        },
        hasUpstream: upstreamRef !== null,
        aheadCount,
        behindCount,
      };
    });

  const statusDetails: GitCoreShape["statusDetails"] = (cwd) => readStatusDetails(cwd, true);

  const readBranchContext: GitCoreShape["readBranchContext"] = (cwd) =>
    Effect.gen(function* () {
      const branchOperation = "GitCore.readBranchContext.branch";
      const branchArgs = ["symbolic-ref", "--quiet", "--short", "HEAD"] as const;
      const branchResult = yield* executeGit(branchOperation, cwd, branchArgs, {
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 4_096,
      }).pipe(Effect.catchIf(isMissingGitCwdError, () => Effect.succeed(null)));
      if (branchResult === null || branchResult.code === 128) {
        return { isRepo: false, branch: null, upstreamRef: null };
      }
      if (branchResult.code !== 0 && branchResult.code !== 1) {
        return yield* createGitCommandError(
          branchOperation,
          cwd,
          branchArgs,
          branchResult.stderr.trim() ||
            `${commandLabel(branchArgs)} failed: code=${branchResult.code}`,
        );
      }

      const branch = branchResult.code === 0 ? branchResult.stdout.trim() || null : null;
      if (branch === null) {
        return { isRepo: true, branch: null, upstreamRef: null };
      }

      const upstreamResult = yield* executeGit(
        "GitCore.readBranchContext.upstream",
        cwd,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        { allowNonZeroExit: true, timeoutMs: 5_000, maxOutputBytes: 4_096 },
      );
      return {
        isRepo: true,
        branch,
        upstreamRef: upstreamResult.code === 0 ? upstreamResult.stdout.trim() || null : null,
      };
    });

  const status: GitCoreShape["status"] = (input) =>
    Effect.gen(function* () {
      const details = yield* readStatusDetails(input.cwd, false);
      if (details.hasUpstream) {
        yield* refreshStatusUpstreamIfStale(input.cwd).pipe(
          Effect.catchIf(isMissingGitCwdError, () => Effect.void),
          Effect.ignoreCause({ log: true }),
          Effect.forkIn(statusRefreshScope),
        );
      }
      return {
        branch: details.branch,
        hasWorkingTreeChanges: details.hasWorkingTreeChanges,
        workingTree: details.workingTree,
        hasUpstream: details.hasUpstream,
        upstreamBranch: details.upstreamBranch,
        aheadCount: details.aheadCount,
        behindCount: details.behindCount,
        pr: null,
      };
    });
  return {
    status,
    statusDetails,
    readBranchContext,
    branchExists,
    remoteBranchExists,
    resolveCurrentUpstream,
    refreshCheckedOutBranchUpstream,
    resolvePrimaryRemoteName,
    resolveBaseBranchForNoUpstream,
  };
});

export const GitStatusLive = Layer.effect(GitStatus, makeGitStatus);
