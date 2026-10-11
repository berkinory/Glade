import {
  CloudDownloadIcon,
  CloudUploadIcon,
  RefreshCwIcon,
  ArrowUp02Icon,
  ArrowDown02Icon,
} from "~/lib/icons";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { GitStatusResult } from "@glade/contracts/git/git";
import { useGitPublishFlow } from "./useGitPublishFlow";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCommitDrafts } from "./commitDraftStore";
import { undoCommit } from "./sourceControlUndo";
import BranchToolbar from "../BranchToolbar";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { SourceControlCommitInput } from "./SourceControlCommitInput";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { useState } from "react";
import { ensureNativeApi } from "~/nativeApi";
import {
  assertCommitScope,
  assertStagedChanges,
  commitScopeInventory,
  readCommitScope,
} from "./sourceControlCommitScope";
import {
  gitSourceControlFilesQueryOptions,
  gitStatusQueryOptions,
} from "../../lib/gitQueryOptions";
import {
  gitRebaseStateQueryOptions,
  gitSourceControlActionMutationOptions,
  type SourceControlAction,
} from "~/lib/gitReactQuery";
import { hasUnsavedWorkspaceEditors } from "~/lib/workspaceEditorSession";
export function SourceControlToolbar({
  cwd,
  threadId,
  busy,
  onOpenFile,
}: {
  cwd: string;
  threadId: ThreadId;
  busy: boolean;
  onOpenFile: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const message = useCommitDrafts((state) => state.messages[cwd] ?? "");
  const setDraft = useCommitDrafts((state) => state.set);
  const files = useQuery(gitSourceControlFilesQueryOptions(cwd));
  const suggestedScope = useCommitDrafts((state) => state.scopes[cwd]);
  const setSuggestion = useCommitDrafts((state) => state.setSuggestion);
  const [checkingCommit, setCheckingCommit] = useState(false);
  const hasChanges = Boolean(
    files.data && (files.data.staged.length > 0 || files.data.unstaged.length > 0),
  );
  const status = useQuery(gitStatusQueryOptions(cwd));
  const rebase = useQuery(gitRebaseStateQueryOptions(cwd));
  const mutation = useMutation(
    gitSourceControlActionMutationOptions({
      cwd,
      queryClient,
    }),
  );
  const publishFlow = useGitPublishFlow(cwd);
  const disabled = busy || mutation.isPending || checkingCommit || publishFlow.isPending;
  const rebasing = rebase.data?.inProgress ?? false;
  const canCommit =
    !disabled &&
    !rebasing &&
    !rebase.data?.conflicts.length &&
    !rebase.data?.pendingPush &&
    !rebase.isPending &&
    !rebase.isError &&
    hasChanges &&
    !files.isError &&
    message.trim().length > 0;
  const run = (request: SourceControlAction) => {
    if (!disabled) execute(request);
  };
  const execute = (request: SourceControlAction) => {
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
          toastManager.add({
            type: "success",
            title: "Changes committed",
          });
        } else
          toastManager.add({
            type: "success",
            title:
              request.action === "fetch"
                ? "Fetched"
                : request.action === "pull"
                  ? "Pulled"
                  : request.action === "push"
                    ? "Pushed"
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
  const commit = async (thenPush: boolean) => {
    if (!canCommit || !files.data) return;
    setCheckingCommit(true);
    try {
      if (hasUnsavedWorkspaceEditors(queryClient, cwd))
        throw new Error("Save your open files before committing.");
      const scope = await readCommitScope(cwd);
      if (commitScopeInventory(files.data) !== scope.inventory)
        throw new Error("The commit scope changed. Review the changes and try again.");
      if (suggestedScope) assertCommitScope(suggestedScope, scope);
      const api = ensureNativeApi();
      if (!scope.staged) {
        assertCommitScope(scope, await readCommitScope(cwd));
        const staged = await api.git.stageFiles({
          cwd,
          paths: scope.paths,
        });
        if (!staged.ok)
          throw new Error("Could not stage all changes. Your message has been preserved.");
        const after = await readCommitScope(cwd);
        assertStagedChanges(scope, after);
        assertCommitScope(after, await readCommitScope(cwd));
      } else {
        assertCommitScope(scope, await readCommitScope(cwd));
      }
      await mutation.mutateAsync({
        action: "commit",
        message: message.trim(),
      });
      if ((useCommitDrafts.getState().messages[cwd] ?? "") === message) setDraft(cwd, "");
      // Captured now so the toast's Undo targets this commit even after later commits.
      const undoableHead = await api.git.checkUndoCommit({ cwd }).catch(() => null);
      toastManager.add({
        type: "success",
        title: "Changes committed",
        ...(undoableHead
          ? {
              actionProps: {
                children: "Undo",
                onClick: () => void undoCommit(queryClient, cwd, undoableHead),
              },
            }
          : {}),
      });
      if (thenPush) publishFlow.start(() => execute({ action: "push" }));
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not commit",
        description: error instanceof Error ? error.message : "Git operation failed.",
      });
    } finally {
      setCheckingCommit(false);
      void queryClient.invalidateQueries({
        queryKey: gitSourceControlFilesQueryOptions(cwd).queryKey,
      });
    }
  };
  const push = () => {
    if (disabled) return;
    publishFlow.start(() => run({ action: "push" }));
  };
  const sync = resolveSourceControlSync(status.data);
  const integrationBlocked =
    rebasing || rebase.isPending || rebase.isError || Boolean(rebase.data?.conflicts.length);
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
        <div className="flex-1" />
        <IconButton
          label="Fetch all remotes"
          tooltip="Fetch"
          disabled={disabled}
          onClick={() =>
            run({
              action: "fetch",
            })
          }
        >
          {mutation.isPending && mutation.variables?.action === "fetch" ? (
            <Spinner variant="action" />
          ) : (
            <CloudDownloadIcon className="size-4" />
          )}
        </IconButton>
        {sync ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  className="shrink-0 gap-1 tabular-nums"
                  disabled={disabled || integrationBlocked}
                  onClick={() => (sync.kind === "pull" ? run({ action: "pull" }) : push())}
                />
              }
            >
              {mutation.isPending &&
              (mutation.variables?.action === "pull" || mutation.variables?.action === "push") ? (
                <Spinner variant="action" />
              ) : sync.kind === "publish" ? (
                <CloudUploadIcon className="size-3.5" />
              ) : null}
              {sync.label}
              {sync.behind > 0 ? (
                <span className="inline-flex items-center">
                  <ArrowDown02Icon aria-hidden className="size-3" />
                  {sync.behind}
                </span>
              ) : null}
              {sync.ahead > 0 ? (
                <span className="inline-flex items-center">
                  <ArrowUp02Icon aria-hidden className="size-3" />
                  {sync.ahead}
                </span>
              ) : null}
            </TooltipTrigger>
            <TooltipPopup>{sync.description}</TooltipPopup>
          </Tooltip>
        ) : status.data ? (
          <span className="shrink-0 px-1 text-ui-xs text-muted-foreground">Up to date</span>
        ) : null}
      </div>
      {rebase.isError ? (
        <button
          type="button"
          className="flex items-center gap-1 text-ui-xs text-destructive"
          onClick={() => void rebase.refetch()}
        >
          <RefreshCwIcon className="size-[1.273em]" /> Git operation status unavailable · Retry
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
                  rebase: {
                    action: "continue",
                    operation: rebase.data?.kind ?? "rebase",
                  },
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
                  rebase: {
                    action: "abort",
                    operation: rebase.data?.kind ?? "rebase",
                  },
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
          canGenerate={!disabled && !rebasing && hasChanges && !files.isError}
          committing={
            checkingCommit || (mutation.isPending && mutation.variables?.action === "commit")
          }
          onChange={(next) => {
            setDraft(cwd, next);
          }}
          onGenerated={(generated, scope) => {
            if ((useCommitDrafts.getState().messages[cwd] ?? "") === message) {
              setSuggestion(cwd, generated, scope);
            }
          }}
          onCommit={() => {
            void commit(false);
          }}
          onCommitAndPush={() => {
            void commit(true);
          }}
        />
      )}
      {publishFlow.dialog}
    </div>
  );
}

function resolveSourceControlSync(status: GitStatusResult | undefined): {
  kind: "pull" | "push" | "publish";
  label: string;
  description: string;
  ahead: number;
  behind: number;
} | null {
  if (!status || status.branch === null) return null;
  const ahead = status.aheadCount;
  const behind = status.behindCount;
  if (!status.hasUpstream) {
    return {
      kind: "publish",
      label: "Publish branch",
      description: "Push this branch and track it on the remote.",
      ahead: 0,
      behind: 0,
    };
  }
  const upstream = status.upstreamBranch ?? "upstream";
  if (ahead > 0 && behind > 0) {
    return {
      kind: "push",
      label: "Sync",
      description: `Rebase ${ahead} local commits onto ${upstream}, then push.`,
      ahead,
      behind,
    };
  }
  if (behind > 0) {
    return {
      kind: "pull",
      label: "Pull",
      description: `Fast-forward from ${upstream}.`,
      ahead,
      behind,
    };
  }
  if (ahead > 0) {
    return { kind: "push", label: "Push", description: `Push to ${upstream}.`, ahead, behind };
  }
  return null;
}
