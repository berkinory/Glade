import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  GitPullRequestActionInput,
  GitPullRequestCheck,
  GitPullRequestMergeMethod,
} from "@glade/contracts/git/pullRequestReview";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useComposerDraftStore } from "~/composerDraftStore";
import { invalidateGitQueries } from "~/lib/gitQueryOptions";
import { ensureNativeApi } from "~/nativeApi";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { buildFailingChecksPrompt } from "./pullRequestPrompts";

const SUCCESS = {
  merge: (number: number) => ({ title: "PR merged", description: `Merged #${number}.` }),
  ready: (number: number) => ({
    title: "PR ready for review",
    description: `#${number} is ready for review.`,
  }),
  update_branch: (number: number) => ({
    title: "Branch updated",
    description: `Updated #${number} with its base branch.`,
  }),
} as const;

const FAILURE = {
  merge: "Could not merge PR",
  ready: "Could not mark PR ready",
  update_branch: "Could not update branch",
} as const;

const MERGE_METHOD_LABELS: Record<GitPullRequestMergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};

export interface PullRequestActions {
  readonly run: (prAction: GitPullRequestActionInput["action"]) => void;
  readonly rerunFailed: (checks: ReadonlyArray<GitPullRequestCheck>) => void;
  readonly canRerun: (checks: ReadonlyArray<GitPullRequestCheck>) => boolean;
  readonly draftPrompt: (prompt: string) => void;
  readonly draftFixChecks: (checks: ReadonlyArray<GitPullRequestCheck>) => Promise<void>;
  readonly canDraft: boolean;
  readonly busy: boolean;
}

/** Actions shared by every surface that shows a pull request. */
export function usePullRequestActions(input: {
  cwd: string;
  number: number;
  threadId: ThreadId | null;
  onPromptDrafted?: () => void;
}): PullRequestActions {
  const queryClient = useQueryClient();
  const [drafting, setDrafting] = useState(false);
  const action = useMutation({
    mutationFn: (prAction: GitPullRequestActionInput["action"]) =>
      ensureNativeApi().git.pullRequestAction({
        cwd: input.cwd,
        number: input.number,
        action: prAction,
      }),
    onSuccess: (_result, prAction) =>
      toastManager.add({ type: "success", ...SUCCESS[prAction.kind](input.number) }),
    onError: (error, prAction) =>
      toastManager.add({
        type: "error",
        title: FAILURE[prAction.kind],
        description: error.message,
      }),
    onSettled: () => invalidateGitQueries(queryClient),
  });
  const rerun = useMutation({
    mutationFn: (runIds: ReadonlyArray<number>) =>
      Promise.all(
        runIds.map((runId) => ensureNativeApi().git.rerunFailedJobs({ cwd: input.cwd, runId })),
      ),
    onSuccess: () => toastManager.add({ type: "success", title: "Rerunning failed jobs" }),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Could not rerun jobs",
        description: error.message,
      }),
    onSettled: () => invalidateGitQueries(queryClient),
  });

  const draftPrompt = (prompt: string) => {
    if (!input.threadId) return;
    useComposerDraftStore.getState().setPrompt(input.threadId, prompt);
    input.onPromptDrafted?.();
  };

  const draftFixChecks = async (checks: ReadonlyArray<GitPullRequestCheck>) => {
    setDrafting(true);
    try {
      draftPrompt(await buildFailingChecksPrompt(input.cwd, input.number, checks));
    } finally {
      setDrafting(false);
    }
  };

  return {
    run: (prAction: GitPullRequestActionInput["action"]) => action.mutate(prAction),
    rerunFailed: (checks: ReadonlyArray<GitPullRequestCheck>) => {
      const runIds = [
        ...new Set(
          checks.flatMap((check) =>
            check.state === "failure" && check.runId !== null ? [check.runId] : [],
          ),
        ),
      ];
      if (runIds.length > 0) rerun.mutate(runIds);
    },
    canRerun: (checks: ReadonlyArray<GitPullRequestCheck>) =>
      checks.some((check) => check.state === "failure" && check.runId !== null),
    draftPrompt,
    draftFixChecks,
    canDraft: input.threadId !== null,
    busy: action.isPending || rerun.isPending || drafting,
  };
}

export function MergePullRequestDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  number: number;
  title: string;
  baseBranch: string;
  methods: ReadonlyArray<GitPullRequestMergeMethod>;
  busy: boolean;
  onMerge: (method: GitPullRequestMergeMethod) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Merge #{props.number}?</DialogTitle>
          <DialogDescription>
            {props.title} will be merged into {props.baseBranch} on GitHub.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          {props.methods.map((method, index) => (
            <Button
              key={method}
              size="sm"
              variant={index === 0 ? "default" : "outline"}
              disabled={props.busy}
              onClick={() => props.onMerge(method)}
            >
              {MERGE_METHOD_LABELS[method]}
            </Button>
          ))}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
