import type {
  GitPullRequestCheckState,
  GitPullRequestMergeMethod,
  GitPullRequestReviewResult,
} from "@glade/contracts/git/pullRequestReview";
import { Schema } from "effect";

export const PULL_REQUEST_REVIEW_JSON_FIELDS =
  "number,state,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup,latestReviews";
export const REPOSITORY_MERGE_SETTINGS_JSON_FIELDS =
  "nameWithOwner,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed";
export const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes { isResolved isOutdated path line comments(first: 1) { nodes { author { login } body url } } }
      }
    }
  }
}`;
const COMMENT_BODY_MAX = 2_000;

const OptionalString = Schema.optional(Schema.NullOr(Schema.String));

const RawCheck = Schema.Struct({
  name: OptionalString,
  context: OptionalString,
  status: OptionalString,
  conclusion: OptionalString,
  state: OptionalString,
  detailsUrl: OptionalString,
  targetUrl: OptionalString,
});
type RawCheck = typeof RawCheck.Type;

const RawAuthor = Schema.optional(Schema.NullOr(Schema.Struct({ login: Schema.String })));

export const RawPullRequestReview = Schema.Struct({
  number: Schema.Number,
  state: Schema.String,
  isDraft: Schema.Boolean,
  reviewDecision: OptionalString,
  mergeStateStatus: OptionalString,
  statusCheckRollup: Schema.optional(Schema.NullOr(Schema.Array(RawCheck))),
  latestReviews: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({ author: RawAuthor, state: Schema.String, body: OptionalString }),
      ),
    ),
  ),
});

export const RawReviewThreads = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      pullRequest: Schema.Struct({
        reviewThreads: Schema.Struct({
          nodes: Schema.Array(
            Schema.Struct({
              isResolved: Schema.Boolean,
              isOutdated: Schema.Boolean,
              path: OptionalString,
              line: Schema.optional(Schema.NullOr(Schema.Number)),
              comments: Schema.Struct({
                nodes: Schema.Array(
                  Schema.Struct({ author: RawAuthor, body: Schema.String, url: OptionalString }),
                ),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
});

export const RawRepositoryMergeSettings = Schema.Struct({
  nameWithOwner: Schema.String,
  squashMergeAllowed: Schema.Boolean,
  mergeCommitAllowed: Schema.Boolean,
  rebaseMergeAllowed: Schema.Boolean,
});

// CheckRun entries carry status/conclusion; legacy commit StatusContext entries carry state.
function normalizeCheckState(check: RawCheck): GitPullRequestCheckState {
  const legacyState = check.state?.toUpperCase();
  if (legacyState) {
    if (legacyState === "SUCCESS") return "success";
    return legacyState === "FAILURE" || legacyState === "ERROR" ? "failure" : "pending";
  }
  if (check.status && check.status.toUpperCase() !== "COMPLETED") return "pending";
  switch (check.conclusion?.toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "NEUTRAL":
    case "STALE":
      return "neutral";
    case "SKIPPED":
      return "skipped";
    case "FAILURE":
    case "CANCELLED":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "failure";
    default:
      return "pending";
  }
}

const CHECK_ORDER: Record<GitPullRequestCheckState, number> = {
  failure: 0,
  pending: 1,
  success: 2,
  neutral: 3,
  skipped: 4,
};

function normalizeMergeState(
  mergeStateStatus: string | null | undefined,
): GitPullRequestReviewResult["mergeState"] {
  switch (mergeStateStatus?.toUpperCase()) {
    case "CLEAN":
    case "HAS_HOOKS":
      return "clean";
    case "BLOCKED":
    case "DRAFT":
      return "blocked";
    case "BEHIND":
      return "behind";
    case "DIRTY":
      return "conflicting";
    case "UNSTABLE":
      return "unstable";
    default:
      return "unknown";
  }
}

function normalizeReviewDecision(
  decision: string | null | undefined,
): GitPullRequestReviewResult["reviewDecision"] {
  switch (decision?.toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "review_required";
    default:
      return null;
  }
}

function normalizePullRequestState(state: string): GitPullRequestReviewResult["state"] {
  const normalized = state.toLowerCase();
  return normalized === "merged" || normalized === "closed" ? normalized : "open";
}

function truncateBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > COMMENT_BODY_MAX ? `${trimmed.slice(0, COMMENT_BODY_MAX)}…` : trimmed;
}

export function normalizePullRequestReview(
  raw: typeof RawPullRequestReview.Type,
  settings: typeof RawRepositoryMergeSettings.Type,
  threads: typeof RawReviewThreads.Type | null,
): GitPullRequestReviewResult {
  const changeRequests = (raw.latestReviews ?? [])
    .filter((review) => review.state.toUpperCase() === "CHANGES_REQUESTED" && review.body?.trim())
    .map((review) => ({
      author: review.author?.login ?? "reviewer",
      body: truncateBody(review.body ?? ""),
      path: null,
      line: null,
      url: null,
    }));
  const openThreads = (threads?.data.repository.pullRequest.reviewThreads.nodes ?? []).flatMap(
    (thread) => {
      const first = thread.comments.nodes[0];
      if (thread.isResolved || thread.isOutdated || !first) return [];
      return [
        {
          author: first.author?.login ?? "reviewer",
          body: truncateBody(first.body),
          path: thread.path ?? null,
          line: thread.line && thread.line > 0 ? thread.line : null,
          url: first.url ?? null,
        },
      ];
    },
  );
  const checks = (raw.statusCheckRollup ?? [])
    .map((check) => ({
      name: check.name ?? check.context ?? "Check",
      state: normalizeCheckState(check),
      url: check.detailsUrl ?? check.targetUrl ?? null,
    }))
    .toSorted(
      (a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name),
    );
  const mergeMethods: GitPullRequestMergeMethod[] = [
    ...(settings.squashMergeAllowed ? (["squash"] as const) : []),
    ...(settings.mergeCommitAllowed ? (["merge"] as const) : []),
    ...(settings.rebaseMergeAllowed ? (["rebase"] as const) : []),
  ];
  return {
    number: raw.number,
    state: normalizePullRequestState(raw.state),
    isDraft: raw.isDraft,
    checks,
    reviewDecision: normalizeReviewDecision(raw.reviewDecision),
    mergeState: normalizeMergeState(raw.mergeStateStatus),
    comments: [...changeRequests, ...openThreads],
    mergeMethods,
  };
}
