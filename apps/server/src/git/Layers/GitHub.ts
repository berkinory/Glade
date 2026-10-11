import { readFile } from "node:fs/promises";
import { isValidGitHubRepositoryNameWithOwner } from "@glade/shared/git/githubRepository";
import { Effect, Layer } from "effect";

import { runProcess } from "../../platform/processRunner";
import { makeKeyedSingleFlightCache } from "../../pullRequests/KeyedSingleFlightCache";
import { GitHubError } from "../Errors.ts";
import { makeGitHubCredentials, GITHUB_HOST } from "../github/gitHubCredentials.ts";
import { makeAliasedBatcher } from "../github/gitHubGraphQlBatcher.ts";
import { makeGitHubHttp, type GitHubRestResponse } from "../github/gitHubHttp.ts";
import { GitHubRateLimits, isGitHubRateLimitMessage } from "../github/gitHubRateLimits.ts";
import {
  makeGitHubRepositoryContext,
  toRepositoryRef,
  type GitHubRepositoryRef,
} from "../github/gitHubRepositoryContext.ts";
import {
  listPullRequests as searchPullRequests,
  readJobLog,
  readPullRequestDetail,
  readPullRequestDiff,
  rerunFailedJobs,
} from "../github/pullRequestBrowse.ts";
import {
  decodePullRequestSummaries,
  LIST_PULL_REQUESTS_QUERY,
  MARK_READY_MUTATION,
  parseHeadSelector,
  parsePullRequestUrl,
  pullRequestByNumberQuery,
  pullRequestsByHeadQuery,
} from "../github/pullRequestQueries.ts";
import { makeCommitAuthorAvatars } from "../github/commitAuthorAvatars.ts";
import { makePullRequestReviewReader } from "../github/pullRequestReviewReader.ts";
import { GitCommands } from "../Services/GitCommands";
import { GitCore } from "../Services/GitCore";
import {
  GitHub,
  type GitHubAccount,
  type GitHubPullRequestSummary,
  type GitHubShape,
} from "../Services/GitHub.ts";
import { GitCommandsLive } from "./GitCommands";
import { GitCoreLive } from "./GitCore";

const CLI_TIMEOUT_MS = 30_000;
const LOOKUP_TTL_MS = 20_000;
const REPOSITORY_TTL_MS = 10 * 60_000;
const LIST_PAGE_SIZE = 100;

interface RepositoryInfo {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
  readonly defaultBranch: string | null;
}

function cliError(error: unknown): GitHubError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Command not found: gh")) {
    return new GitHubError({
      operation: "cli",
      reason: "not-installed",
      detail: "GitHub CLI (`gh`) is required but not available on PATH.",
    });
  }
  if (/not logged in|gh auth login|authentication failed|bad credentials|http 401/i.test(message)) {
    return new GitHubError({
      operation: "cli",
      reason: "not-authenticated",
      detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
    });
  }
  return new GitHubError({
    operation: "cli",
    reason: isGitHubRateLimitMessage(message) ? "rate-limited" : "other",
    detail: `GitHub CLI command failed: ${message}`,
  });
}

function toAccount(value: unknown): GitHubAccount | null {
  if (typeof value !== "object" || value === null) return null;
  const { login, avatar_url: avatarUrl } = value as { login?: unknown; avatar_url?: unknown };
  return typeof login === "string" && login.trim()
    ? { login: login.trim(), avatarUrl: typeof avatarUrl === "string" ? avatarUrl : null }
    : null;
}

const invalidInput = (operation: string, detail: string) =>
  new GitHubError({ operation, reason: "other", detail });

