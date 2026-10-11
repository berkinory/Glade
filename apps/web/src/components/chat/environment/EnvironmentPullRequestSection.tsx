import { CircleCheckIcon, GitPullRequestIcon, MinusIcon, XIcon } from "~/lib/icons";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  GitPullRequestActionInput,
  GitPullRequestCheckState,
} from "@glade/contracts/git/pullRequestReview";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useComposerDraftStore } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import {
  gitPullRequestReviewQueryOptions,
  gitStatusQueryOptions,
  invalidateGitQueries,
} from "../../../lib/gitQueryOptions";
import {
  PR_STATE_PRESENTATION_ICONS,
  resolvePrStatePresentation,
} from "../../pullRequest/pullRequestStatePresentation";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { Popover, PopoverPopup, PopoverTrigger } from "../../ui/popover";
import { Spinner } from "../../ui/spinner";
import { toastManager } from "../../ui/toast";
import { ENVIRONMENT_ROW_CLASS_NAME, EnvironmentLabeledSection } from "./EnvironmentRow";
import {
  buildReviewCommentsPrompt,
  MERGE_METHOD_LABELS,
  resolvePullRequestNextStep,
  summarizePullRequestChecks,
} from "./EnvironmentPullRequestSection.logic";

const PULL_REQUEST_ACTION_SUCCESS = {
  merge: (number: number) => `Merged #${number}`,
  ready: (number: number) => `#${number} is ready for review`,
  update_branch: (number: number) => `Updated #${number} with its base branch`,
} as const;

const PULL_REQUEST_ACTION_FAILURE = {
  merge: "Could not merge",
  ready: "Could not mark ready",
  update_branch: "Could not update the branch",
} as const;

const CHECK_TONE_CLASS = {
  success: "text-status-success",
  failure: "text-status-failure",
  pending: "text-warning",
  neutral: "text-muted-foreground",
} as const;

