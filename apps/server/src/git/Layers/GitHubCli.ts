import { GitHubReadBudget, gitHubBudgetIdentity, isGitHubRateLimit } from "../gitHubReadBudget";
import { Effect, Layer, Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "@glade/contracts/core/baseSchemas";
import { isValidGitHubRepositoryNameWithOwner } from "@glade/shared/git/githubRepository";

import { runProcess, type ProcessRunResult } from "../../platform/processRunner";
import { makeKeyedSingleFlightCache } from "../../pullRequests/KeyedSingleFlightCache";
import { GitCommands } from "../Services/GitCommands";
import { GitCommandsLive } from "./GitCommands";
import { GitHubCliError } from "../Errors.ts";
import {
  GitHubCli,
  PULL_REQUEST_SUMMARY_JSON_FIELDS,
  type GitHubRepositoryCloneUrls,
  type GitHubCliShape,
  type GitHubPullRequestSummary,
} from "../Services/GitHubCli.ts";

function isReadOnly(args: ReadonlyArray<string>): boolean {
  return (
    (args[0] === "pr" && ["list", "view", "diff", "checks"].includes(args[1] ?? "")) ||
    (args[0] === "repo" && args[1] === "view") ||
    (args[0] === "api" &&
      ["user", "user/orgs?per_page=100"].includes(args[1] ?? "") &&
      !args.includes("--method") &&
      !args.includes("-X"))
  );
}

const DEFAULT_TIMEOUT_MS = 30_000;
const GITHUB_HOST = "github.com";

function normalizeGitHubCliError(operation: "execute" | "stdout", error: unknown): GitHubCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: gh")) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI (`gh`) is required but not available on PATH.",
        reason: "not-installed",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("authentication failed") ||
      lower.includes("not logged in") ||
      lower.includes("gh auth login") ||
      lower.includes("no oauth token") ||
      lower.includes("bad credentials") ||
      lower.includes("http 401") ||
      lower.includes("401 unauthorized")
    ) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
        reason: "not-authenticated",
        cause: error,
      });
    }

    if (isGitHubRateLimit(error.message)) {
      return new GitHubCliError({
        operation,
        detail: error.message,
        reason: "rate-limited",
        cause: error,
      });
    }

    if (
      lower.includes("could not resolve to a pullrequest") ||
      lower.includes("repository.pullrequest") ||
      lower.includes("no pull requests found for branch") ||
      lower.includes("pull request not found")
    ) {
      return new GitHubCliError({
        operation,
        detail: "Pull request not found. Check the PR number or URL and try again.",
        reason: "other",
        cause: error,
      });
    }

    return new GitHubCliError({
      operation,
      detail: `GitHub CLI command failed: ${error.message}`,
      reason: "other",
      cause: error,
    });
  }

  return new GitHubCliError({
    operation,
    detail: "GitHub CLI command failed.",
    reason: "other",
    cause: error,
  });
}

function normalizePullRequestMergeability(
  mergeable: string | null | undefined,
): "mergeable" | "conflicting" | "unknown" {
  switch (mergeable) {
    case "MERGEABLE":
      return "mergeable";
    case "CONFLICTING":
      return "conflicting";
    default:
      return "unknown";
  }
}

function normalizeDiffCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizePullRequestState(input: {
  state?: string | null | undefined;
  mergedAt?: string | null | undefined;
}): "open" | "closed" | "merged" {
  const mergedAt = input.mergedAt;
  const state = input.state;
  if ((typeof mergedAt === "string" && mergedAt.trim().length > 0) || state === "MERGED") {
    return "merged";
  }
  if (state === "CLOSED") {
    return "closed";
  }
  return "open";
}

const RawGitHubPullRequestSchema = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  isDraft: Schema.optional(Schema.NullOr(Schema.Boolean)),
  mergeable: Schema.optional(Schema.NullOr(Schema.String)),
  additions: Schema.optional(Schema.NullOr(Schema.Number)),
  deletions: Schema.optional(Schema.NullOr(Schema.Number)),
  changedFiles: Schema.optional(Schema.NullOr(Schema.Number)),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRepository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nameWithOwner: Schema.String,
      }),
    ),
  ),
  headRepositoryOwner: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: Schema.String,
      }),
    ),
  ),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});

