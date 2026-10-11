import { ArrowUpRightIcon, GitPullRequestIcon, ViewIcon } from "~/lib/icons";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { GitStatusResult } from "@glade/contracts/git/git";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { useMainWorkspaceStore } from "~/mainWorkspaceStore";
import { ensureNativeApi } from "~/nativeApi";
import {
  gitPullRequestReviewQueryOptions,
  gitPullRequestWatchStatusQueryOptions,
  gitStatusQueryOptions,
} from "../../../lib/gitQueryOptions";
import {
  CHECK_TONE_CLASS,
  CheckStateIcon,
  PullRequestCheckList,
} from "../../pullRequest/PullRequestCheckList";
import { AuthorAvatar } from "../../AuthorAvatar";
import { DiffStat } from "../../ui/diff-stat";
import { ELEVATED_HOVER_SURFACE_CLASS_NAME } from "~/surfaceStyles";
import {
  PR_STATE_PRESENTATION_ICONS,
  resolvePrStatePresentation,
} from "../../pullRequest/pullRequestStatePresentation";
import { buildReviewCommentsPrompt } from "../../pullRequest/pullRequestPrompts";
import {
  MergePullRequestDialog,
  usePullRequestActions,
} from "../../pullRequest/usePullRequestActions";
import { Button } from "../../ui/button";
import { IconButton } from "../../ui/icon-button";
import { Popover, PopoverPopup, PopoverTrigger } from "../../ui/popover";
import { Spinner } from "../../ui/spinner";
import { toastManager } from "../../ui/toast";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentLabeledSection,
  EnvironmentRowBody,
} from "./EnvironmentRow";

const SECONDARY_TEXT_CLASS_NAME = "text-[var(--color-text-foreground-secondary)]";
const INLINE_TRIGGER_CLASS_NAME = cn(
  "inline-flex items-center gap-1 rounded-md px-1",
  ELEVATED_HOVER_SURFACE_CLASS_NAME,
);
import {
  resolvePullRequestNextStep,
  summarizePullRequestChecks,
} from "../../pullRequest/pullRequestNextStep";

export function EnvironmentPullRequestSection({
  gitCwd,
  enabled,
  activeThreadId,
  showDiffColors,
  onOpenUrl,
  onClose,
}: {
  gitCwd: string | null;
  enabled: boolean;
  activeThreadId: ThreadId | null;
  showDiffColors: boolean;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}) {
  const { data: status } = useQuery(gitStatusQueryOptions(gitCwd, enabled));
  const pr = status?.pr ?? null;
  if (!pr || !gitCwd) return null;
  return (
    <PullRequestRow
      cwd={gitCwd}
      pr={pr}
      enabled={enabled}
      threadId={activeThreadId}
      showDiffColors={showDiffColors}
      onOpenUrl={onOpenUrl}
      onClose={onClose}
    />
  );
}