const makeGitHub = Effect.gen(function* () {
  const { withPermit } = yield* GitCommands;
  const gitCore = yield* GitCore;
  const credentials = yield* makeGitHubCredentials;
  const limits = new GitHubRateLimits();
  const http = yield* makeGitHubHttp(credentials, limits);
  const repositories = yield* makeGitHubRepositoryContext(gitCore);
  const headLookups = yield* makeAliasedBatcher(http, pullRequestsByHeadQuery);
  const numberLookups = yield* makeAliasedBatcher(http, pullRequestByNumberQuery);
  const reviews = makePullRequestReviewReader(http);
  const commitAuthorAvatars = makeCommitAuthorAvatars(http);
  const lookupCache = yield* makeKeyedSingleFlightCache<GitHubPullRequestSummary, GitHubError>({
    maxEntries: 256,
    ttlMs: LOOKUP_TTL_MS,
  });
  const listCache = yield* makeKeyedSingleFlightCache<
    ReadonlyArray<GitHubPullRequestSummary>,
    GitHubError
  >({ maxEntries: 256, ttlMs: LOOKUP_TTL_MS });
  const repositoryCache = yield* makeKeyedSingleFlightCache<RepositoryInfo, GitHubError>({
    maxEntries: 128,
    ttlMs: REPOSITORY_TTL_MS,
  });
  const viewerCache = yield* makeKeyedSingleFlightCache<GitHubAccount, GitHubError>({
    maxEntries: 8,
    ttlMs: REPOSITORY_TTL_MS,
  });

  const afterMutation = (repository: GitHubRepositoryRef, number?: number) =>
    Effect.all([lookupCache.invalidateAll, listCache.invalidateAll], { discard: true }).pipe(
      Effect.tap(() =>
        Effect.sync(() => number !== undefined && reviews.invalidate(repository, number)),
      ),
    );

  // The CLI stays for `gh pr checkout` and repository creation, which configure git or run flows the
  // API cannot replace; every read and other write goes over HTTPS.
  const execute: GitHubShape["execute"] = (input) =>
    withPermit(
      Effect.tryPromise({
        try: (signal) =>
          runProcess("gh", input.args, {
            cwd: input.cwd,
            timeoutMs: input.timeoutMs ?? CLI_TIMEOUT_MS,
            signal,
            env: { ...process.env, ...input.env, GH_HOST: GITHUB_HOST, GH_PROMPT_DISABLED: "1" },
            ...(input.maxBufferBytes !== undefined ? { maxBufferBytes: input.maxBufferBytes } : {}),
            ...(input.outputMode !== undefined ? { outputMode: input.outputMode } : {}),
            ...(input.allowNonZeroExit !== undefined
              ? { allowNonZeroExit: input.allowNonZeroExit }
              : {}),
            ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
            ...(input.onStdoutChunk !== undefined ? { onStdoutChunk: input.onStdoutChunk } : {}),
            ...(input.onStderrChunk !== undefined ? { onStderrChunk: input.onStderrChunk } : {}),
          }),
        catch: cliError,
      }),
      input.priority,
      "network",
    ).pipe(
      Effect.catchTag("GitCommandError", (busy) =>
        Effect.fail(new GitHubError({ operation: "cli", reason: "other", detail: busy.detail })),
      ),
    );

  const repositoryInfo = (nameWithOwner: string) =>
    repositoryCache.get(
      nameWithOwner,
      http
        .rest({
          operation: "getRepository",
          path: `/repos/${nameWithOwner}`,
          priority: "foreground",
        })
        .pipe(
          Effect.flatMap((response) => {
            const body = response.body as {
              full_name?: string;
              html_url?: string;
              ssh_url?: string;
              default_branch?: string;
            } | null;
            return body?.full_name && body.html_url && body.ssh_url
              ? Effect.succeed({
                  nameWithOwner: body.full_name,
                  url: body.html_url,
                  sshUrl: body.ssh_url,
                  defaultBranch: body.default_branch ?? null,
                })
              : Effect.fail(invalidInput("getRepository", "GitHub returned no repository."));
          }),
        ),
    );

  const listByHead = (
    cwd: string,
    headSelector: string,
    states: "open" | "all",
    limit: number,
    priority: "foreground" | "background",
  ) =>
    Effect.gen(function* () {
      const repository = yield* repositories.resolve(cwd);
      const head = parseHeadSelector(headSelector);
      // Owner-qualified selectors are filtered after the fact, so fetch enough to survive filtering.
      const first = head.owner ? Math.max(limit, 10) : limit;
      return yield* listCache.get(
        [repository.nameWithOwner, headSelector, states, first].join("\u0000"),
        headLookups.load(
          { repository, headBranch: head.branch, headOwner: head.owner, states, limit: first },
          priority,
        ),
      );
    });

  const listRecent = (cwd: string, limit: number, priority: "foreground" | "background") =>
    Effect.gen(function* () {
      const repository = yield* repositories.resolve(cwd);
      return yield* listCache.get(
        [repository.nameWithOwner, "*", limit].join("\u0000"),
        Effect.gen(function* () {
          const collected: GitHubPullRequestSummary[] = [];
          let after: string | null = null;
          do {
            const data: unknown = yield* http.graphql({
              operation: "listPullRequests",
              query: LIST_PULL_REQUESTS_QUERY,
              variables: {
                owner: repository.owner,
                name: repository.name,
                states: ["OPEN", "CLOSED", "MERGED"],
                first: Math.min(LIST_PAGE_SIZE, limit - collected.length),
                after,
              },
              priority,
            });
            const connection:
              | {
                  nodes?: unknown[];
                  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
                }
              | undefined = (
              data as {
                repository?: {
                  pullRequests?: {
                    nodes?: unknown[];
                    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
                  };
                };
              } | null
            )?.repository?.pullRequests;
            collected.push(...decodePullRequestSummaries(connection?.nodes ?? []));
            const cursor: string | null = connection?.pageInfo?.endCursor ?? null;
            // A cursor GitHub already returned would loop forever.
            after = connection?.pageInfo?.hasNextPage && cursor && cursor !== after ? cursor : null;
          } while (after && collected.length < limit);
          return collected;
        }),
      );
    });

  const getPullRequest: GitHubShape["getPullRequest"] = (input) =>
    Effect.gen(function* () {
      const reference = input.reference.trim();
      const fromUrl = parsePullRequestUrl(reference);
      const repository = fromUrl
        ? toRepositoryRef(fromUrl.nameWithOwner)
        : yield* repositories.resolve(input.cwd);
      if (!repository) return yield* invalidInput("getPullRequest", "Invalid pull request URL.");
      const number = fromUrl?.number ?? (/^\d+$/.test(reference) ? Number(reference) : null);
      if (number === null) {
        const [latest] = yield* listByHead(input.cwd, reference, "all", 1, "foreground");
        if (!latest) {
          return yield* new GitHubError({
            operation: "getPullRequest",
            reason: "not-found",
            detail: "Pull request not found. Check the PR number or URL and try again.",
          });
        }
        return latest;
      }
      return yield* lookupCache.get(
        `${repository.nameWithOwner}#${number}`,
        numberLookups.load({ repository, number }, "foreground"),
      );
    });

  const withRepository = <A>(
    cwd: string,
    use: (repository: GitHubRepositoryRef) => Effect.Effect<A, GitHubError>,
  ) => repositories.resolve(cwd).pipe(Effect.flatMap(use));

  return {
    execute,
    getViewer: () =>
      credentials.resolve.pipe(
        Effect.flatMap((credential) =>
          viewerCache.get(
            credential.fingerprint,
            http.rest({ operation: "getViewer", path: "/user", priority: "foreground" }).pipe(
              Effect.flatMap((response) => {
                const account = toAccount(response.body);
                return account
                  ? Effect.succeed(account)
                  : Effect.fail(invalidInput("getViewer", "GitHub returned no viewer login."));
              }),
            ),
          ),
        ),
      ),
    listViewerOrganizations: () =>
      Effect.gen(function* () {
        const accounts: GitHubAccount[] = [];
        let next: string | null = "/user/orgs?per_page=100";
        while (next) {
          const page: GitHubRestResponse = yield* http.rest({
            operation: "listViewerOrganizations",
            path: next,
            priority: "foreground",
          });
          for (const entry of Array.isArray(page.body) ? page.body : []) {
            const account = toAccount(entry);
            if (account) accounts.push(account);
          }
          next = page.nextPage;
        }
        return accounts;
      }),
    resolveCommitAuthorAvatars: (input) =>
      withRepository(input.cwd, (repository) => commitAuthorAvatars(repository, input.commits)),
    listOpenPullRequests: (input) =>
      listByHead(input.cwd, input.headSelector, "open", input.limit ?? 1, "foreground"),
    listPullRequests: (input) =>
      input.headSelector
        ? listByHead(
            input.cwd,
            input.headSelector,
            "all",
            input.limit ?? 20,
            input.priority ?? "foreground",
          )
        : listRecent(input.cwd, input.limit ?? 20, input.priority ?? "foreground"),
    getPullRequest,
    getRepositoryCloneUrls: (input) =>
      isValidGitHubRepositoryNameWithOwner(input.repository.trim())
        ? repositoryInfo(input.repository.trim()).pipe(
            Effect.map(({ nameWithOwner, url, sshUrl }) => ({ nameWithOwner, url, sshUrl })),
          )
        : Effect.fail(
            invalidInput("getRepositoryCloneUrls", "Invalid GitHub repository identity."),
          ),
    createPullRequest: (input) =>
      withRepository(input.cwd, (repository) =>
        Effect.tryPromise({
          try: () => readFile(input.bodyFile, "utf8"),
          catch: () => invalidInput("createPullRequest", "Could not read the pull request body."),
        }).pipe(
          Effect.flatMap((body) =>
            http.rest({
              operation: "createPullRequest",
              method: "POST",
              path: `/repos/${repository.nameWithOwner}/pulls`,
              priority: "foreground",
              body: {
                title: input.title,
                head: input.headSelector,
                base: input.baseBranch,
                body,
                draft: input.draft === true,
              },
            }),
          ),
          Effect.ensuring(afterMutation(repository)),
          Effect.asVoid,
        ),
      ),
    getDefaultBranch: (input) =>
      withRepository(input.cwd, (repository) =>
        repositoryInfo(repository.nameWithOwner).pipe(Effect.map((info) => info.defaultBranch)),
      ),
    getPullRequestReview: (input) =>
      withRepository(input.cwd, (repository) =>
        reviews
          .read({ repository, number: input.number, priority: input.priority ?? "foreground" })
          .pipe(Effect.map((result) => result.review)),
      ),
    mergePullRequest: (input) =>
      withRepository(input.cwd, (repository) =>
        http
          .rest({
            operation: "mergePullRequest",
            method: "PUT",
            path: `/repos/${repository.nameWithOwner}/pulls/${input.number}/merge`,
            priority: "foreground",
            body: { merge_method: input.method },
          })
          .pipe(Effect.ensuring(afterMutation(repository, input.number)), Effect.asVoid),
      ),
    markPullRequestReady: (input) =>
      withRepository(input.cwd, (repository) =>
        reviews.read({ repository, number: input.number, priority: "foreground" }).pipe(
          Effect.flatMap(({ nodeId }) =>
            http.graphql({
              operation: "markPullRequestReady",
              query: MARK_READY_MUTATION,
              variables: { id: nodeId },
              priority: "foreground",
            }),
          ),
          Effect.ensuring(afterMutation(repository, input.number)),
          Effect.asVoid,
        ),
      ),
    updatePullRequestBranch: (input) =>
      withRepository(input.cwd, (repository) =>
        http
          .rest({
            operation: "updatePullRequestBranch",
            method: "PUT",
            path: `/repos/${repository.nameWithOwner}/pulls/${input.number}/update-branch`,
            priority: "foreground",
          })
          .pipe(Effect.ensuring(afterMutation(repository, input.number)), Effect.asVoid),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
    listRepositoryPullRequests: (input) =>
      withRepository(input.cwd, (repository) => searchPullRequests(http, repository, input.filter)),
    getPullRequestDetail: (input) =>
      withRepository(input.cwd, (repository) =>
        readPullRequestDetail(http, repository, input.number),
      ),
    getPullRequestDiff: (input) =>
      withRepository(input.cwd, (repository) =>
        readPullRequestDiff(http, repository, input.number),
      ),
    getCheckLog: (input) =>
      withRepository(input.cwd, (repository) => readJobLog(http, repository, input.jobId)),
    rerunFailedJobs: (input) =>
      withRepository(input.cwd, (repository) => rerunFailedJobs(http, repository, input.runId)),
  } satisfies GitHubShape;
});

export const GitHubLive = Layer.effect(GitHub, makeGitHub).pipe(
  Layer.provide(Layer.mergeAll(GitCommandsLive, GitCoreLive)),
);
