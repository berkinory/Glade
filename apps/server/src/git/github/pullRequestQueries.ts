import { PositiveInt, TrimmedNonEmptyString } from "@glade/contracts/core/baseSchemas";
import { Schema } from "effect";

import type { GitHubPullRequestSummary } from "../Services/GitHub.ts";
import type { AliasedQuery } from "./gitHubGraphQlBatcher.ts";
import type { GitHubRepositoryRef } from "./gitHubRepositoryContext.ts";

const PULL_REQUEST_SUMMARY_FIELDS = `number title url baseRefName headRefName state mergedAt
  isDraft mergeable additions deletions changedFiles isCrossRepository updatedAt
  headRepository { nameWithOwner } headRepositoryOwner { login }`;

const RawPullRequestSummary = Schema.Struct({
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
  headRepository: Schema.optional(Schema.NullOr(Schema.Struct({ nameWithOwner: Schema.String }))),
  headRepositoryOwner: Schema.optional(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeRawPullRequestSummary = Schema.decodeUnknownSync(RawPullRequestSummary);

const diffCount = (value: number | null | undefined) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

function normalizePullRequestSummary(
  raw: typeof RawPullRequestSummary.Type,
): GitHubPullRequestSummary {
  const headRepositoryNameWithOwner = raw.headRepository?.nameWithOwner ?? null;
  const headRepositoryOwnerLogin =
    raw.headRepositoryOwner?.login ?? headRepositoryNameWithOwner?.split("/")[0] ?? null;
  const merged = (raw.mergedAt?.trim().length ?? 0) > 0 || raw.state === "MERGED";
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    state: merged ? "merged" : raw.state === "CLOSED" ? "closed" : "open",
    isDraft: raw.isDraft === true,
    mergeability:
      raw.mergeable === "MERGEABLE"
        ? "mergeable"
        : raw.mergeable === "CONFLICTING"
          ? "conflicting"
          : "unknown",
    additions: diffCount(raw.additions),
    deletions: diffCount(raw.deletions),
    changedFiles: diffCount(raw.changedFiles),
    updatedAt: raw.updatedAt?.trim() || null,
    ...(typeof raw.isCrossRepository === "boolean"
      ? { isCrossRepository: raw.isCrossRepository }
      : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}

/** One malformed pull request must not hide the healthy ones next to it. */
export function decodePullRequestSummaries(
  entries: ReadonlyArray<unknown>,
): GitHubPullRequestSummary[] {
  return entries.flatMap((entry) => {
    try {
      return [normalizePullRequestSummary(decodeRawPullRequestSummary(entry))];
    } catch {
      return [];
    }
  });
}

function decodePullRequestSummary(entry: unknown): GitHubPullRequestSummary {
  return normalizePullRequestSummary(decodeRawPullRequestSummary(entry));
}

const STATES = {
  open: ["OPEN"],
  all: ["OPEN", "CLOSED", "MERGED"],
} as const;

export interface HeadLookupKey {
  readonly repository: GitHubRepositoryRef;
  readonly headBranch: string;
  readonly headOwner: string | null;
  readonly states: keyof typeof STATES;
  readonly limit: number;
}

// Branch lookups drive status polling; one document costs a point whether it holds one lookup or
// fifty, so concurrent status refreshes share documents.
export const pullRequestsByHeadQuery: AliasedQuery<HeadLookupKey, GitHubPullRequestSummary[]> = {
  operation: "listPullRequestsByHead",
  windowMs: 50,
  maxPerDocument: 25,
  keyId: (key) =>
    [key.repository.nameWithOwner, key.headOwner ?? "", key.headBranch, key.states, key.limit].join(
      "\u0000",
    ),
  variables: (key) => ({
    owner: { type: "String!", value: key.repository.owner },
    name: { type: "String!", value: key.repository.name },
    head: { type: "String!", value: key.headBranch },
    states: { type: "[PullRequestState!]", value: STATES[key.states] },
    first: { type: "Int!", value: key.limit },
  }),
  selection: (
    alias,
    variable,
  ) => `${alias}: repository(owner: ${variable("owner")}, name: ${variable("name")}) {
    pullRequests(headRefName: ${variable("head")}, states: ${variable("states")}, first: ${variable("first")}, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ${PULL_REQUEST_SUMMARY_FIELDS} }
    }
  }`,
  parse: (data, key) => {
    const nodes = (data as { pullRequests?: { nodes?: unknown[] } } | null)?.pullRequests?.nodes;
    if (!Array.isArray(nodes)) throw new Error("missing pullRequests");
    const summaries = decodePullRequestSummaries(nodes);
    return key.headOwner
      ? summaries.filter(
          (pr) => pr.headRepositoryOwnerLogin?.toLowerCase() === key.headOwner?.toLowerCase(),
        )
      : summaries;
  },
};

export interface PullRequestNumberKey {
  readonly repository: GitHubRepositoryRef;
  readonly number: number;
}

export const pullRequestByNumberQuery: AliasedQuery<
  PullRequestNumberKey,
  GitHubPullRequestSummary
> = {
  operation: "getPullRequest",
  windowMs: 10,
  maxPerDocument: 25,
  keyId: (key) => `${key.repository.nameWithOwner}#${key.number}`,
  variables: (key) => ({
    owner: { type: "String!", value: key.repository.owner },
    name: { type: "String!", value: key.repository.name },
    number: { type: "Int!", value: key.number },
  }),
  selection: (
    alias,
    variable,
  ) => `${alias}: repository(owner: ${variable("owner")}, name: ${variable("name")}) {
      pullRequest(number: ${variable("number")}) { ${PULL_REQUEST_SUMMARY_FIELDS} }
    }`,
  parse: (data) => {
    const pullRequest = (data as { pullRequest?: unknown } | null)?.pullRequest;
    if (!pullRequest) throw new Error("pull request not found");
    return decodePullRequestSummary(pullRequest);
  },
};

export const LIST_PULL_REQUESTS_QUERY = `query($owner: String!, $name: String!, $states: [PullRequestState!], $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: $states, first: $first, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ${PULL_REQUEST_SUMMARY_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export const MARK_READY_MUTATION = `mutation($id: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } }
}`;

export function parsePullRequestUrl(
  reference: string,
): { nameWithOwner: string; number: number } | null {
  const match = /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/i.exec(reference.trim());
  return match?.[1] && match[2] ? { nameWithOwner: match[1], number: Number(match[2]) } : null;
}

export function parseHeadSelector(selector: string): { owner: string | null; branch: string } {
  const separator = selector.indexOf(":");
  return separator > 0 && separator < selector.length - 1
    ? { owner: selector.slice(0, separator), branch: selector.slice(separator + 1) }
    : { owner: null, branch: selector };
}
