import type {
  PullRequestDetail,
  PullRequestDetailInput,
  PullRequestState,
} from "@glade/contracts/git/pullRequests";

import type { RightDockPane } from "~/rightDockStore.logic";

import { pullRequestMarkdownPreview } from "./pullRequestMarkdown.logic";

export function pullRequestDetailInputKey(input: PullRequestDetailInput): string {
  return `${input.projectId}:${input.repository}#${input.number}`;
}

export function pullRequestPaneTabLabel(number: number): string {
  return `PR #${number}`;
}

export function pullRequestDetailInputFromPane(pane: RightDockPane): PullRequestDetailInput | null {
  if (
    pane.kind !== "pullRequest" ||
    !pane.pullRequestProjectId ||
    !pane.pullRequestRepository ||
    !pane.pullRequestNumber
  ) {
    return null;
  }
  return {
    projectId: pane.pullRequestProjectId,
    repository: pane.pullRequestRepository,
    number: pane.pullRequestNumber,
  };
}

export function describePullRequestState(state: PullRequestState, isDraft: boolean): string {
  if (isDraft && state === "open") return "Draft";
  if (state === "open") return "Ready for review";
  if (state === "merged") return "Merged";
  return "Closed";
}

export interface PullRequestTimelineEvent {
  id: string;

  at: string;
  title: string;
  body: string | null;
}

type PullRequestTimelineSource = Pick<
  PullRequestDetail,
  "createdAt" | "author" | "commits" | "comments" | "mergedAt" | "closedAt"
>;

export function buildPullRequestTimelineEvents(
  detail: PullRequestTimelineSource,
): PullRequestTimelineEvent[] {
  const events: PullRequestTimelineEvent[] = [
    {
      id: "created",
      at: detail.createdAt,
      title: `${detail.author?.login ?? "Someone"} opened this pull request`,
      body: null,
    },
    ...detail.commits.map((commit) => ({
      id: commit.oid,
      at: commit.committedDate,
      title: (() => {
        const author = commit.authors.find(
          (candidate) => candidate.name?.trim() || candidate.login,
        );
        const authorLabel = author?.name?.trim() || author?.login;
        return authorLabel
          ? `Commit ${commit.oid.slice(0, 7)} by ${authorLabel}`
          : `Commit ${commit.oid.slice(0, 7)}`;
      })(),
      body: commit.messageHeadline || "No commit message.",
    })),
    ...detail.comments.map((comment) => ({
      id: comment.id,
      at: comment.createdAt,
      title: `${comment.author?.login ?? "Someone"} ${comment.kind === "review" ? "reviewed" : "commented"}`,

      body: pullRequestMarkdownPreview(comment.body) || null,
    })),
    ...(detail.mergedAt
      ? [{ id: "merged", at: detail.mergedAt, title: "Pull request merged", body: null }]
      : []),
    ...(detail.closedAt && !detail.mergedAt
      ? [{ id: "closed", at: detail.closedAt, title: "Pull request closed", body: null }]
      : []),
  ];
  return events.toSorted((left, right) => left.at.localeCompare(right.at));
}