function normalizePullRequestSummary(
  raw: Schema.Schema.Type<typeof RawGitHubPullRequestSchema>,
): GitHubPullRequestSummary {
  const headRepositoryNameWithOwner = raw.headRepository?.nameWithOwner ?? null;
  const headRepositoryOwnerLogin =
    raw.headRepositoryOwner?.login ??
    (typeof headRepositoryNameWithOwner === "string" && headRepositoryNameWithOwner.includes("/")
      ? (headRepositoryNameWithOwner.split("/")[0] ?? null)
      : null);
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    state: normalizePullRequestState(raw),
    isDraft: raw.isDraft === true,
    mergeability: normalizePullRequestMergeability(raw.mergeable),
    additions: normalizeDiffCount(raw.additions),
    deletions: normalizeDiffCount(raw.deletions),
    changedFiles: normalizeDiffCount(raw.changedFiles),
    updatedAt: raw.updatedAt?.trim() || null,
    ...(typeof raw.isCrossRepository === "boolean"
      ? { isCrossRepository: raw.isCrossRepository }
      : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

function decodeGitHubJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation:
    | "listOpenPullRequests"
    | "listPullRequests"
    | "getPullRequest"
    | "getRepositoryCloneUrls",
  invalidDetail: string,
): Effect.Effect<S["Type"], GitHubCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHubCliError({
          operation,
          detail: error instanceof Error ? `${invalidDetail}: ${error.message}` : invalidDetail,
          cause: error,
        }),
    ),
  );
}

const decodeRawPullRequestEntry = Schema.decodeUnknownSync(RawGitHubPullRequestSchema);

// Exported so test fakes parse fixtures through the exact same schema/normalization as the live
// layer instead of re-implementing it. Entries are decoded individually: one malformed PR (a gh
// quirk or API oddity) must not hide the healthy PRs in the same list.
export function decodePullRequestListJson(
  raw: string,
  operation: "listOpenPullRequests" | "listPullRequests" = "listPullRequests",
): Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return Effect.succeed([]);
  }
  return decodeGitHubJson(
    trimmed,
    Schema.Array(Schema.Unknown),
    operation,
    "GitHub CLI returned invalid PR list JSON.",
  ).pipe(
    Effect.map((entries) =>
      entries.flatMap((entry) => {
        try {
          return [normalizePullRequestSummary(decodeRawPullRequestEntry(entry))];
        } catch {
          return [];
        }
      }),
    ),
  );
}

const PULL_REQUEST_LOOKUP_CACHE_TTL_MS = 20_000;
const PULL_REQUEST_LOOKUP_CACHE_MAX_ENTRIES = 256;

