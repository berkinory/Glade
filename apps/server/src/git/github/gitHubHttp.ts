import { Effect, Semaphore } from "effect";

import { GitHubError } from "../Errors.ts";
import type { GitHubCredentials } from "./gitHubCredentials.ts";
import {
  GitHubRateLimits,
  isGitHubRateLimitMessage,
  type GitHubPriority,
  type GitHubResource,
} from "./gitHubRateLimits.ts";

const API_ORIGIN = "https://api.github.com";
const REQUEST_DEADLINE_MS = 30_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
// GitHub's secondary limits punish bursts; each lane keeps foreground work from queueing behind polls.
const PERMITS_PER_LANE = 4;

export interface GitHubRestRequest {
  readonly operation: string;
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path below the API origin, or an absolute API URL taken from a `Link` header. */
  readonly path: string;
  readonly body?: unknown;
  readonly priority: GitHubPriority;
  readonly etag?: string | null;
  readonly responseType?: "json" | "text";
}

export interface GitHubRestResponse {
  readonly status: number;
  readonly etag: string | null;
  readonly nextPage: string | null;
  readonly body: unknown;
}

export interface GitHubGraphQlRequest {
  readonly operation: string;
  readonly query: string;
  readonly variables?: Record<string, unknown>;
  readonly priority: GitHubPriority;
}

export interface GitHubHttp {
  readonly rest: (request: GitHubRestRequest) => Effect.Effect<GitHubRestResponse, GitHubError>;
  readonly graphql: (request: GitHubGraphQlRequest) => Effect.Effect<unknown, GitHubError>;
}

function nextPageFrom(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part);
    if (match?.[1]) return match[1];
  }
  return null;
}

function messageFrom(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // Non-JSON error bodies are reported as text below.
  }
  return body.slice(0, 300);
}

function failure(
  operation: string,
  reason: GitHubError["reason"],
  detail: string,
  retryAt?: number,
): GitHubError {
  return new GitHubError({
    operation,
    reason,
    detail,
    ...(retryAt !== undefined ? { retryAt } : {}),
  });
}

