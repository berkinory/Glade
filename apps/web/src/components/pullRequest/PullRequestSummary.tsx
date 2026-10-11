import type { GitPullRequestDetail } from "@glade/contracts/git/pullRequests";
import type { GitPullRequestReviewResult } from "@glade/contracts/git/pullRequestReview";
import { useState, type ReactNode } from "react";
import { GitMergeIcon, GitPullRequestIcon, ListChecksIcon, UsersIcon } from "~/lib/icons";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import { AuthorAvatar } from "../AuthorAvatar";
import ChatMarkdown from "../ChatMarkdown";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Button } from "../ui/button";
import { DiffStat } from "../ui/diff-stat";
import { CheckStateIcon, PullRequestCheckList } from "./PullRequestCheckList";
import { resolveMergeBlocker, summarizePullRequestChecks } from "./pullRequestNextStep";
import {
  PR_STATE_PRESENTATION_ICONS,
  resolvePrStatePresentation,
} from "./pullRequestStatePresentation";

type ReviewComment = GitPullRequestReviewResult["comments"][number];

const STATE_WORDS = { open: "Open", closed: "Closed", merged: "Merged" } as const;

const REVIEW_ACTIONS: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "reviewed",
  DISMISSED: "had a review dismissed",
};

function ago(iso: string): string {
  const relative = formatRelativeTime(iso);
  return relative === "now" ? "now" : `${relative} ago`;
}

function Markdown({ text, cwd }: { text: string; cwd: string }) {
  return (
    <div className="editor-markdown-preview editor-markdown-preview--inline">
      <ChatMarkdown
        text={text}
        cwd={cwd}
        isStreaming={false}
        className="editor-markdown-preview__body text-ui leading-relaxed"
      />
    </div>
  );
}

function MetaRow(props: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-6 items-start gap-3 text-ui">
      <span className="flex h-6 w-24 shrink-0 items-center gap-1.5 text-muted-foreground">
        {props.icon}
        {props.label}
      </span>
      <span className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        {props.children}
      </span>
    </div>
  );
}

function Section(props: { title: string; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-t border-border/60">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-ui font-medium"
        onClick={() => setOpen(!open)}
      >
        {props.title}
        {props.count !== undefined ? (
          <span className="font-normal tabular-nums text-muted-foreground">{props.count}</span>
        ) : null}
        <DisclosureChevron open={open} className="ml-auto size-3.5 text-muted-foreground" />
      </button>
      <DisclosureRegion open={open}>
        <div className="px-4 pb-3">{props.children}</div>
      </DisclosureRegion>
    </section>
  );
}

function CommentHeader(props: { author: string; avatarUrl?: string | null; children?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-ui-sm text-muted-foreground">
      <AuthorAvatar actor={{ login: props.author, avatarUrl: props.avatarUrl ?? null }} />
      <span className="shrink-0 font-medium text-foreground">{props.author}</span>
      {props.children}
    </span>
  );
}

