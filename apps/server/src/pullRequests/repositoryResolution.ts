import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@glade/shared/githubRepository";
import { Effect } from "effect";

import type { GitCoreShape } from "../git/Services/GitCore";

class RepositoryResolutionError extends Error {
  readonly _tag = "RepositoryResolutionError";
}

interface GitHubRepositoryLink {
  readonly nameWithOwner: string;
  readonly url: string;
}

export interface GitHubRepositoryInventory {
  readonly repositories: ReadonlyArray<GitHubRepositoryLink>;
  // False means discovery was incomplete and must never drive destructive cleanup.
  readonly authoritative: boolean;
}

function normalizeGitRemoteName(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 && normalized !== "." ? normalized : null;
}

function uniqueRemoteCandidates(candidates: ReadonlyArray<string | null>): string[] {
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeGitRemoteName(candidate);
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

function readCurrentBranch(git: GitCoreShape, cwd: string) {
  const operation = "PullRequestService.githubRepository.currentBranch";
  return git
    .execute({
      operation,
      cwd,
      args: ["branch", "--show-current"],
      allowNonZeroExit: true,
      maxOutputBytes: 16_384,
    })
    .pipe(
      Effect.flatMap((result) => {
        if (result.code !== 0) {
          if (/not a git repository/i.test(result.stderr)) return Effect.succeed(undefined);
          return Effect.fail(
            new RepositoryResolutionError(
              result.stderr.trim() || `${operation} failed with exit code ${result.code}.`,
            ),
          );
        }
        const trimmed = result.stdout.trim();
        return Effect.succeed(trimmed.length > 0 ? trimmed : null);
      }),
    );
}

function escapeGitConfigKeyForRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

type RepositoryConfig = {
  readonly branchRemote: string | null;
  readonly pushDefaultRemote: string | null;
  readonly remoteUrls: ReadonlyMap<string, string>;
};

function gitHubRepositoryLinkFromRemoteUrl(remoteUrl: string): GitHubRepositoryLink | null {
  const nameWithOwner = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remoteUrl);
  return nameWithOwner ? { nameWithOwner, url: `https://github.com/${nameWithOwner}` } : null;
}

function parseRepositoryConfig(stdout: string, branch: string | null): RepositoryConfig {
  let branchRemote: string | null = null;
  let pushDefaultRemote: string | null = null;
  const remoteUrls = new Map<string, string>();
  const branchRemoteKey = branch ? `branch.${branch}.remote`.toLowerCase() : null;

  for (const record of stdout.split("\0")) {
    if (!record) continue;
    const separatorIndex = record.indexOf("\n");
    if (separatorIndex < 0) continue;
    const key = record.slice(0, separatorIndex).replace(/\r$/, "");
    const value = record.slice(separatorIndex + 1).trim();
    const normalizedValue = normalizeGitRemoteName(value);
    if (!normalizedValue) continue;

    const lowerKey = key.toLowerCase();
    if (branchRemoteKey && lowerKey === branchRemoteKey) {
      branchRemote = normalizedValue;
      continue;
    }
    if (lowerKey === "remote.pushdefault") {
      pushDefaultRemote = normalizedValue;
      continue;
    }
    const remoteMatch = /^remote\.(.+)\.url$/i.exec(key);
    if (remoteMatch?.[1] && !remoteUrls.has(remoteMatch[1])) {
      remoteUrls.set(remoteMatch[1], value);
    }
  }

  return { branchRemote, pushDefaultRemote, remoteUrls };
}

function readRepositoryConfig(git: GitCoreShape, cwd: string, branch: string | null) {
  const branchPattern = branch ? `branch\\.${escapeGitConfigKeyForRegex(branch)}\\.remote|` : "";
  return git
    .execute({
      operation: "PullRequestService.githubRepository.config",
      cwd,
      args: [
        "config",
        "--null",
        "--get-regexp",
        `^(${branchPattern}remote\\.pushDefault|remote\\..*\\.url)$`,
      ],
      allowNonZeroExit: true,
      maxOutputBytes: 256 * 1024,
    })
    .pipe(
      Effect.flatMap((result) => {
        if (result.code === 0) return Effect.succeed(parseRepositoryConfig(result.stdout, branch));

        if (result.code === 1 && result.stdout.length === 0 && result.stderr.trim().length === 0) {
          return Effect.succeed(parseRepositoryConfig("", branch));
        }
        return Effect.fail(
          new RepositoryResolutionError(
            result.stderr.trim() ||
              `PullRequestService.githubRepository.config failed with exit code ${result.code}.`,
          ),
        );
      }),
    );
}

function readExpandedRemoteUrl(git: GitCoreShape, cwd: string, remoteName: string) {
  const operation = "PullRequestService.githubRepository.expandedRemoteUrl";
  return git
    .execute({
      operation,
      cwd,

      args: ["remote", "get-url", remoteName],
      allowNonZeroExit: true,
      maxOutputBytes: 64 * 1024,
    })
    .pipe(
      Effect.flatMap((result) => {
        if (result.code !== 0) {
          return Effect.fail(
            new RepositoryResolutionError(
              result.stderr.trim() || `${operation} failed with exit code ${result.code}.`,
            ),
          );
        }
        return Effect.succeed(result.stdout.trim());
      }),
    );
}

function resolveGitHubRemote(
  git: GitCoreShape,
  cwd: string,
  remoteName: string,
  configuredUrl: string,
) {
  const direct = gitHubRepositoryLinkFromRemoteUrl(configuredUrl);
  if (direct) return Effect.succeed(direct);

  return readExpandedRemoteUrl(git, cwd, remoteName).pipe(
    Effect.map(gitHubRepositoryLinkFromRemoteUrl),
  );
}

export function resolveGitHubRepositories(git: GitCoreShape, cwd: string) {
  return Effect.gen(function* () {
    const branch = yield* readCurrentBranch(git, cwd);
    if (branch === undefined) {
      return { repositories: [], authoritative: true } satisfies GitHubRepositoryInventory;
    }
    // This is the authoritative boundary. A failed local-config inventory must remain an error rather
    // than becoming an empty list, because consumers may remove state for repositories not returned.
    // Reading the relevant keys together avoids one process per config/remote.
    const { branchRemote, pushDefaultRemote, remoteUrls } = yield* readRepositoryConfig(
      git,
      cwd,
      branch,
    );

    const remoteNames = [...remoteUrls.keys()].toSorted((left, right) => left.localeCompare(right));
    const configuredRemoteNames = new Set(remoteNames);
    const candidates = uniqueRemoteCandidates([
      "origin",
      pushDefaultRemote,
      branchRemote,
      ...remoteNames,
    ]).flatMap((remoteName) => {
      if (!configuredRemoteNames.has(remoteName)) return [];
      const configuredUrl = remoteUrls.get(remoteName);
      return configuredUrl ? [{ remoteName, configuredUrl }] : [];
    });
    for (const { remoteName, configuredUrl } of candidates) {
      const repository = yield* resolveGitHubRemote(git, cwd, remoteName, configuredUrl);
      if (repository) {
        return {
          repositories: [repository],
          authoritative: true,
        } satisfies GitHubRepositoryInventory;
      }
    }
    return { repositories: [], authoritative: true } satisfies GitHubRepositoryInventory;
  });
}

export function resolveGitHubRepository(git: GitCoreShape, cwd: string) {
  return resolveGitHubRepositories(git, cwd).pipe(
    Effect.map(({ repositories }) => ({ repository: repositories[0] ?? null, repositories })),
  );
}
