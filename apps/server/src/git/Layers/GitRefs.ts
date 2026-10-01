import { Effect, FileSystem, Layer } from "effect";
import { DEFAULT_GIT_RECENT_COMMIT_LIMIT, type GitRecentCommit } from "@glade/contracts/git/git";
import { GitCommandError } from "../Errors.ts";
import type { GitCoreShape } from "../Services/GitCore.ts";
import { GitCommands } from "../Services/GitCommands.ts";
import { GitStatus } from "../Services/GitStatus.ts";
import { GitRefs } from "../Services/GitRefs.ts";
import { parseRemoteNames } from "./GitStatus.ts";
import { createGitCommandError, isMissingGitCwdError } from "./GitCommands.ts";

const RECENT_COMMIT_FIELD_SEPARATOR = "\u001f";

function parseBranchLine(line: string): { name: string; current: boolean } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  const name = trimmed.replace(/^[*+]\s+/, "");

  if (name.includes(" -> ") || name.startsWith("(")) return null;

  return {
    name,
    current: trimmed.startsWith("* "),
  };
}

function parseRecentCommitLines(stdout: string): ReadonlyArray<GitRecentCommit> {
  const commits: GitRecentCommit[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    const [sha = "", shortSha = "", subject = "", committedAt = "", authorName = "", parents = ""] =
      line.split(RECENT_COMMIT_FIELD_SEPARATOR);
    if (sha.length === 0 || shortSha.length === 0) continue;
    commits.push({
      sha,
      shortSha,
      subject,
      committedAt,
      authorName,
      isMerge: parents.trim().split(/\s+/).filter(Boolean).length > 1,
      branches: [],
      pushStatus: "unknown",
      tags: [],
    });
  }
  return commits;
}

function parseRemoteRefWithRemoteNames(
  branchName: string,
  remoteNames: ReadonlyArray<string>,
): { remoteRef: string; remoteName: string; localBranch: string } | null {
  const trimmedBranchName = branchName.trim();
  if (trimmedBranchName.length === 0) return null;

  for (const remoteName of remoteNames) {
    const remotePrefix = `${remoteName}/`;
    if (!trimmedBranchName.startsWith(remotePrefix)) {
      continue;
    }
    const localBranch = trimmedBranchName.slice(remotePrefix.length).trim();
    if (localBranch.length === 0) {
      return null;
    }
    return {
      remoteRef: trimmedBranchName,
      remoteName,
      localBranch,
    };
  }

  return null;
}