export function PullRequestSummary(props: {
  cwd: string;
  pr: GitPullRequestDetail;
  review: GitPullRequestReviewResult | null;
  canDraft: boolean;
  onFixComment: (comment: ReviewComment) => void;
  onOpenFile: (path: string) => void;
}) {
  const { pr, review, cwd } = props;
  const presentation = resolvePrStatePresentation({
    state: pr.state,
    isDraft: pr.isDraft,
    mergeability: review?.mergeState === "conflicting" ? "conflicting" : undefined,
  });
  const StateIcon = PR_STATE_PRESENTATION_ICONS[presentation.iconKind] ?? GitPullRequestIcon;
  const checks = review ? summarizePullRequestChecks(review.checks) : null;
  const blocker = review && pr.state === "open" && !pr.isDraft ? resolveMergeBlocker(review) : null;
  const comments = review?.comments ?? [];
  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-2 px-4 pt-4 pb-3">
        <h1 className="text-ui-lg font-semibold leading-snug break-words">{pr.title}</h1>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-ui-sm text-muted-foreground">
          <span className={cn("inline-flex items-center gap-1", presentation.colorClass)}>
            <StateIcon className="size-3.5" aria-hidden />
            {pr.isDraft && pr.state === "open" ? "Draft" : STATE_WORDS[pr.state]}
          </span>
          <span aria-hidden>·</span>
          <AuthorAvatar actor={{ login: pr.author, avatarUrl: pr.authorAvatarUrl }} />
          <span className="font-medium text-foreground">{pr.author}</span>
          <span title={pr.createdAt}>{ago(pr.createdAt)}</span>
          <span className="ml-auto tabular-nums">#{pr.number}</span>
        </span>
      </header>
      <div className="flex flex-col gap-0.5 px-4 pb-3">
        <MetaRow icon={<GitPullRequestIcon className="size-3.5" />} label="Branch">
          <span className="min-w-0 truncate font-mono text-ui-sm">
            {pr.headBranch} › {pr.baseBranch}
          </span>
          <DiffStat insertions={pr.additions} deletions={pr.deletions} colored />
        </MetaRow>
        <MetaRow icon={<UsersIcon className="size-3.5" />} label="Reviewers">
          {pr.reviewers.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            pr.reviewers.map((reviewer) => (
              <span
                key={reviewer.login}
                className="inline-flex items-center gap-1"
                title={reviewer.state.replace("_", " ")}
              >
                <AuthorAvatar actor={reviewer} />
                {reviewer.login}
              </span>
            ))
          )}
        </MetaRow>
        {checks ? (
          <MetaRow icon={<ListChecksIcon className="size-3.5" />} label="Checks">
            <CheckStateIcon state={checks.tone === "neutral" ? "neutral" : checks.tone} />
            {checks.label}
          </MetaRow>
        ) : null}
        {blocker ? (
          <MetaRow icon={<GitMergeIcon className="size-3.5" />} label="Merge">
            <span
              className={
                review?.mergeState === "conflicting" ? "text-status-failure" : "text-foreground"
              }
            >
              {blocker}
            </span>
          </MetaRow>
        ) : null}
      </div>
      <Section title="Description">
        {pr.body.trim() ? (
          <Markdown text={pr.body} cwd={cwd} />
        ) : (
          <p className="text-ui text-muted-foreground">No description provided.</p>
        )}
      </Section>
      {review && review.checks.length > 0 ? (
        <Section title="Checks" count={review.checks.length}>
          <div className="-mx-1.5">
            <PullRequestCheckList checks={review.checks} cwd={cwd} />
          </div>
        </Section>
      ) : null}
      {comments.length + pr.conversation.length > 0 ? (
        <Section title="Comments" count={comments.length + pr.conversation.length}>
          <div className="flex flex-col">
            {comments.map((comment, index) => (
              <article
                key={`${comment.url ?? comment.author}-${index}`}
                className="flex flex-col gap-1.5 border-t border-border/50 py-2.5 first:border-t-0 first:pt-0"
              >
                <CommentHeader author={comment.author} avatarUrl={comment.authorAvatarUrl}>
                  {comment.path ? (
                    <button
                      type="button"
                      className="min-w-0 truncate font-mono hover:text-foreground"
                      onClick={() => comment.path && props.onOpenFile(comment.path)}
                    >
                      {comment.path}
                      {comment.line ? `:${comment.line}` : ""}
                    </button>
                  ) : null}
                  {props.canDraft ? (
                    <Button
                      size="chip"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => props.onFixComment(comment)}
                    >
                      Fix
                    </Button>
                  ) : null}
                </CommentHeader>
                {comment.body.trim() ? <Markdown text={comment.body} cwd={cwd} /> : null}
              </article>
            ))}
            {pr.conversation.map((entry, index) => (
              <article
                key={`${entry.url ?? entry.createdAt}-${index}`}
                className="flex flex-col gap-1.5 border-t border-border/50 py-2.5 first:border-t-0 first:pt-0"
              >
                <CommentHeader author={entry.author} avatarUrl={entry.authorAvatarUrl}>
                  <span>
                    {entry.kind === "review" && entry.reviewState
                      ? (REVIEW_ACTIONS[entry.reviewState] ?? "reviewed")
                      : "commented"}
                  </span>
                  <span className="ml-auto shrink-0" title={entry.createdAt}>
                    {ago(entry.createdAt)}
                  </span>
                </CommentHeader>
                {entry.body.trim() ? <Markdown text={entry.body} cwd={cwd} /> : null}
              </article>
            ))}
          </div>
        </Section>
      ) : null}
      <span aria-hidden className="h-6 shrink-0" />
    </div>
  );
}
