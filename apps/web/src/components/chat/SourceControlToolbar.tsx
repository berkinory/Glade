import type { ThreadId } from "@glade/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { create } from "zustand";
import BranchToolbar from "../BranchToolbar";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { SourceControlCommitInput } from "./SourceControlCommitInput";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Spinner } from "../ui/spinner";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
} from "../ui/alert-dialog";
import {
  IconCloudDownload,
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconGitCompare,
  IconRefreshAlert,
  IconArrowUp,
  IconArrowDown,
} from "@tabler/icons-react";
import {
  gitBranchesQueryOptions,
  gitStatusQueryOptions,
  gitRebaseStateQueryOptions,
  gitSourceControlActionMutationOptions,
  type SourceControlAction,
} from "~/lib/gitReactQuery";
import { hasUnsavedWorkspaceEditors } from "~/lib/workspaceEditorSession";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";

// A workspace draft survives tab/thread switches and is shared by panes of the same repo.
const useCommitDrafts = create<{
  messages: Record<string, string>;
  set: (cwd: string, message: string) => void;
}>((set) => ({
  messages: {},
  set: (cwd, message) => set((state) => ({ messages: { ...state.messages, [cwd]: message } })),
}));

export function SourceControlToolbar({
  cwd,
  threadId,
  stagedCount,
  busy,
}: {
  cwd: string;
  threadId: ThreadId;
  stagedCount: number;
  busy: boolean;
}) {
  const queryClient = useQueryClient();
  const message = useCommitDrafts((state) => state.messages[cwd] ?? "");
  const setDraft = useCommitDrafts((state) => state.set);
  const [rebaseTarget, setRebaseTarget] = useState<string | null>(null);
  const [rebaseMenuOpen, setRebaseMenuOpen] = useState(false);
  const status = useQuery(gitStatusQueryOptions(cwd));
  const branches = useQuery({ ...gitBranchesQueryOptions(cwd), enabled: rebaseMenuOpen });
  const rebase = useQuery(gitRebaseStateQueryOptions(cwd));
  const mutation = useMutation(gitSourceControlActionMutationOptions({ cwd, queryClient }));
  const disabled = busy || mutation.isPending;
  const rebasing = rebase.data?.inProgress ?? false;
  const canCommit =
    !disabled &&
    !rebasing &&
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
          // Do not clear a draft edited in another pane while the commit was running.
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
                    : "Rebase updated",
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
        <div className="min-w-0 flex-1" inert={disabled || rebasing}>
          <BranchToolbar
            threadId={threadId}
            onEnvModeChange={() => {}}
            envLocked
            threadDetailReady
            variant="compact"
            showEnvironment={false}
            className="!m-0 !p-0"
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
          disabled={disabled || rebasing}
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
          disabled={disabled || rebasing}
          onClick={() => run({ action: "push" })}
        >
          {mutation.isPending && mutation.variables?.action === "push" ? (
            <Spinner className="size-4" />
          ) : (
            <IconArrowBarToUp className="size-4" />
          )}
        </IconButton>
        <Menu open={rebaseMenuOpen} onOpenChange={setRebaseMenuOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Rebase onto branch"
                      disabled={disabled || rebasing || rebase.isPending || rebase.isError}
                    />
                  }
                />
              }
            >
              {mutation.isPending && mutation.variables?.action === "rebase" ? (
                <Spinner className="size-4" />
              ) : (
                <IconGitCompare className="size-4" />
              )}
            </TooltipTrigger>
            <TooltipPopup>Rebase onto branch</TooltipPopup>
          </Tooltip>
          <ComposerPickerMenuPopup align="end" className="max-h-72 overflow-y-auto">
            <div className="px-2 py-1 text-ui-xs text-muted-foreground">Rebase onto…</div>
            {branches.isLoading ? (
              <Spinner className="m-2 size-4" />
            ) : branches.error ? (
              <div className="max-w-64 p-2 text-ui-sm text-destructive">
                {branches.error.message}
              </div>
            ) : (
              branches.data?.branches
                .filter((branch) => !branch.current)
                .map((branch) => (
                  <MenuItem
                    key={`${branch.isRemote ? "remote" : "local"}:${branch.name}`}
                    onClick={() =>
                      setRebaseTarget(
                        `${branch.isRemote ? "refs/remotes/" : "refs/heads/"}${branch.name}`,
                      )
                    }
                  >
                    <IconGitCompare className="size-4" />
                    {branch.name}
                  </MenuItem>
                ))
            )}
            {!branches.isLoading &&
            !branches.isError &&
            !branches.data?.branches.some((branch) => !branch.current) ? (
              <div className="p-2 text-ui-sm text-muted-foreground">No other branches</div>
            ) : null}
          </ComposerPickerMenuPopup>
        </Menu>
      </div>
      {rebase.isError ? (
        <button
          type="button"
          className="flex items-center gap-1 text-ui-xs text-destructive"
          title={rebase.error.message}
          onClick={() => void rebase.refetch()}
        >
          <IconRefreshAlert className="size-3.5" /> Rebase status unavailable · Retry
        </button>
      ) : null}
      {rebasing ? (
        <div className="flex flex-col gap-2">
          <p className="text-ui-sm text-muted-foreground">
            Rebase in progress. Resolve conflicts, stage the files, then continue.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => run({ action: "rebase", rebase: { action: "continue" } })}
            >
              Continue rebase
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => run({ action: "rebase", rebase: { action: "abort" } })}
            >
              Abort rebase
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
      <AlertDialog
        open={rebaseTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRebaseTarget(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Rebase current branch?</AlertDialogTitle>
            <AlertDialogDescription>
              Replay this branch’s commits onto{" "}
              {rebaseTarget?.replace(/^refs\/(heads|remotes)\//, "")}. This rewrites commit history.
              Commit or stash local changes first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              disabled={disabled}
              onClick={() => {
                if (!rebaseTarget) return;
                run({ action: "rebase", rebase: { action: "start", target: rebaseTarget } });
                setRebaseTarget(null);
              }}
            >
              Rebase
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
