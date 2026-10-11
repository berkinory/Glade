import type {
  GitPullRequestCheckLogResult,
  GitPullRequestDetail,
  GitPullRequestDiffResult,
  GitPullRequestListState,
  GitPullRequestListItem,
} from "@glade/contracts/git/pullRequests";
import { Effect } from "effect";

import { GitHubError } from "../Errors.ts";
import { normalizePullRequestState } from "../pullRequestReview.ts";
import type { GitHubHttp, GitHubRestResponse } from "./gitHubHttp.ts";
import type { GitHubRepositoryRef } from "./gitHubRepositoryContext.ts";

const BODY_MAX = 20_000;
const LIST_SIZE = 50;
const DIFF_MAX_FILES = 1_000;
const DIFF_MAX_CHARS = 4_000_000;
const LOG_MAX_LINES = 150;
const LOG_MAX_CHARS = 12_000;

const STATE_QUALIFIERS: Record<GitPullRequestListState, string> = {
  open: "is:open",
  closed: "is:closed",
};

const LIST_QUERY = `query($q: String!, $first: Int!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: $first) {
    nodes {
      ... on PullRequest {
        number title url state isDraft updatedAt headRefName baseRefName reviewDecision
        author { login avatarUrl }
        comments { totalCount }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

const DETAIL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title url body state isDraft createdAt baseRefName headRefName
      additions deletions changedFiles
      author { login avatarUrl }
      commits { totalCount }
      latestReviews(first: 20) { nodes { author { login avatarUrl } state } }
      reviewRequests(first: 20) {
        nodes { requestedReviewer { ... on User { login avatarUrl } ... on Team { name } } }
      }
      comments(last: 50) { nodes { author { login avatarUrl } body createdAt url } }
      reviews(last: 30) { nodes { author { login avatarUrl } body state createdAt url } }
    }
  }
}`;

interface ListNode {
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  isDraft?: boolean;
  updatedAt?: string;
  headRefName?: string;
  baseRefName?: string;
  reviewDecision?: string | null;
  author?: { login?: string; avatarUrl?: string } | null;
  comments?: { totalCount?: number };
  commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { state?: string } | null } }> };
}

const shapeError = (operation: string, detail: string) =>
  new GitHubError({ operation, reason: "other", detail: `GitHub returned ${detail}.` });

function rollupState(node: ListNode): GitPullRequestListItem["checks"] {
  switch (node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "none";
  }
}

function reviewDecision(
  value: string | null | undefined,
): GitPullRequestListItem["reviewDecision"] {
  if (value === "APPROVED") return "approved";
  if (value === "CHANGES_REQUESTED") return "changes_requested";
  if (value === "REVIEW_REQUIRED") return "review_required";
  return null;
}

export function listPullRequests(
  http: GitHubHttp,
  repository: GitHubRepositoryRef,
  state: GitPullRequestListState,
) {
  const q = `repo:${repository.nameWithOwner} is:pr ${STATE_QUALIFIERS[state]} sort:updated-desc`;
  return http
    .graphql({
      operation: "listRepositoryPullRequests",
      query: LIST_QUERY,
      variables: { q, first: LIST_SIZE },
      priority: "foreground",
    })
    .pipe(
      Effect.map((data) => {
        const result = data as {
          viewer?: { login?: string };
          search?: { nodes?: ListNode[] };
        } | null;
        const nodes = result?.search?.nodes ?? [];
        const items = nodes.flatMap((node): GitPullRequestListItem[] =>
          typeof node.number === "number" && node.title && node.url
            ? [
                {
                  number: node.number,
                  title: node.title,
                  url: node.url,
                  author: node.author?.login ?? "ghost",
                  authorAvatarUrl: node.author?.avatarUrl ?? null,
                  state: normalizePullRequestState(node.state ?? "OPEN"),
                  isDraft: node.isDraft === true,
                  updatedAt: node.updatedAt ?? "",
                  headBranch: node.headRefName ?? "",
                  baseBranch: node.baseRefName ?? "",
                  checks: rollupState(node),
                  reviewDecision: reviewDecision(node.reviewDecision),
                  comments: node.comments?.totalCount ?? 0,
                },
              ]
            : [],
        );
        return {
          repository: repository.nameWithOwner,
          viewerLogin: result?.viewer?.login ?? null,
          items,
        };
      }),
    );
}

