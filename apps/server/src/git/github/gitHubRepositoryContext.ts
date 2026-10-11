import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@glade/shared/git/githubRepository";
import { Effect } from "effect";

import { makeKeyedSingleFlightCache } from "../../pullRequests/KeyedSingleFlightCache";
import { GitHubError } from "../Errors.ts";
import type { GitCoreShape } from "../Services/GitCore.ts";

export interface GitHubRepositoryRef {
  readonly owner: string;
  readonly name: string;
  readonly nameWithOwner: string;
}

const REMOTE_PRIORITY = ["upstream", "github", "origin"];
const CONTEXT_TTL_MS = 60_000;

export function toRepositoryRef(nameWithOwner: string): GitHubRepositoryRef | null {
  const [owner, name, extra] = nameWithOwner.split("/");
  return owner && name && extra === undefined ? { owner, name, nameWithOwner } : null;
}

function parseRemotes(stdout: string): { urls: Map<string, string>; resolvedBase: string | null } {
  const urls = new Map<string, string>();
  let resolvedBase: string | null = null;
  for (const record of stdout.split("\0")) {
    const separator = record.indexOf("\n");
    if (separator < 0) continue;
    const match = /^remote\.(.+)\.(url|gh-resolved)$/i.exec(record.slice(0, separator));
    const value = record.slice(separator + 1).trim();
    if (!match?.[1] || !value) continue;
    if (match[2]?.toLowerCase() === "url") {
      if (!urls.has(match[1])) urls.set(match[1], value);
    } else if (value === "base") {
      resolvedBase = match[1];
    }
  }
  return { urls, resolvedBase };
}

/**
 * Resolves the base repository the way `gh` does: a remote marked `gh-resolved=base` wins, then
 * upstream, github and origin. Results are cached briefly so polling never spawns git per request.
 */
export const makeGitHubRepositoryContext = (git: GitCoreShape) =>
  Effect.gen(function* () {
    const cache = yield* makeKeyedSingleFlightCache<GitHubRepositoryRef, GitHubError>({
      maxEntries: 256,
      ttlMs: CONTEXT_TTL_MS,
    });

    const lookup = (cwd: string) =>
      Effect.gen(function* () {
        const config = yield* git
          .execute({
            operation: "GitHub.repositoryContext",
            cwd,
            args: ["config", "--null", "--get-regexp", "^remote\\..*\\.(url|gh-resolved)$"],
            allowNonZeroExit: true,
            maxOutputBytes: 256 * 1024,
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new GitHubError({
                  operation: "repositoryContext",
                  reason: "other",
                  detail: error.message,
                }),
            ),
          );
        const { urls, resolvedBase } = parseRemotes(config.code === 0 ? config.stdout : "");
        const ordered = [
          ...(resolvedBase ? [resolvedBase] : []),
          ...REMOTE_PRIORITY.filter((name) => urls.has(name)),
          ...[...urls.keys()].toSorted(),
        ];
        for (const remote of new Set(ordered)) {
          const direct = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(urls.get(remote) ?? "");
          const nameWithOwner =
            direct ??
            (yield* git
              .execute({
                operation: "GitHub.repositoryContext.expandedUrl",
                cwd,
                args: ["remote", "get-url", remote],
                allowNonZeroExit: true,
                maxOutputBytes: 64 * 1024,
              })
              .pipe(
                Effect.map((result) =>
                  result.code === 0
                    ? parseGitHubRepositoryNameWithOwnerFromRemoteUrl(result.stdout.trim())
                    : null,
                ),
                Effect.orElseSucceed(() => null),
              ));
          const ref = nameWithOwner ? toRepositoryRef(nameWithOwner) : null;
          if (ref) return ref;
        }
        return yield* new GitHubError({
          operation: "repositoryContext",
          reason: "not-found",
          detail: "This repository has no GitHub remote.",
        });
      });

    return {
      resolve: (cwd: string) => cache.get(cwd, lookup(cwd)),
    };
  });
