import type { GitPullRequestReviewResult } from "@glade/contracts/git/pullRequestReview";
import { Effect, Schema } from "effect";

import { GitHubError } from "../Errors.ts";
import {
  normalizePullRequestReview,
  PULL_REQUEST_REVIEW_QUERY,
  RawPullRequestReview,
} from "../pullRequestReview.ts";
import type { GitHubHttp } from "./gitHubHttp.ts";
import type { GitHubPriority } from "./gitHubRateLimits.ts";
import type { GitHubRepositoryRef } from "./gitHubRepositoryContext.ts";

// Edits inside review threads do not move any validator, so a full read happens at least this often.
const FULL_READ_INTERVAL_MS = 5 * 60_000;
const MAX_ENTRIES = 128;

interface Validators {
  readonly pull: string | null;
  readonly checkRuns: string | null;
  readonly statuses: string | null;
}

interface Entry {
  readonly review: GitPullRequestReviewResult;
  readonly nodeId: string;
  readonly fetchedAt: number;
  readonly validators: Validators;
}

const decodeReview = Schema.decodeUnknownEffect(RawPullRequestReview);

export interface PullRequestReviewReader {
  readonly read: (input: {
    readonly repository: GitHubRepositoryRef;
    readonly number: number;
    readonly priority: GitHubPriority;
  }) => Effect.Effect<{ review: GitPullRequestReviewResult; nodeId: string }, GitHubError>;
  readonly invalidate: (repository: GitHubRepositoryRef, number: number) => void;
}

/**
 * Revalidates with conditional REST requests first: 304s do not count against the rate limit, so an
 * idle pull request costs nothing to poll and the GraphQL read only runs when something moved.
 */
export function makePullRequestReviewReader(http: GitHubHttp): PullRequestReviewReader {
  const entries = new Map<string, Entry>();
  const keyOf = (repository: GitHubRepositoryRef, number: number) =>
    `${repository.nameWithOwner}#${number}`;

  const conditional = (
    operation: string,
    path: string,
    etag: string | null,
    priority: GitHubPriority,
  ) => http.rest({ operation, path, etag, priority }).pipe(Effect.map((r) => r));

  const captureValidators = (
    repository: GitHubRepositoryRef,
    number: number,
    headSha: string,
    priority: GitHubPriority,
    previous: Validators | null,
  ) => {
    const base = `/repos/${repository.nameWithOwner}`;
    return Effect.all(
      [
        conditional(
          "pullRequestValidator",
          `${base}/pulls/${number}`,
          previous?.pull ?? null,
          priority,
        ),
        conditional(
          "checkRunsValidator",
          `${base}/commits/${headSha}/check-runs?per_page=100`,
          previous?.checkRuns ?? null,
          priority,
        ),
        conditional(
          "statusesValidator",
          `${base}/commits/${headSha}/status`,
          previous?.statuses ?? null,
          priority,
        ),
      ],
      { concurrency: 3 },
    );
  };

  const fullRead = (repository: GitHubRepositoryRef, number: number, priority: GitHubPriority) =>
    http
      .graphql({
        operation: "getPullRequestReview",
        query: PULL_REQUEST_REVIEW_QUERY,
        variables: { owner: repository.owner, name: repository.name, number },
        priority,
      })
      .pipe(
        Effect.flatMap((data) =>
          decodeReview(data).pipe(
            Effect.mapError(
              (error) =>
                new GitHubError({
                  operation: "getPullRequestReview",
                  reason: "other",
                  detail: `GitHub returned an unexpected review shape: ${error.message}`,
                }),
            ),
          ),
        ),
        Effect.map((raw) => ({
          review: normalizePullRequestReview(raw),
          nodeId: raw.repository.pullRequest.id,
        })),
      );

  const read: PullRequestReviewReader["read"] = ({ repository, number, priority }) =>
    Effect.gen(function* () {
      const key = keyOf(repository, number);
      const entry = entries.get(key);
      if (entry && Date.now() - entry.fetchedAt < FULL_READ_INTERVAL_MS) {
        const [pull, checkRuns, statuses] = yield* captureValidators(
          repository,
          number,
          entry.review.headSha,
          priority,
          entry.validators,
        );
        if (pull.status === 304 && checkRuns.status === 304 && statuses.status === 304) {
          return { review: entry.review, nodeId: entry.nodeId };
        }
      }
      const result = yield* fullRead(repository, number, priority);
      // Validators are captured after the read so a change landing in between triggers another read.
      const [pull, checkRuns, statuses] = yield* captureValidators(
        repository,
        number,
        result.review.headSha,
        priority,
        null,
      ).pipe(Effect.orElseSucceed(() => [{ etag: null }, { etag: null }, { etag: null }] as const));
      if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value ?? "");
      entries.set(key, {
        ...result,
        fetchedAt: Date.now(),
        validators: { pull: pull.etag, checkRuns: checkRuns.etag, statuses: statuses.etag },
      });
      return result;
    });

  return {
    read,
    invalidate: (repository, number) => {
      entries.delete(keyOf(repository, number));
    },
  };
}