export const makeGitHubHttp = (credentials: GitHubCredentials, limits: GitHubRateLimits) =>
  Effect.gen(function* () {
    const lanes = {
      foreground: yield* Semaphore.make(PERMITS_PER_LANE),
      background: yield* Semaphore.make(PERMITS_PER_LANE),
    } satisfies Record<GitHubPriority, Semaphore.Semaphore>;

    const send = (input: {
      readonly operation: string;
      readonly resource: GitHubResource;
      readonly priority: GitHubPriority;
      readonly url: string;
      readonly method: string;
      readonly body?: unknown;
      readonly etag?: string | null;
    }) =>
      Effect.gen(function* () {
        const credential = yield* credentials.resolve;
        const scope = credential.fingerprint;
        const blocked = limits.admit(scope, input.resource, input.priority);
        if (blocked) return yield* blocked;
        const lease = limits.lease(scope);
        const response = yield* Effect.tryPromise({
          try: async (signal) => {
            const result = await fetch(input.url, {
              method: input.method,
              signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_DEADLINE_MS)]),
              headers: {
                accept: "application/vnd.github+json",
                authorization: `Bearer ${credential.token}`,
                "user-agent": "glade",
                "x-github-api-version": "2022-11-28",
                ...(input.body !== undefined ? { "content-type": "application/json" } : {}),
                ...(input.etag ? { "if-none-match": input.etag } : {}),
              },
              ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
            });
            const declared = Number(result.headers.get("content-length"));
            if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
              await result.body?.cancel();
              throw new Error("GitHub response exceeded the 8 MB limit.");
            }
            const text = await result.text();
            if (text.length > MAX_RESPONSE_BYTES) {
              throw new Error("GitHub response exceeded the 8 MB limit.");
            }
            return { status: result.status, headers: result.headers, text };
          },
          catch: (error) =>
            failure(
              input.operation,
              "other",
              `GitHub request failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
        });
        limits.observe(scope, input.resource, response.headers);
        const remaining = Number(response.headers.get("x-ratelimit-remaining"));
        const limit = Number(response.headers.get("x-ratelimit-limit"));
        const usage = {
          operation: input.operation,
          resource: response.headers.get("x-ratelimit-resource") ?? input.resource,
          status: response.status,
          remaining,
          used: Number(response.headers.get("x-ratelimit-used")),
        };
        yield* limit > 0 && remaining < limit * 0.2
          ? Effect.logWarning("GitHub rate limit running low", usage)
          : Effect.logDebug("GitHub request", usage);

        if (response.status === 401) {
          yield* credentials.invalidate;
          return yield* failure(
            input.operation,
            "not-authenticated",
            "GitHub rejected the token. Run `gh auth login` and retry.",
          );
        }
        const rateLimited =
          response.status === 429 ||
          (response.status === 403 &&
            (response.headers.get("x-ratelimit-remaining") === "0" ||
              response.headers.get("retry-after") !== null ||
              isGitHubRateLimitMessage(response.text)));
        if (rateLimited) {
          const { retryAtMs } = limits.pause(scope, response.headers);
          return yield* failure(
            input.operation,
            "rate-limited",
            `GitHub rate limit reached; requests resume at ${new Date(retryAtMs).toISOString()}.`,
            retryAtMs,
          );
        }
        if (response.status === 404) {
          return yield* failure(input.operation, "not-found", messageFrom(response.text));
        }
        if (response.status >= 400) {
          return yield* failure(
            input.operation,
            "other",
            `GitHub returned ${response.status}: ${messageFrom(response.text)}`,
          );
        }
        limits.succeeded(scope, lease);
        return { ...response, scope };
      }).pipe(lanes[input.priority].withPermits(1));

    const rest = (request: GitHubRestRequest) =>
      send({
        operation: request.operation,
        resource: "core",
        priority: request.priority,
        url: request.path.startsWith("https://") ? request.path : `${API_ORIGIN}${request.path}`,
        method: request.method ?? "GET",
        body: request.body,
        etag: request.etag ?? null,
      }).pipe(
        Effect.flatMap((response) =>
          Effect.try({
            try: (): GitHubRestResponse => ({
              status: response.status,
              etag: response.headers.get("etag"),
              nextPage: nextPageFrom(response.headers.get("link")),
              body:
                response.status === 304 || response.text.length === 0
                  ? null
                  : request.responseType === "text"
                    ? response.text
                    : JSON.parse(response.text),
            }),
            catch: () => failure(request.operation, "other", "GitHub returned invalid JSON."),
          }),
        ),
      );

    const graphql = (request: GitHubGraphQlRequest) =>
      send({
        operation: request.operation,
        resource: "graphql",
        priority: request.priority,
        url: `${API_ORIGIN}/graphql`,
        method: "POST",
        body: { query: request.query, variables: request.variables ?? {} },
      }).pipe(
        Effect.flatMap((response) => {
          let parsed: {
            data?: unknown;
            errors?: ReadonlyArray<{ type?: string; message?: string }>;
          };
          try {
            parsed = JSON.parse(response.text);
          } catch {
            return Effect.fail(
              failure(request.operation, "other", "GitHub returned invalid JSON."),
            );
          }
          const errors = parsed.errors ?? [];
          if (errors.length === 0) return Effect.succeed(parsed.data ?? null);
          // GraphQL failures arrive as HTTP 200, so the body decides.
          if (
            errors.some((error) => error.type === "RATE_LIMITED") ||
            response.headers.get("x-ratelimit-remaining") === "0" ||
            errors.some((error) => isGitHubRateLimitMessage(error.message ?? ""))
          ) {
            const { retryAtMs } = limits.pause(response.scope, response.headers);
            return Effect.fail(
              failure(
                request.operation,
                "rate-limited",
                `GitHub rate limit reached; requests resume at ${new Date(retryAtMs).toISOString()}.`,
                retryAtMs,
              ),
            );
          }
          const detail = errors.map((error) => error.message ?? "Unknown error").join("; ");
          return Effect.fail(
            failure(
              request.operation,
              errors.every((error) => error.type === "NOT_FOUND") ? "not-found" : "other",
              detail,
            ),
          );
        }),
      );

    return { rest, graphql } satisfies GitHubHttp;
  });