const makeGitRefs = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const { execute, executeGit, runGitStdout } = yield* GitCommands;
  const { readBranchContext } = yield* GitStatus;
  const readBranchRecency = (cwd: string): Effect.Effect<Map<string, number>, GitCommandError> =>
    Effect.gen(function* () {
      const branchRecency = yield* executeGit(
        "GitCore.readBranchRecency",
        cwd,
        [
          "for-each-ref",
          "--format=%(refname:short)%09%(committerdate:unix)",
          "refs/heads",
          "refs/remotes",
        ],
        {
          timeoutMs: 15_000,
          allowNonZeroExit: true,
        },
      );

      const branchLastCommit = new Map<string, number>();
      if (branchRecency.code !== 0) {
        return branchLastCommit;
      }

      for (const line of branchRecency.stdout.split("\n")) {
        if (line.length === 0) {
          continue;
        }
        const [name, lastCommitRaw] = line.split("\t");
        if (!name) {
          continue;
        }
        const lastCommit = Number.parseInt(lastCommitRaw ?? "0", 10);
        branchLastCommit.set(name, Number.isFinite(lastCommit) ? lastCommit : 0);
      }

      return branchLastCommit;
    });

  const readRangeContext: GitCoreShape["readRangeContext"] = (cwd, baseBranch) =>
    Effect.gen(function* () {
      const range = `${baseBranch}..HEAD`;
      const [commitSummary, diffSummary, diffPatchResult] = yield* Effect.all(
        [
          runGitStdout("GitCore.readRangeContext.log", cwd, ["log", "--oneline", range]),
          runGitStdout("GitCore.readRangeContext.diffStat", cwd, ["diff", "--stat", range]),
          execute({
            operation: "GitCore.readRangeContext.diffPatch",
            cwd,
            args: ["diff", "--patch", "--minimal", range],
            maxOutputBytes: 10_000_000,
          }),
        ],
        { concurrency: "unbounded" },
      );
      const diffPatch = diffPatchResult.stdout;

      return {
        commitSummary,
        diffSummary,
        diffPatch,
      };
    });

  const readConfigValue: GitCoreShape["readConfigValue"] = (cwd, key) =>
    runGitStdout("GitCore.readConfigValue", cwd, ["config", "--get", key], true).pipe(
      Effect.map((stdout) => stdout.trim()),
      Effect.map((trimmed) => (trimmed.length > 0 ? trimmed : null)),
    );

  const listBranches: GitCoreShape["listBranches"] = (input) =>
    Effect.gen(function* () {
      const branchRecencyPromise = readBranchRecency(input.cwd).pipe(
        Effect.catch(() => Effect.succeed(new Map<string, number>())),
      );
      const localBranchResult = yield* executeGit(
        "GitCore.listBranches.branchNoColor",
        input.cwd,
        ["branch", "--no-color"],
        {
          timeoutMs: 10_000,
          allowNonZeroExit: true,
        },
      ).pipe(
        Effect.catchIf(isMissingGitCwdError, () =>
          Effect.succeed({
            code: 128,
            stdout: "",
            stderr: "fatal: not a git repository",
          }),
        ),
      );

      if (localBranchResult.code !== 0) {
        const stderr = localBranchResult.stderr.trim();
        if (stderr.toLowerCase().includes("not a git repository")) {
          return { branches: [], isRepo: false, hasOriginRemote: false };
        }
        return yield* createGitCommandError(
          "GitCore.listBranches",
          input.cwd,
          ["branch", "--no-color"],
          stderr || "git branch failed",
        );
      }

      const remoteBranchResultEffect = executeGit(
        "GitCore.listBranches.remoteBranches",
        input.cwd,
        ["branch", "--no-color", "--remotes"],
        {
          timeoutMs: 10_000,
          allowNonZeroExit: true,
        },
      ).pipe(
        Effect.catch((error) =>
          Effect.logWarning(
            `GitCore.listBranches: remote branch lookup failed for ${input.cwd}: ${error.message}. Falling back to an empty remote branch list.`,
          ).pipe(Effect.as({ code: 1, stdout: "", stderr: "" })),
        ),
      );

      const remoteNamesResultEffect = executeGit(
        "GitCore.listBranches.remoteNames",
        input.cwd,
        ["remote"],
        {
          timeoutMs: 5_000,
          allowNonZeroExit: true,
        },
      ).pipe(
        Effect.catch((error) =>
          Effect.logWarning(
            `GitCore.listBranches: remote name lookup failed for ${input.cwd}: ${error.message}. Falling back to an empty remote name list.`,
          ).pipe(Effect.as({ code: 1, stdout: "", stderr: "" })),
        ),
      );

      const branchMetadata = yield* Effect.all(
        [
          executeGit(
            "GitCore.listBranches.defaultRef",
            input.cwd,
            ["symbolic-ref", "refs/remotes/origin/HEAD"],
            {
              timeoutMs: 5_000,
              allowNonZeroExit: true,
            },
          ),
          executeGit(
            "GitCore.listBranches.worktreeList",
            input.cwd,
            ["worktree", "list", "--porcelain"],
            {
              timeoutMs: 5_000,
              allowNonZeroExit: true,
            },
          ),
          remoteBranchResultEffect,
          remoteNamesResultEffect,
          branchRecencyPromise,
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.catchIf(isMissingGitCwdError, () => Effect.succeed(null)));
      if (branchMetadata === null) {
        return { branches: [], isRepo: false, hasOriginRemote: false };
      }

      const [defaultRef, worktreeList, remoteBranchResult, remoteNamesResult, branchLastCommit] =
        branchMetadata;

      const remoteNames =
        remoteNamesResult.code === 0 ? parseRemoteNames(remoteNamesResult.stdout) : [];
      if (remoteBranchResult.code !== 0 && remoteBranchResult.stderr.trim().length > 0) {
        yield* Effect.logWarning(
          `GitCore.listBranches: remote branch lookup returned code ${remoteBranchResult.code} for ${input.cwd}: ${remoteBranchResult.stderr.trim()}. Falling back to an empty remote branch list.`,
        );
      }
      if (remoteNamesResult.code !== 0 && remoteNamesResult.stderr.trim().length > 0) {
        yield* Effect.logWarning(
          `GitCore.listBranches: remote name lookup returned code ${remoteNamesResult.code} for ${input.cwd}: ${remoteNamesResult.stderr.trim()}. Falling back to an empty remote name list.`,
        );
      }

      const defaultBranch =
        defaultRef.code === 0
          ? defaultRef.stdout.trim().replace(/^refs\/remotes\/origin\//, "")
          : null;

      const worktreeMap = new Map<string, string>();
      if (worktreeList.code === 0) {
        let currentPath: string | null = null;
        for (const line of worktreeList.stdout.split("\n")) {
          if (line.startsWith("worktree ")) {
            const candidatePath = line.slice("worktree ".length);
            const exists = yield* fileSystem.stat(candidatePath).pipe(
              Effect.map(() => true),
              Effect.catch(() => Effect.succeed(false)),
            );
            currentPath = exists ? candidatePath : null;
          } else if (line.startsWith("branch refs/heads/") && currentPath) {
            worktreeMap.set(line.slice("branch refs/heads/".length), currentPath);
          } else if (line === "") {
            currentPath = null;
          }
        }
      }

      const localBranches = localBranchResult.stdout
        .split("\n")
        .map(parseBranchLine)
        .filter((branch): branch is { name: string; current: boolean } => branch !== null)
        .map((branch) => ({
          name: branch.name,
          current: branch.current,
          isRemote: false,
          isDefault: branch.name === defaultBranch,
          worktreePath: worktreeMap.get(branch.name) ?? null,
        }))
        .toSorted((a, b) => {
          const aPriority = a.current ? 0 : a.isDefault ? 1 : 2;
          const bPriority = b.current ? 0 : b.isDefault ? 1 : 2;
          if (aPriority !== bPriority) return aPriority - bPriority;

          const aLastCommit = branchLastCommit.get(a.name) ?? 0;
          const bLastCommit = branchLastCommit.get(b.name) ?? 0;
          if (aLastCommit !== bLastCommit) return bLastCommit - aLastCommit;
          return a.name.localeCompare(b.name);
        });

      const remoteBranches =
        remoteBranchResult.code === 0
          ? remoteBranchResult.stdout
              .split("\n")
              .map(parseBranchLine)
              .filter((branch): branch is { name: string; current: boolean } => branch !== null)
              .map((branch) => {
                const parsedRemoteRef = parseRemoteRefWithRemoteNames(branch.name, remoteNames);
                const remoteBranch: {
                  name: string;
                  current: boolean;
                  isRemote: boolean;
                  remoteName?: string;
                  isDefault: boolean;
                  worktreePath: string | null;
                } = {
                  name: branch.name,
                  current: false,
                  isRemote: true,
                  isDefault: false,
                  worktreePath: null,
                };
                if (parsedRemoteRef) {
                  remoteBranch.remoteName = parsedRemoteRef.remoteName;
                }
                return remoteBranch;
              })
              .toSorted((a, b) => {
                const aLastCommit = branchLastCommit.get(a.name) ?? 0;
                const bLastCommit = branchLastCommit.get(b.name) ?? 0;
                if (aLastCommit !== bLastCommit) return bLastCommit - aLastCommit;
                return a.name.localeCompare(b.name);
              })
          : [];

      const branches = [...localBranches, ...remoteBranches];

      return { branches, isRepo: true, hasOriginRemote: remoteNames.includes("origin") };
    });

  const listRecentCommits: GitCoreShape["listRecentCommits"] = (input) =>
    Effect.gen(function* () {
      const limit = input.limit ?? DEFAULT_GIT_RECENT_COMMIT_LIMIT;
      const offset = input.offset ?? 0;
      const query = input.query?.trim();
      const result = yield* executeGit(
        "GitCore.listRecentCommits",
        input.cwd,
        [
          "log",
          "--format=%H%x1f%h%x1f%s%x1f%cI%x1f%an%x1f%P",
          "-n",
          String(limit + 1),
          "--skip",
          String(offset),
          ...(query ? ["--fixed-strings", "--regexp-ignore-case", `--grep=${query}`] : []),
        ],
        {
          timeoutMs: 10_000,
          allowNonZeroExit: true,
        },
      ).pipe(
        Effect.catchIf(isMissingGitCwdError, () =>
          Effect.succeed({ code: 128, stdout: "", stderr: "fatal: not a git repository" }),
        ),
      );

      if (result.code !== 0) {
        return { commits: [], hasMore: false };
      }

      const page = parseRecentCommitLines(result.stdout);
      const hasMore = page.length > limit;
      const commits = page.slice(0, limit);
      if (commits.length === 0) return { commits, hasMore: false };

      const context = yield* readBranchContext(input.cwd);
      const upstream = context.upstreamRef
        ? yield* executeGit(
            "GitCore.listRecentCommits.upstream",
            input.cwd,
            ["rev-parse", "--symbolic-full-name", "@{upstream}"],
            { timeoutMs: 5_000, allowNonZeroExit: true, maxOutputBytes: 4_096 },
          )
        : null;
      const hasRemoteUpstream =
        upstream?.code === 0 && upstream.stdout.trim().startsWith("refs/remotes/");
      const outgoing = hasRemoteUpstream
        ? yield* executeGit(
            "GitCore.listRecentCommits.outgoing",
            input.cwd,
            [
              "log",
              "--format=%H",
              "-n",
              String(offset + limit),
              ...(query ? ["--fixed-strings", "--regexp-ignore-case", `--grep=${query}`] : []),
              "HEAD",
              "--not",
              "@{upstream}",
            ],
            { timeoutMs: 10_000, allowNonZeroExit: true },
          )
        : null;
      const unpushed = outgoing?.code === 0 ? new Set(outgoing.stdout.trim().split("\n")) : null;
      const tagResult = yield* executeGit(
        "GitCore.listRecentCommits.tags",
        input.cwd,
        [
          "for-each-ref",
          "--format=%(objectname)%00%(*objectname)%00%(refname:strip=2)%00",
          "refs/tags",
        ],
        { timeoutMs: 10_000, maxOutputBytes: 2_000_000 },
      );
      const tagsBySha = new Map<string, string[]>();
      for (const line of tagResult.stdout.split("\n")) {
        const [objectSha, peeledSha, tagName] = line.split("\0");
        if (!objectSha || !tagName) continue;
        const sha = peeledSha || objectSha;
        const tags = tagsBySha.get(sha) ?? [];
        tags.push(tagName);
        tagsBySha.set(sha, tags);
      }
      const branchResult = yield* executeGit(
        "GitCore.listRecentCommits.branches",
        input.cwd,
        [
          "for-each-ref",
          "--format=%(objectname)%00%(refname)%00%(symref)",
          "refs/heads",
          "refs/remotes",
        ],
        { timeoutMs: 10_000, maxOutputBytes: 2_000_000 },
      );
      const branchesBySha = new Map<string, string[]>();
      for (const line of branchResult.stdout.split("\n")) {
        const [sha, refname, symref] = line.split("\0");
        if (!sha || !refname || symref) continue;
        const name = refname.startsWith("refs/heads/")
          ? refname.slice("refs/heads/".length)
          : refname.startsWith("refs/remotes/")
            ? refname.slice("refs/remotes/".length)
            : null;
        if (!name) continue;
        const branches = branchesBySha.get(sha) ?? [];
        branches.push(name);
        branchesBySha.set(sha, branches);
      }
      return {
        hasMore,
        commits: commits.map((commit) => ({
          ...commit,
          pushStatus:
            unpushed === null
              ? ("unknown" as const)
              : unpushed.has(commit.sha)
                ? ("unpushed" as const)
                : ("pushed" as const),
          tags: tagsBySha.get(commit.sha) ?? [],
          branches: branchesBySha.get(commit.sha) ?? [],
        })),
      };
    });

  const readCommit: GitCoreShape["readCommit"] = (input) =>
    Effect.gen(function* () {
      const result = yield* executeGit(
        "GitCore.readCommit",
        input.cwd,
        [
          "show",
          "--format=",
          "--root",
          "-m",
          "--first-parent",
          "--patch",
          "--no-color",
          "--no-ext-diff",
          input.sha,
        ],
        { timeoutMs: 10_000, maxOutputBytes: 5_000_000, outputMode: "truncate" },
      );
      return { patch: result.stdout, truncated: result.stdoutTruncated === true };
    });

  const listLocalBranchNames: GitCoreShape["listLocalBranchNames"] = (cwd) =>
    runGitStdout("GitCore.listLocalBranchNames", cwd, [
      "branch",
      "--list",
      "--format=%(refname:short)",
    ]).pipe(
      Effect.map((stdout) =>
        stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      ),
    );
  return {
    readRangeContext,
    readConfigValue,
    listBranches,
    listRecentCommits,
    readCommit,
    listLocalBranchNames,
  };
});

export const GitRefsLive = Layer.effect(GitRefs, makeGitRefs);
