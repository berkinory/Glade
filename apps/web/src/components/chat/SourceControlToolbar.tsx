import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCommitDrafts } from "./commitDraftStore";
import BranchToolbar from "../BranchToolbar";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { SourceControlCommitInput } from "./SourceControlCommitInput";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import {
  IconCloudDownload,
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconRefreshAlert,
  IconArrowUp,
  IconArrowDown,
} from "@tabler/icons-react";
import { gitStatusQueryOptions } from "../../lib/gitQueryOptions";
import {
  gitRebaseStateQueryOptions,
  gitSourceControlActionMutationOptions,
  type SourceControlAction,
} from "~/lib/gitReactQuery";
import { hasUnsavedWorkspaceEditors } from "~/lib/workspaceEditorSession";

export function SourceControlToolbar({
  cwd,
  threadId,
  stagedCount,
  busy,
  onOpenFile,
}: {
  cwd: string;
  threadId: ThreadId;
  stagedCount: number;
  busy: boolean;
  onOpenFile: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const message = useCommitDrafts((state) => state.messages[cwd] ?? "");
  const setDraft = useCommitDrafts((state) => state.set);
  const status = useQuery(gitStatusQueryOptions(cwd));
  const rebase = useQuery(gitRebaseStateQueryOptions(cwd));
  const mutation = useMutation(gitSourceControlActionMutationOptions({ cwd, queryClient }));
  const disabled = busy || mutation.isPending;
  const rebasing = rebase.data?.inProgress ?? false;
  const canCommit =
    !disabled &&
    !rebasing &&
    !rebase.data?.conflicts.length &&
    !rebase.data?.pendingPush &&
    !rebase.isPending &&
    !rebase.isError &&
    stagedCount > 0 &&
    message.trim().length > 0;

  const run = (request: SourceControlAction) => {
    if (disabled) return;
    if (
      (request.action === "pull" || request.action === "rebase") &&
      hasUnsavedWorkspaceEditors(queryClient, cwd)
    ) {
      toastManager.add({
        type: "error",
        title: "Save your open files before changing the working tree.",
      });
      return;
    }
    mutation.mutate(request, {
      onSuccess: () => {
        if (request.action === "commit") {
          if (useCommitDrafts.getState().messages[cwd] === message) setDraft(cwd, "");
          toastManager.add({ type: "success", title: "Staged changes committed" });
        } else
          toastManager.add({
            type: "success",
            title:
              request.action === "fetch"
                ? "Fetch complete"
                : request.action === "pull"
                  ? "Pull complete"
                  : request.action === "push"
                    ? "Push complete"
                    : "Git operation updated",
          });
      },
      onError: (error) =>
        toastManager.add({
          type: "error",
          title: `Could not ${request.action}`,
          description: error.message,
        }),
    });
  };

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/70 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0" inert={disabled || rebasing}>
          <BranchToolbar
            threadId={threadId}
            onEnvModeChange={() => {}}
            envLocked
            threadDetailReady
            variant="compact"
            showEnvironment={false}
            className="!m-0 !w-auto !p-0"
          />
        </div>
        {status.data?.hasUpstream ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  className="inline-flex shrink-0 items-center gap-1.5 px-1 text-ui-xs text-muted-foreground tabular-nums"
                  aria-label={`${status.data.aheadCount} outgoing commits, ${status.data.behindCount} incoming commits`}
                />
              }
            >
              <span className="inline-flex items-center gap-0.5">
                <IconArrowUp aria-hidden className="size-3" />
                {status.data.aheadCount}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <IconArrowDown aria-hidden className="size-3" />
                {status.data.behindCount}
              </span>
            </TooltipTrigger>
            <TooltipPopup>
              {status.data.aheadCount} outgoing · {status.data.behindCount} incoming
              <br />
              Compared with {status.data.upstreamBranch ?? "upstream"}. Fetch to update.
            </TooltipPopup>
          </Tooltip>
        ) : null}
        <div className="flex-1" />
        <IconButton
          label="Fetch all remotes"
          tooltip="Fetch"
          disabled={disabled}
          onClick={() => run({ action: "fetch" })}
        >
          {mutation.isPending && mutation.variables?.action === "fetch" ? (
            <Spinner />
          ) : (
            <IconCloudDownload className="size-4" />
          )}
        </IconButton>
        <IconButton
          label="Pull (fast-forward only)"
          tooltip="Pull"
          disabled={
            disabled ||
            rebasing ||
            rebase.isPending ||
            rebase.isError ||
            Boolean(rebase.data?.conflicts.length)
          }
          onClick={() => run({ action: "pull" })}
        >
          {mutation.isPending && mutation.variables?.action === "pull" ? (
            <Spinner />
          ) : (
            <IconArrowBarToDown className="size-4" />
          )}
        </IconButton>
        <IconButton
          label="Push commits"
          tooltip="Push"
          disabled={
            disabled ||
            rebasing ||
            rebase.isPending ||
            rebase.isError ||
            Boolean(rebase.data?.conflicts.length)
          }
          onClick={() => run({ action: "push" })}
        >
          {mutation.isPending && mutation.variables?.action === "push" ? (
            <Spinner className="size-4" />
          ) : (
            <IconArrowBarToUp className="size-4" />
          )}
        </IconButton>
      </div>
      {rebase.isError ? (
        <button
          type="button"
          className="flex items-center gap-1 text-ui-xs text-destructive"
          onClick={() => void rebase.refetch()}
        >
          <IconRefreshAlert className="size-3.5" /> Git operation status unavailable · Retry
        </button>
      ) : null}
      {rebase.data?.conflicts.map((path) => (
        <button
          key={path}
          type="button"
          className="truncate text-left text-ui-sm text-destructive"
          onClick={() => onOpenFile(path)}
        >
          Conflict: {path}
        </button>
      ))}
      {rebasing || rebase.data?.pendingPush ? (
        <div className="flex flex-col gap-2">
          <p className="text-ui-sm text-muted-foreground">
            {rebasing
              ? `${rebase.data?.kind} in progress. Resolve conflicts, stage the files, then continue.`
              : "The previous push was interrupted. Resume or cancel it."}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={disabled}
              onClick={() =>
                run({
                  action: "rebase",
                  rebase: { action: "continue", operation: rebase.data?.kind ?? "rebase" },
                })
              }
            >
              {rebasing ? `Continue ${rebase.data?.kind}` : "Resume push"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                run({
                  action: "rebase",
                  rebase: { action: "abort", operation: rebase.data?.kind ?? "rebase" },
                })
              }
            >
              {rebasing ? `Abort ${rebase.data?.kind}` : "Cancel push"}
            </Button>
          </div>
        </div>
      ) : (
        <SourceControlCommitInput
          cwd={cwd}
          message={message}
          canCommit={canCommit}
          canGenerate={!disabled && !rebasing && stagedCount > 0}
          committing={mutation.isPending && mutation.variables?.action === "commit"}
          onChange={(next) => setDraft(cwd, next)}
          onGenerated={(generated) => {
            if ((useCommitDrafts.getState().messages[cwd] ?? "") === message)
              setDraft(cwd, generated);
          }}
          onCommit={() => run({ action: "commit", message: message.trim() })}
        />
      )}
    </div>
  );
}