function CheckStateIcon({ state }: { state: GitPullRequestCheckState }) {
  if (state === "pending") return <Spinner variant="action" className="size-3 text-warning" />;
  const Icon = state === "success" ? CircleCheckIcon : state === "failure" ? XIcon : MinusIcon;
  const tone = state === "success" ? "success" : state === "failure" ? "failure" : "neutral";
  return <Icon aria-hidden className={cn("size-3 shrink-0", CHECK_TONE_CLASS[tone])} />;
}

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
  const queryClient = useQueryClient();
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const { data: status } = useQuery(gitStatusQueryOptions(gitCwd, enabled));
  const pr = status?.pr ?? null;
  const { data: review } = useQuery(
    gitPullRequestReviewQueryOptions({
      cwd: gitCwd,
      number: pr?.number ?? null,
      enabled: enabled && pr?.state === "open",
    }),
  );
  const action = useMutation({
    mutationFn: (input: GitPullRequestActionInput) =>
      ensureNativeApi().git.pullRequestAction(input),
    onSuccess: (_result, input) => {
      setConfirmingMerge(false);
      toastManager.add({
        type: "success",
        title: PULL_REQUEST_ACTION_SUCCESS[input.action.kind](input.number),
      });
    },
    onError: (error, input) =>
      toastManager.add({
        type: "error",
        title: PULL_REQUEST_ACTION_FAILURE[input.action.kind],
        description: error.message,
      }),
    onSettled: () => invalidateGitQueries(queryClient),
  });
  if (!pr || !gitCwd) return null;
  const runAction = (prAction: GitPullRequestActionInput["action"]) =>
    action.mutate({ cwd: gitCwd, number: pr.number, action: prAction });
  const presentation = resolvePrStatePresentation(pr);
  const Icon = PR_STATE_PRESENTATION_ICONS[presentation.iconKind] ?? GitPullRequestIcon;
  const nextStep = review ? resolvePullRequestNextStep(pr, review) : null;
  const checks = review ? summarizePullRequestChecks(review.checks) : null;
  const draftPrompt = (prompt: string) => {
    if (!activeThreadId) return;
    useComposerDraftStore.getState().setPrompt(activeThreadId, prompt);
    onClose();
  };
  return (
    <EnvironmentLabeledSection label="Pull request">
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          className={ENVIRONMENT_ROW_CLASS_NAME}
          title={`Open #${pr.number} on GitHub`}
          onClick={() => {
            onOpenUrl(pr.url);
            onClose();
          }}
        >
          <Icon className={`size-4 shrink-0 ${presentation.colorClass}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            #{pr.number} {pr.title}
          </span>
          <span className="shrink-0 text-ui-xs text-muted-foreground">{presentation.label}</span>
        </button>
        <div className="flex min-h-7 items-center gap-2 px-2 text-ui-xs text-muted-foreground">
          {pr.additions !== null && pr.deletions !== null ? (
            <span className="tabular-nums">
              <span className={showDiffColors ? "text-success" : undefined}>+{pr.additions}</span>{" "}
              <span className={showDiffColors ? "text-destructive" : undefined}>
                −{pr.deletions}
              </span>
            </span>
          ) : null}
          {checks && review ? (
            <Popover>
              <PopoverTrigger
                openOnHover
                render={
                  <button
                    type="button"
                    className={cn("inline-flex items-center gap-1", CHECK_TONE_CLASS[checks.tone])}
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
              <PopoverPopup side="left" align="start" className="w-64">
                <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-ui-sm">
                  {review.checks.map((check) => (
                    <li key={`${check.name}-${check.url}`} className="flex items-center gap-2">
                      <CheckStateIcon state={check.state} />
                      {check.url ? (
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left hover:underline"
                          onClick={() => check.url && onOpenUrl(check.url)}
                        >
                          {check.name}
                        </button>
                      ) : (
                        <span className="min-w-0 flex-1 truncate">{check.name}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </PopoverPopup>
            </Popover>
          ) : null}
          {review && review.comments.length > 0 ? (
            <Popover>
              <PopoverTrigger
                openOnHover
                render={<button type="button" className="inline-flex items-center gap-1" />}
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
                      <span className="text-ui-xs text-muted-foreground">
                        {comment.author}
                        {comment.path
                          ? ` · ${comment.path}${comment.line ? `:${comment.line}` : ""}`
                          : ""}
                      </span>
                      <p className="line-clamp-3 whitespace-pre-wrap">{comment.body}</p>
                      <Button
                        size="xs"
                        variant="outline"
                        className="self-start"
                        disabled={!activeThreadId}
                        onClick={() => draftPrompt(buildReviewCommentsPrompt(pr.number, [comment]))}
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
          {nextStep?.kind === "wait" ? <span>{nextStep.label}</span> : null}
          {nextStep && nextStep.kind !== "wait" ? (
            <Button
              size="xs"
              variant={nextStep.kind === "merge" ? "default" : "outline"}
              disabled={
                action.isPending ||
                ((nextStep.kind === "fix" || nextStep.kind === "resolve") && !activeThreadId)
              }
              onClick={() => {
                if (nextStep.kind === "fix" || nextStep.kind === "resolve")
                  draftPrompt(nextStep.prompt);
                else if (nextStep.kind === "ready" || nextStep.kind === "update_branch")
                  runAction({ kind: nextStep.kind });
                else setConfirmingMerge(true);
              }}
            >
              {action.isPending ? <Spinner variant="action" /> : null}
              {nextStep.label}
            </Button>
          ) : null}
        </div>
      </div>
      <Dialog open={confirmingMerge} onOpenChange={setConfirmingMerge}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Merge #{pr.number}?</DialogTitle>
            <DialogDescription>
              {pr.title} will be merged into {pr.baseBranch} on GitHub.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmingMerge(false)}>
              Cancel
            </Button>
            {nextStep?.kind === "merge"
              ? nextStep.methods.map((method, index) => (
                  <Button
                    key={method}
                    size="sm"
                    variant={index === 0 ? "default" : "outline"}
                    disabled={action.isPending}
                    onClick={() => runAction({ kind: "merge", method })}
                  >
                    {MERGE_METHOD_LABELS[method]}
                  </Button>
                ))
              : null}
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </EnvironmentLabeledSection>
  );
}