function PullRequestRow(props: {
  cwd: string;
  pr: NonNullable<GitStatusResult["pr"]>;
  enabled: boolean;
  threadId: ThreadId | null;
  showDiffColors: boolean;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}) {
  const { pr, cwd } = props;
  const queryClient = useQueryClient();
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const { data: review } = useQuery(
    gitPullRequestReviewQueryOptions({
      cwd,
      number: pr.number,
      enabled: props.enabled && pr.state === "open",
    }),
  );
  const watchQuery = gitPullRequestWatchStatusQueryOptions(props.threadId);
  const { data: watch } = useQuery({
    ...watchQuery,
    enabled: props.enabled && props.threadId !== null,
  });
  const watching = watch?.number === pr.number;
  const toggleWatch = useMutation({
    mutationFn: (enabled: boolean) =>
      ensureNativeApi().git.setPullRequestWatch({
        threadId: props.threadId as ThreadId,
        cwd,
        number: pr.number,
        enabled,
      }),
    onSuccess: (_result, enabled) =>
      toastManager.add({
        type: "success",
        title: enabled ? `Watching #${pr.number}` : `Stopped watching #${pr.number}`,
        ...(enabled
          ? {
              description:
                "The agent is told when checks finish, reviews arrive or conflicts appear.",
            }
          : {}),
      }),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Could not update the watch",
        description: error.message,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: watchQuery.queryKey }),
  });
  const actions = usePullRequestActions({
    cwd,
    number: pr.number,
    threadId: props.threadId,
    onPromptDrafted: props.onClose,
  });
  const presentation = resolvePrStatePresentation(pr);
  const Icon = PR_STATE_PRESENTATION_ICONS[presentation.iconKind] ?? GitPullRequestIcon;
  const nextStep = review ? resolvePullRequestNextStep(pr, review) : null;
  const checks = review ? summarizePullRequestChecks(review.checks) : null;
  const openDetail = () => {
    if (!props.threadId) return props.onOpenUrl(pr.url);
    useMainWorkspaceStore.getState().openReview(props.threadId, {
      id: `pr:${pr.number}`,
      kind: "pullRequest",
      cwd,
      number: pr.number,
      title: pr.title,
    });
    props.onClose();
  };
  return (
    <EnvironmentLabeledSection label="Pull request">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center">
          <button
            type="button"
            className={cn(ENVIRONMENT_ROW_CLASS_NAME, "min-w-0 flex-1")}
            aria-label={`Open pull request #${pr.number}`}
            onClick={openDetail}
          >
            <EnvironmentRowBody
              icon={
                <Icon
                  className={cn(ENVIRONMENT_ROW_ICON_CLASS_NAME, presentation.colorClass)}
                  aria-hidden
                />
              }
              label={`#${pr.number} ${pr.title}`}
              trailing={
                <span className={cn("text-ui-xs", SECONDARY_TEXT_CLASS_NAME)}>
                  {presentation.label}
                </span>
              }
            />
          </button>
          <IconButton
            size="icon-xs"
            label="Open on GitHub"
            tooltip="Open on GitHub"
            onClick={() => props.onOpenUrl(pr.url)}
          >
            <ArrowUpRightIcon className="size-3.5" />
          </IconButton>
        </div>
        <div
          className={cn(
            "flex min-h-7 items-center gap-1.5 px-2 text-ui-xs",
            SECONDARY_TEXT_CLASS_NAME,
          )}
        >
          {pr.additions !== null && pr.deletions !== null ? (
            <DiffStat
              insertions={pr.additions}
              deletions={pr.deletions}
              colored={props.showDiffColors}
            />
          ) : null}
          {checks && review ? (
            <Popover>
              <PopoverTrigger
                openOnHover
                render={
                  <button
                    type="button"
                    className={cn(INLINE_TRIGGER_CLASS_NAME, CHECK_TONE_CLASS[checks.tone])}
                  />
                }
              >
                <CheckStateIcon
                  state={
                    checks.tone === "failure"
                      ? "failure"
                      : checks.tone === "pending"
                        ? "pending"
                        : "success"
                  }
                />
                {checks.label}
              </PopoverTrigger>
              <PopoverPopup side="left" align="start" className="max-h-72 w-72 overflow-y-auto">
                <PullRequestCheckList checks={review.checks} />
              </PopoverPopup>
            </Popover>
          ) : null}
          {review && review.comments.length > 0 ? (
            <Popover>
              <PopoverTrigger
                openOnHover
                render={<button type="button" className={INLINE_TRIGGER_CLASS_NAME} />}
              >
                {review.comments.length} {review.comments.length === 1 ? "comment" : "comments"}
              </PopoverTrigger>
              <PopoverPopup side="left" align="start" className="w-80">
                <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto text-ui-sm">
                  {review.comments.map((comment, index) => (
                    <li
                      key={`${comment.url ?? comment.author}-${index}`}
                      className="flex flex-col gap-1"
                    >
                      <span className="flex items-center gap-1.5 text-ui-xs text-muted-foreground">
                        <AuthorAvatar
                          actor={{ login: comment.author, avatarUrl: comment.authorAvatarUrl }}
                        />
                        {comment.author}
                        {comment.path
                          ? ` · ${comment.path}${comment.line ? `:${comment.line}` : ""}`
                          : ""}
                      </span>
                      <p className="line-clamp-3 whitespace-pre-wrap">{comment.body}</p>
                      <Button
                        size="chip"
                        variant="ghost"
                        className="self-start"
                        disabled={!actions.canDraft}
                        onClick={() =>
                          actions.draftPrompt(buildReviewCommentsPrompt(pr.number, [comment]))
                        }
                      >
                        Fix
                      </Button>
                    </li>
                  ))}
                </ul>
              </PopoverPopup>
            </Popover>
          ) : null}
          <span className="flex-1" />
          {props.threadId && pr.state === "open" ? (
            <IconButton
              size="icon-xs"
              label={watching ? "Stop watching" : "Watch for changes"}
              tooltip={
                watching
                  ? `Watching${watch?.lastEvent ? `: ${watch.lastEvent}` : ""}. Click to stop.`
                  : "Wake the agent when checks finish, reviews arrive or conflicts appear"
              }
              disabled={toggleWatch.isPending}
              aria-pressed={watching}
              className="aria-pressed:bg-primary/15 aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-primary/60"
              onClick={() => toggleWatch.mutate(!watching)}
            >
              <ViewIcon className="size-3.5" />
            </IconButton>
          ) : null}
          {review && nextStep?.kind === "fix_checks" && actions.canRerun(review.checks) ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={actions.busy}
              onClick={() => actions.rerunFailed(review.checks)}
            >
              Rerun
            </Button>
          ) : null}
          {nextStep?.kind === "wait" ? <span>{nextStep.label}</span> : null}
          {review && nextStep && nextStep.kind !== "wait" ? (
            <Button
              size="xs"
              variant={nextStep.kind === "merge" ? "default" : "outline"}
              disabled={
                actions.busy ||
                ((nextStep.kind === "fix" ||
                  nextStep.kind === "resolve" ||
                  nextStep.kind === "fix_checks") &&
                  !actions.canDraft)
              }
              onClick={() => {
                if (nextStep.kind === "fix_checks") void actions.draftFixChecks(review.checks);
                else if (nextStep.kind === "fix" || nextStep.kind === "resolve")
                  actions.draftPrompt(nextStep.prompt);
                else if (nextStep.kind === "ready" || nextStep.kind === "update_branch")
                  actions.run({ kind: nextStep.kind });
                else setConfirmingMerge(true);
              }}
            >
              {actions.busy ? <Spinner variant="action" /> : null}
              {nextStep.label}
            </Button>
          ) : null}
        </div>
      </div>
      {nextStep?.kind === "merge" ? (
        <MergePullRequestDialog
          open={confirmingMerge}
          onOpenChange={setConfirmingMerge}
          number={pr.number}
          title={pr.title}
          baseBranch={pr.baseBranch}
          methods={nextStep.methods}
          busy={actions.busy}
          onMerge={(method) => {
            setConfirmingMerge(false);
            actions.run({ kind: "merge", method });
          }}
        />
      ) : null}
    </EnvironmentLabeledSection>
  );
}
