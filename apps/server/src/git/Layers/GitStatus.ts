import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@glade/shared/git/githubRepository";
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
import { GitCommands, type GitCommandsShape } from "../Services/GitCommands.ts";
import { GitStatus } from "../Services/GitStatus.ts";
import { GitRepositoryMetadata } from "../Services/GitRepositoryMetadata";
import { GitRepositoryMetadataLive } from "./GitRepositoryMetadata";
import { commandLabel, createGitCommandError, isMissingGitCwdError } from "./GitCommands.ts";

const DEFAULT_BASE_BRANCH_CANDIDATES = ["main", "master"] as const;
const MOVE_AWARE_WORKING_TREE_STATUS_TIMEOUT_MS = 15_000;

const STATUS_UPSTREAM_REFRESH_INTERVAL = Duration.seconds(15);

const STATUS_UPSTREAM_REFRESH_FAILURE_INTERVAL = Duration.seconds(30);

const STATUS_UPSTREAM_REFRESH_FAILURE_INTERVAL_MAX = Duration.seconds(300);

const STATUS_UPSTREAM_REFRESH_TIMEOUT = Duration.seconds(15);

const STATUS_UPSTREAM_REFRESH_CACHE_CAPACITY = 2_048;

type StatusUpstreamRefreshResult = {
  readonly status: "refreshed" | "failed";
  readonly completedAt: number;
};

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
      if (Exit.isSuccess(exit) && exit.value.status === "refreshed") {
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

const makeGitStatus = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const commands = yield* GitCommands;
  const runGit = commands.runGit;
  const executeGit: GitCommandsShape["executeGit"] = (operation, cwd, args, options) =>
    commands.executeGit(operation, cwd, args, { priority: "background", ...options });
  const runGitStdout: GitCommandsShape["runGitStdout"] = (
    operation,
    cwd,
    args,
    allowNonZeroExit = false,
  ) =>
    executeGit(operation, cwd, args, { allowNonZeroExit }).pipe(
      Effect.map((result) => result.stdout),
    );
  const metadata = yield* GitRepositoryMetadata;
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
        Effect.map(() => ({ status: "refreshed" as const, completedAt: performance.now() })),
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
          return log.pipe(
            Effect.map(() => ({ status: "failed" as const, completedAt: performance.now() })),
          );
        }),
      ),

    timeToLive: upstreamRefreshPolicy.timeToLive,
  });

  const refreshStatusUpstreamIfStale = (
    cwd: string,
    upstreamRef?: string,
  ): Effect.Effect<boolean, GitCommandError> =>
    Effect.gen(function* () {
      const startedAt = performance.now();
      const separator = upstreamRef?.indexOf("/") ?? -1;
      const upstream =
        upstreamRef !== undefined
          ? separator > 0
            ? {
                upstreamRef,
                remoteName: upstreamRef.slice(0, separator),
                upstreamBranch: upstreamRef.slice(separator + 1),
              }
            : null
          : yield* resolveCurrentUpstream(cwd);
      if (!upstream) return false;
      const refreshed = yield* Cache.get(
        statusUpstreamRefreshCache,
        new StatusUpstreamRefreshCacheKey({ cwd, ...upstream }),
      );
      return refreshed.status === "refreshed" && refreshed.completedAt >= startedAt;
    });

  const refreshCheckedOutBranchUpstream = (cwd: string): Effect.Effect<void, GitCommandError> =>
    Effect.gen(function* () {
      const upstream = yield* resolveCurrentUpstream(cwd);
      if (!upstream) return;
      yield* fetchUpstreamRef(cwd, upstream);
    });

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
      const repoConfig = yield* metadata.read(cwd);
      const configuredBaseBranch =
        repoConfig.configValue(`branch.${branch}.gh-merge-base`)?.trim() ?? "";
      const primaryRemoteName = repoConfig.primaryRemote;
      const defaultBranch = repoConfig.defaultBranch;
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

        if (repoConfig.hasRef(`refs/heads/${normalizedCandidate}`)) {
          return normalizedCandidate;
        }

        if (
          primaryRemoteName &&
          repoConfig.hasRef(`refs/remotes/${primaryRemoteName}/${normalizedCandidate}`)
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

  const readPorcelainStatus = (cwd: string) =>
    Effect.gen(function* () {
      const operation = "GitCore.statusDetails.status";
      const args = [
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "--branch",
        "--untracked-files=all",
        "-z",
      ] as const;
      const statusResult = yield* executeGit(operation, cwd, args, {
        allowNonZeroExit: true,
        timeoutMs: 30_000,
        maxOutputBytes: 512_000,
        outputMode: "prefix",
      }).pipe(Effect.catchIf(isMissingGitCwdError, () => Effect.succeed(null)));
      if (
        statusResult === null ||
        (statusResult.code === 128 &&
          /not a git repository|must be run in a work tree/i.test(statusResult.stderr))
      ) {
        return null;
      }
      if (statusResult.code !== 0 && !statusResult.stdoutTruncated) {
        return yield* createGitCommandError(operation, cwd, args, statusResult.stderr.trim());
      }
      const end = statusResult.stdoutTruncated
        ? statusResult.stdout.lastIndexOf("\0") + 1
        : statusResult.stdout.length;
      return statusResult.stdout.slice(0, end);
    });

  const summary: GitCoreShape["summary"] = (cwd) =>
    readPorcelainStatus(cwd).pipe(
      Effect.flatMap((stdout) =>
        Effect.gen(function* () {
          const parsed = stdout === null ? null : parseGitStatusPorcelain(stdout);
          const config = parsed ? yield* metadata.read(cwd) : null;
          const remote = parsed?.branch
            ? (config?.configValue(`branch.${parsed.branch}.remote`) ?? config?.primaryRemote)
            : config?.primaryRemote;
          const remoteUrl = remote ? config?.configValue(`remote.${remote}.url`) : null;
          return {
            headRepository: remoteUrl
              ? parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remoteUrl)
              : null,
            isRepo: parsed !== null,
            branch: parsed?.branch ?? null,
            upstreamRef: parsed?.upstreamRef ?? null,
            aheadCount: parsed?.aheadCount ?? 0,
            behindCount: parsed?.behindCount ?? 0,
            hasWorkingTreeChanges: parsed?.hasWorkingTreeChanges ?? false,
          };
        }),
      ),
    );

  const readStatusDetails = (cwd: string, refreshUpstream: boolean, metadataOnly: boolean) =>
    Effect.gen(function* () {
      let statusStdout = yield* readPorcelainStatus(cwd);
      if (statusStdout === null) return NON_REPOSITORY_STATUS_DETAILS;
      const initialUpstream = parseGitStatusPorcelain(statusStdout).upstreamRef;
      if (refreshUpstream && initialUpstream) {
        const refreshed = yield* refreshStatusUpstreamIfStale(cwd, initialUpstream).pipe(
          Effect.catch(() => Effect.succeed(false)),
        );
        if (refreshed) statusStdout = (yield* readPorcelainStatus(cwd)) ?? statusStdout;
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

      const repoConfig = yield* metadata.read(cwd);
      if (branch && upstreamRef) {
        upstreamBranch = normalizeConfiguredMergeBranch(
          repoConfig.configValue(`branch.${branch}.merge`) ?? "",
        );
      }
      const configuredPrBaseBranch = branch
        ? repoConfig.configValue(`branch.${branch}.gh-merge-base`)?.trim() || null
        : null;

      if (!upstreamRef && branch) {
        aheadCount = yield* computeAheadCountAgainstBase(cwd, branch).pipe(
          Effect.catch(() => Effect.succeed(0)),
        );
        behindCount = 0;
      }

      const primaryRemoteName = repoConfig.primaryRemote;
      const defaultBranchName = repoConfig.defaultBranch;
      const repoMetadata = {
        isRepo: true,
        hasOriginRemote: primaryRemoteName === "origin",
        isDefaultBranch:
          branch !== null && defaultBranchName !== null && branch === defaultBranchName,
      } as const;

      if (
        metadataOnly ||
        changedFilesWithoutNumstat.size >= 5_000 ||
        Buffer.byteLength(statusStdout) > 500_000
      ) {
        const paths = [...changedFilesWithoutNumstat];
        return {
          ...repoMetadata,
          branch,
          upstreamRef,
          upstreamBranch,
          configuredPrBaseBranch,
          hasWorkingTreeChanges,
          workingTree: {
            totalCount: paths.length,
            incomplete: paths.length >= 5_000 || Buffer.byteLength(statusStdout) > 500_000,
            statsAvailable: false,
            files: paths
              .slice(
                0,
                paths.length >= 5_000 || Buffer.byteLength(statusStdout) > 500_000 ? 200 : 5_000,
              )
              .map((path) => ({ path, insertions: 0, deletions: 0 })),
            insertions: 0,
            deletions: 0,
          },
          hasUpstream: upstreamRef !== null,
          aheadCount,
          behindCount,
        };
      }

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

      const numstatResult = yield* executeGit(
        "GitCore.statusDetails.numstat",
        cwd,
        ["diff", "HEAD", "--numstat", "-z"],
        { allowNonZeroExit: true },
      ).pipe(Effect.catchIf(isMissingGitCwdError, () => Effect.succeed(null)));
      if (numstatResult === null) return NON_REPOSITORY_STATUS_DETAILS;
      if (numstatResult.code !== 0 && !statusStdout.startsWith("# branch.oid (initial)")) {
        return yield* createGitCommandError(
          "GitCore.statusDetails.numstat",
          cwd,
          ["diff", "HEAD", "--numstat", "-z"],
          numstatResult.stderr.trim(),
        );
      }
      // Unborn branches have no HEAD; their index is the complete tracked working tree.
      const numstatStdout =
        numstatResult.code === 0
          ? numstatResult.stdout
          : yield* runGitStdout("GitCore.statusDetails.unbornNumstat", cwd, [
              "diff",
              "--cached",
              "--numstat",
              "-z",
            ]);
      const workingTree = summarizeGitNumstatOutputs([numstatStdout]);
      const files = [...workingTree.files];
      const numstatFilePaths = new Set(files.map((file) => file.path));
      const filePathsWithStats = new Set(numstatFilePaths);
      let insertions = workingTree.insertions;
      let deletions = workingTree.deletions;

      for (const filePath of changedFilesWithoutNumstat) {
        if (filePathsWithStats.has(filePath)) continue;

        const insertions = untrackedFilesWithoutNumstat.has(filePath)
          ? yield* Effect.tryPromise(async () => {
              const path = nodePath.join(cwd, filePath);
              if ((await nodeFs.stat(path)).size > 1_000_000) return new Uint8Array();
              return nodeFs.readFile(path);
            }).pipe(
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

  const statusDetails: GitCoreShape["statusDetails"] = (cwd, options) =>
    readStatusDetails(cwd, options?.refreshUpstream ?? true, options?.metadataOnly ?? false);

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
      const details = yield* readStatusDetails(input.cwd, false, false);
      if (details.hasUpstream) {
        yield* refreshStatusUpstreamIfStale(input.cwd, details.upstreamRef ?? undefined).pipe(
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
    summary,
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

export const GitStatusLive = Layer.effect(GitStatus, makeGitStatus).pipe(
  Layer.provide(GitRepositoryMetadataLive),
);