const makeGitHubCli = Effect.gen(function* () {
  const { withPermit } = yield* GitCommands;
  const readBudget = new GitHubReadBudget();
  const pullRequestLookupCache = yield* makeKeyedSingleFlightCache<
    GitHubPullRequestSummary,
    GitHubCliError
  >({
    maxEntries: PULL_REQUEST_LOOKUP_CACHE_MAX_ENTRIES,
    ttlMs: PULL_REQUEST_LOOKUP_CACHE_TTL_MS,
  });
  const pullRequestHeadListCache = yield* makeKeyedSingleFlightCache<
    ReadonlyArray<GitHubPullRequestSummary>,
    GitHubCliError
  >({
    maxEntries: PULL_REQUEST_LOOKUP_CACHE_MAX_ENTRIES,
    ttlMs: PULL_REQUEST_LOOKUP_CACHE_TTL_MS,
  });

  const invalidatePullRequestLookups = Effect.all(
    [pullRequestLookupCache.invalidateAll, pullRequestHeadListCache.invalidateAll],
    { discard: true },
  );

  const executeProcess: GitHubCliShape["execute"] = (input) => {
    const env = { ...process.env, ...input.env, GH_HOST: GITHUB_HOST };
    const identity = gitHubBudgetIdentity(env);
    const readOnly = isReadOnly(input.args);
    const operation = Effect.tryPromise({
      try: (signal) =>
        runProcess("gh", input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          signal,

          env,
          ...(input.maxBufferBytes !== undefined ? { maxBufferBytes: input.maxBufferBytes } : {}),
          ...(input.outputMode !== undefined ? { outputMode: input.outputMode } : {}),
          ...(input.allowNonZeroExit !== undefined
            ? { allowNonZeroExit: input.allowNonZeroExit }
            : {}),
          ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
          ...(input.onStdoutChunk !== undefined ? { onStdoutChunk: input.onStdoutChunk } : {}),
          ...(input.onStderrChunk !== undefined ? { onStderrChunk: input.onStderrChunk } : {}),
        }),
      catch: (error) => normalizeGitHubCliError("execute", error),
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (result.code !== 0) readBudget.record(identity, result.stderr);
        }),
      ),
      Effect.tapError((error) => Effect.sync(() => readBudget.record(identity, error.detail))),
      Effect.mapError((error) =>
        error.reason === "rate-limited" ? (readBudget.check(identity) ?? error) : error,
      ),
    );
    // Check after admission as well: another process may exhaust the budget while this waits.
    const admitted = Effect.suspend(() => {
      const paused = readOnly ? readBudget.check(identity) : null;
      return paused ? Effect.fail(paused) : operation;
    });
    return Effect.suspend(() => {
      const paused = readOnly ? readBudget.check(identity) : null;
      return paused
        ? Effect.fail(paused)
        : withPermit(admitted, input.priority, "network").pipe(
            Effect.catchTag("GitCommandError", (busy) =>
              Effect.fail(new GitHubCliError({ operation: "execute", detail: busy.detail })),
            ),
          );
    });
  };

  const readFlights = yield* makeKeyedSingleFlightCache<ProcessRunResult, GitHubCliError>({
    maxEntries: 256,
    ttlMs: 0,
  });
  const execute: GitHubCliShape["execute"] = (input) => {
    const execution = executeProcess(input);
    const readOnly = isReadOnly(input.args);
    if (
      !readOnly ||
      input.env ||
      input.stdin !== undefined ||
      input.onStdoutChunk ||
      input.onStderrChunk ||
      input.args.includes("--watch")
    )
      return execution;
    return readFlights.get(
      JSON.stringify([
        gitHubBudgetIdentity(process.env),
        input.priority,
        input.cwd,
        input.args,
        input.timeoutMs,
        input.maxBufferBytes,
        input.outputMode,
        input.allowNonZeroExit,
      ]),
      execution,
    );
  };

  const validateRepository = (
    repository: string,
    operation: string,
  ): Effect.Effect<string, GitHubCliError> => {
    const normalized = repository.trim();
    return isValidGitHubRepositoryNameWithOwner(normalized)
      ? Effect.succeed(normalized)
      : Effect.fail(
          new GitHubCliError({
            operation,
            detail: "Invalid GitHub repository identity.",
            reason: "other",
          }),
        );
  };

  const listPullRequestsWithState = (
    input: {
      readonly cwd: string;
      readonly headSelector?: string;
      readonly limit?: number;
      readonly priority?: "foreground" | "background";
    },
    options: {
      readonly state: "open" | "all";
      readonly defaultLimit: number;
      readonly operation: "listOpenPullRequests" | "listPullRequests";
    },
  ) =>
    execute({
      cwd: input.cwd,
      ...(input.priority ? { priority: input.priority } : {}),
      args: [
        "pr",
        "list",
        ...(input.headSelector ? ["--head", input.headSelector] : []),
        "--state",
        options.state,
        "--limit",
        String(input.limit ?? options.defaultLimit),
        "--json",
        PULL_REQUEST_SUMMARY_JSON_FIELDS,
      ],
    }).pipe(
      Effect.flatMap((result) => decodePullRequestListJson(result.stdout, options.operation)),
    );

  const service = {
    execute,
    getViewerLogin: (input) =>
      execute({
        cwd: input.cwd,
        args: ["api", "user", "--hostname", GITHUB_HOST, "--jq", ".login"],
      }).pipe(
        Effect.flatMap((result) => {
          const login = result.stdout.trim();
          return login.length > 0
            ? Effect.succeed(login)
            : Effect.fail(
                new GitHubCliError({
                  operation: "getViewerLogin",
                  detail: "GitHub CLI returned an empty viewer login.",
                  reason: "other",
                }),
              );
        }),
      ),
    listOpenPullRequests: (input) =>
      listPullRequestsWithState(input, {
        state: "open",
        defaultLimit: 1,
        operation: "listOpenPullRequests",
      }),
    listPullRequests: (input) =>
      listPullRequestsWithState(input, {
        state: "all",
        defaultLimit: 20,
        operation: "listPullRequests",
      }),
    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "view", input.reference, "--json", PULL_REQUEST_SUMMARY_JSON_FIELDS],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubPullRequestSchema,
            "getPullRequest",
            "GitHub CLI returned invalid pull request JSON.",
          ),
        ),
        Effect.map(normalizePullRequestSummary),
      ),
    getRepositoryCloneUrls: (input) =>
      validateRepository(input.repository, "getRepositoryCloneUrls").pipe(
        Effect.flatMap((repository) =>
          execute({
            cwd: input.cwd,
            args: [
              "repo",
              "view",

              repository,
              "--json",
              "nameWithOwner,url,sshUrl",
            ],
          }),
        ),
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubRepositoryCloneUrlsSchema,
            "getRepositoryCloneUrls",
            "GitHub CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
          ...(input.draft === true ? ["--draft"] : []),
        ],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
  } satisfies GitHubCliShape;

  return {
    ...service,
    listPullRequests: (input) =>
      pullRequestHeadListCache.get(
        [gitHubBudgetIdentity(process.env), input.cwd, input.headSelector, input.limit ?? ""].join(
          "\u0000",
        ),
        service.listPullRequests(input),
      ),
    getPullRequest: (input) =>
      pullRequestLookupCache.get(
        [gitHubBudgetIdentity(process.env), input.cwd, input.reference].join("\u0000"),
        service.getPullRequest(input),
      ),
    createPullRequest: (input) =>
      service.createPullRequest(input).pipe(Effect.ensuring(invalidatePullRequestLookups)),
  } satisfies GitHubCliShape;
});

export const GitHubCliLive = Layer.effect(GitHubCli, makeGitHubCli).pipe(
  Layer.provide(GitCommandsLive),
);