interface DetailNode {
  number: number;
  title: string;
  url: string;
  body?: string | null;
  state: string;
  isDraft: boolean;
  createdAt: string;
  baseRefName: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  author?: { login?: string; avatarUrl?: string } | null;
  commits: { totalCount: number };
  latestReviews: {
    nodes: Array<{ author?: { login?: string; avatarUrl?: string } | null; state: string }>;
  };
  reviewRequests: {
    nodes: Array<{
      requestedReviewer?: { login?: string; avatarUrl?: string; name?: string } | null;
    }>;
  };
  comments: {
    nodes: Array<{
      author?: { login?: string; avatarUrl?: string } | null;
      body: string;
      createdAt: string;
      url?: string;
    }>;
  };
  reviews: {
    nodes: Array<{
      author?: { login?: string; avatarUrl?: string } | null;
      body?: string | null;
      state: string;
      createdAt: string;
      url?: string;
    }>;
  };
}

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n\n…` : text;

function reviewerState(state: string): GitPullRequestDetail["reviewers"][number]["state"] {
  switch (state) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "COMMENTED":
      return "commented";
    default:
      return "pending";
  }
}

export function readPullRequestDetail(
  http: GitHubHttp,
  repository: GitHubRepositoryRef,
  number: number,
) {
  return http
    .graphql({
      operation: "getPullRequestDetail",
      query: DETAIL_QUERY,
      variables: { owner: repository.owner, name: repository.name, number },
      priority: "foreground",
    })
    .pipe(
      Effect.flatMap((data) => {
        const pr = (data as { repository?: { pullRequest?: DetailNode | null } } | null)?.repository
          ?.pullRequest;
        if (!pr) return Effect.fail(shapeError("getPullRequestDetail", "no pull request"));
        const reviewed = pr.latestReviews.nodes.map((review) => ({
          login: review.author?.login ?? "ghost",
          avatarUrl: review.author?.avatarUrl ?? null,
          state: reviewerState(review.state),
        }));
        const requested = pr.reviewRequests.nodes.flatMap((request) => {
          const login = request.requestedReviewer?.login ?? request.requestedReviewer?.name;
          return login && !reviewed.some((entry) => entry.login === login)
            ? [
                {
                  login,
                  avatarUrl: request.requestedReviewer?.avatarUrl ?? null,
                  state: "pending" as const,
                },
              ]
            : [];
        });
        const conversation = [
          ...pr.comments.nodes.map((comment) => ({
            kind: "comment" as const,
            author: comment.author?.login ?? "ghost",
            authorAvatarUrl: comment.author?.avatarUrl ?? null,
            body: truncate(comment.body, BODY_MAX),
            createdAt: comment.createdAt,
            url: comment.url ?? null,
            reviewState: null,
          })),
          ...pr.reviews.nodes
            .filter(
              (review) => (review.body ?? "").trim().length > 0 || review.state !== "COMMENTED",
            )
            .map((review) => ({
              kind: "review" as const,
              author: review.author?.login ?? "ghost",
              authorAvatarUrl: review.author?.avatarUrl ?? null,
              body: truncate(review.body ?? "", BODY_MAX),
              createdAt: review.createdAt,
              url: review.url ?? null,
              reviewState: review.state,
            })),
        ].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
        return Effect.succeed({
          number: pr.number,
          title: pr.title,
          url: pr.url,
          body: truncate(pr.body ?? "", BODY_MAX),
          author: pr.author?.login ?? "ghost",
          authorAvatarUrl: pr.author?.avatarUrl ?? null,
          state: normalizePullRequestState(pr.state),
          isDraft: pr.isDraft,
          createdAt: pr.createdAt,
          baseBranch: pr.baseRefName,
          headBranch: pr.headRefName,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changedFiles,
          commits: pr.commits.totalCount,
          reviewers: [...reviewed, ...requested],
          conversation,
        } satisfies GitPullRequestDetail);
      }),
    );
}

interface FileEntry {
  filename: string;
  previous_filename?: string;
  status: string;
  patch?: string;
}

function filePatch(file: FileEntry): string {
  const from = file.previous_filename ?? file.filename;
  const header = `diff --git a/${from} b/${file.filename}\n`;
  const fromPath = file.status === "added" ? "/dev/null" : `a/${from}`;
  const toPath = file.status === "removed" ? "/dev/null" : `b/${file.filename}`;
  if (!file.patch) return `${header}Binary files ${fromPath} and ${toPath} differ\n`;
  return `${header}--- ${fromPath}\n+++ ${toPath}\n${file.patch}\n`;
}

/** Builds a unified patch from the files API, which pages past the 300-file limit of diff media. */
export function readPullRequestDiff(
  http: GitHubHttp,
  repository: GitHubRepositoryRef,
  number: number,
) {
  return Effect.gen(function* () {
    let next: string | null =
      `/repos/${repository.nameWithOwner}/pulls/${number}/files?per_page=100`;
    let patch = "";
    let files = 0;
    let truncated = false;
    while (next) {
      const page: GitHubRestResponse = yield* http.rest({
        operation: "getPullRequestDiff",
        path: next,
        priority: "foreground",
      });
      const entries = Array.isArray(page.body) ? (page.body as FileEntry[]) : [];
      for (const entry of entries) {
        patch += filePatch(entry);
        files += 1;
      }
      if (files >= DIFF_MAX_FILES || patch.length >= DIFF_MAX_CHARS) {
        truncated = page.nextPage !== null || patch.length >= DIFF_MAX_CHARS;
        break;
      }
      next = page.nextPage;
    }
    return {
      patch: patch.slice(0, DIFF_MAX_CHARS),
      truncated,
    } satisfies GitPullRequestDiffResult;
  });
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;

/** Keeps the tail of a job log around its last error, the part an agent needs to fix the failure. */
function excerptJobLog(log: string): GitPullRequestCheckLogResult {
  const lines = log
    .split(/\r?\n/)
    .map((line) => line.replace(ANSI, "").replace(TIMESTAMP, ""))
    .filter((line) => !line.startsWith("##[group]") && !line.startsWith("##[endgroup]"));
  let lastError = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.includes("##[error]")) {
      lastError = index;
      break;
    }
  }
  const end = lastError >= 0 ? lastError + 1 : lines.length;
  const start = Math.max(0, end - LOG_MAX_LINES);
  let excerpt = lines.slice(start, end).join("\n").trim();
  const truncated = start > 0 || excerpt.length > LOG_MAX_CHARS;
  if (excerpt.length > LOG_MAX_CHARS) excerpt = excerpt.slice(excerpt.length - LOG_MAX_CHARS);
  return { excerpt, truncated };
}

export function readJobLog(http: GitHubHttp, repository: GitHubRepositoryRef, jobId: number) {
  return http
    .rest({
      operation: "getCheckLog",
      path: `/repos/${repository.nameWithOwner}/actions/jobs/${jobId}/logs`,
      priority: "foreground",
      responseType: "text",
    })
    .pipe(
      Effect.map((response) =>
        excerptJobLog(typeof response.body === "string" ? response.body : ""),
      ),
    );
}

export function rerunFailedJobs(http: GitHubHttp, repository: GitHubRepositoryRef, runId: number) {
  return http
    .rest({
      operation: "rerunFailedJobs",
      method: "POST",
      path: `/repos/${repository.nameWithOwner}/actions/runs/${runId}/rerun-failed-jobs`,
      priority: "foreground",
    })
    .pipe(Effect.asVoid);
}
