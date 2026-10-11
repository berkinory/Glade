import type {
  GitPullRequestCheck,
  GitPullRequestCheckState,
  GitPullRequestMergeMethod,
  GitPullRequestReviewResult,
} from "@glade/contracts/git/pullRequestReview";
import { Schema } from "effect";

const COMMENT_BODY_MAX = 2_000;

// One document carries checks, reviews, unresolved threads and the repository's merge settings, so a
// review costs a single request. Review threads take one comment each: wider pages multiply cost.
export const PULL_REQUEST_REVIEW_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    squashMergeAllowed
    mergeCommitAllowed
    rebaseMergeAllowed
    pullRequest(number: $number) {
      id
      number
      state
      isDraft
      reviewDecision
      mergeStateStatus
      headRefOid
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun {
                    name
                    status
                    conclusion
                    detailsUrl
                    databaseId
                    startedAt
                    isRequired(pullRequestNumber: $number)
                    checkSuite { workflowRun { databaseId } }
                  }
                  ... on StatusContext {
                    context
                    state
                    targetUrl
                    createdAt
                    isRequired(pullRequestNumber: $number)
                  }
                }
              }
            }
          }
        }
      }
      latestReviews(first: 20) { nodes { author { login avatarUrl } state body } }
      reviewThreads(first: 50) {
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 1) { nodes { author { login avatarUrl } body url } }
        }
      }
    }
  }
}`;

const OptionalString = Schema.optional(Schema.NullOr(Schema.String));
const RawAuthor = Schema.optional(
  Schema.NullOr(Schema.Struct({ login: Schema.String, avatarUrl: OptionalString })),
);
const Nodes = <S extends Schema.Top>(item: S) => Schema.Struct({ nodes: Schema.Array(item) });

const RawContext = Schema.Struct({
  __typename: Schema.String,
  name: OptionalString,
  context: OptionalString,
  status: OptionalString,
  conclusion: OptionalString,
  state: OptionalString,
  detailsUrl: OptionalString,
  targetUrl: OptionalString,
  databaseId: Schema.optional(Schema.NullOr(Schema.Number)),
  startedAt: OptionalString,
  createdAt: OptionalString,
  isRequired: Schema.optional(Schema.NullOr(Schema.Boolean)),
  checkSuite: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        workflowRun: Schema.optional(Schema.NullOr(Schema.Struct({ databaseId: Schema.Number }))),
      }),
    ),
  ),
});
type RawContext = typeof RawContext.Type;

export const RawPullRequestReview = Schema.Struct({
  repository: Schema.Struct({
    squashMergeAllowed: Schema.Boolean,
    mergeCommitAllowed: Schema.Boolean,
    rebaseMergeAllowed: Schema.Boolean,
    pullRequest: Schema.Struct({
      id: Schema.String,
      number: Schema.Number,
      state: Schema.String,
      isDraft: Schema.Boolean,
      reviewDecision: OptionalString,
      mergeStateStatus: OptionalString,
      headRefOid: Schema.String,
      commits: Nodes(
        Schema.Struct({
          commit: Schema.Struct({
            statusCheckRollup: Schema.optional(
              Schema.NullOr(Schema.Struct({ contexts: Nodes(RawContext) })),
            ),
          }),
        }),
      ),
      latestReviews: Nodes(
        Schema.Struct({ author: RawAuthor, state: Schema.String, body: OptionalString }),
      ),
      reviewThreads: Nodes(
        Schema.Struct({
          isResolved: Schema.Boolean,
          isOutdated: Schema.Boolean,
          path: OptionalString,
          line: Schema.optional(Schema.NullOr(Schema.Number)),
          comments: Nodes(
            Schema.Struct({ author: RawAuthor, body: Schema.String, url: OptionalString }),
          ),
        }),
      ),
    }),
  }),
});
export type RawPullRequestReview = typeof RawPullRequestReview.Type;

// CheckRun entries carry status/conclusion; legacy commit StatusContext entries carry state.
function normalizeCheckState(check: RawContext): GitPullRequestCheckState {
  if (check.__typename === "StatusContext") {
    const state = check.state?.toUpperCase();
    if (state === "SUCCESS") return "success";
    return state === "FAILURE" || state === "ERROR" ? "failure" : "pending";
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

const positiveId = (value: number | null | undefined) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

/**
 * A workflow triggered by both `push` and `pull_request`, or a rerun, leaves several runs of one
 * check. A run still in progress outranks any finished one so a stale success never reads as passed.
 */
export function collapseCheckRuns(contexts: ReadonlyArray<RawContext>): GitPullRequestCheck[] {
  const byName = new Map<string, { check: GitPullRequestCheck; at: string }>();
  for (const context of contexts) {
    const name = context.name ?? context.context ?? "Check";
    const state = normalizeCheckState(context);
    const at = state === "pending" ? "9999-12-31" : (context.startedAt ?? context.createdAt ?? "");
    const check: GitPullRequestCheck = {
      name,
      state,
      url: context.detailsUrl ?? context.targetUrl ?? null,
      required: context.isRequired === true,
      jobId: context.__typename === "CheckRun" ? positiveId(context.databaseId) : null,
      runId: positiveId(context.checkSuite?.workflowRun?.databaseId),
    };
    const previous = byName.get(name);
    if (!previous || at > previous.at) byName.set(name, { check, at });
  }
  return [...byName.values()]
    .map((entry) => entry.check)
    .toSorted(
      (a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name),
    );
}

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

export function normalizePullRequestState(state: string): GitPullRequestReviewResult["state"] {
  const normalized = state.toLowerCase();
  return normalized === "merged" || normalized === "closed" ? normalized : "open";
}

function truncateBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > COMMENT_BODY_MAX ? `${trimmed.slice(0, COMMENT_BODY_MAX)}…` : trimmed;
}

export function normalizePullRequestReview(raw: RawPullRequestReview): GitPullRequestReviewResult {
  const { repository } = raw;
  const pullRequest = repository.pullRequest;
  const contexts = pullRequest.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  const changeRequests = pullRequest.latestReviews.nodes
    .filter((review) => review.state.toUpperCase() === "CHANGES_REQUESTED" && review.body?.trim())
    .map((review) => ({
      author: review.author?.login ?? "reviewer",
      authorAvatarUrl: review.author?.avatarUrl ?? null,
      body: truncateBody(review.body ?? ""),
      path: null,
      line: null,
      url: null,
    }));
  const openThreads = pullRequest.reviewThreads.nodes.flatMap((thread) => {
    const first = thread.comments.nodes[0];
    if (thread.isResolved || thread.isOutdated || !first) return [];
    return [
      {
        author: first.author?.login ?? "reviewer",
        authorAvatarUrl: first.author?.avatarUrl ?? null,
        body: truncateBody(first.body),
        path: thread.path ?? null,
        line: thread.line && thread.line > 0 ? thread.line : null,
        url: first.url ?? null,
      },
    ];
  });
  const mergeMethods: GitPullRequestMergeMethod[] = [
    ...(repository.squashMergeAllowed ? (["squash"] as const) : []),
    ...(repository.mergeCommitAllowed ? (["merge"] as const) : []),
    ...(repository.rebaseMergeAllowed ? (["rebase"] as const) : []),
  ];
  return {
    number: pullRequest.number,
    state: normalizePullRequestState(pullRequest.state),
    isDraft: pullRequest.isDraft,
    headSha: pullRequest.headRefOid,
    checks: collapseCheckRuns(contexts),
    reviewDecision: normalizeReviewDecision(pullRequest.reviewDecision),
    mergeState: normalizeMergeState(pullRequest.mergeStateStatus),
    comments: [...changeRequests, ...openThreads],
    mergeMethods,
  };
}
