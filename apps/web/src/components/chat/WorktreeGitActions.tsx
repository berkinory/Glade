import { EXPENSIVE_READ_RETRY_OPTIONS } from "~/lib/expensiveReadRetry";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useStore } from "~/store";
import { createThreadSelector } from "~/storeSelectors";
import { ensureNativeApi } from "~/nativeApi";
import { getProviderStartOptions, useAppSettings } from "~/appSettings";
import { invalidateProjectFileQueriesForCwds } from "~/lib/projectReactQuery";
import { hasUnsavedWorkspaceEditors } from "~/lib/workspaceEditorSession";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Spinner } from "../ui/spinner";
import {
  assertCommitScope,
  assertStagedChanges,
  readCommitScope,
} from "./sourceControlCommitScope";

export function WorktreeGitActions({
  threadId,
  summaryOnly = false,
  visible = true,
}: {
  threadId: ThreadId;
  summaryOnly?: boolean;
  visible?: boolean;
}) {
  const thread = useStore(useMemo(() => createThreadSelector(threadId), [threadId]));
  const cwd = thread?.worktreePath;
  const client = useQueryClient();
  const { settings } = useAppSettings();
  const status = useQuery({
    ...EXPENSIVE_READ_RETRY_OPTIONS,
    queryKey: ["git", "local-worktree", cwd, threadId],
    queryFn: () => ensureNativeApi().git.localWorktree({ threadId }),
    enabled: Boolean(cwd) && visible,
    staleTime: 5_000,
    refetchInterval: summaryOnly ? false : 15_000,
  });
  const mutation = useMutation({
    mutationKey: ["git", "local-worktree-action", cwd],
    mutationFn: async (action: "update" | "merge" | "commit_merge") => {
      const api = ensureNativeApi();
      if (hasUnsavedWorkspaceEditors(client))
        throw new Error("Save your open files before updating either checkout.");
      const state = await api.git.localWorktree({ threadId });
      if (state.blockedReason) throw new Error(state.blockedReason);
      if (!state.targetBranch || (status.data && state.targetBranch !== status.data.targetBranch))
        throw new Error("The destination branch changed. Review the local target and retry.");
      if (action !== "commit_merge" || state.clean)
        return api.git.localWorktreeAction({
          threadId,
          targetBranch: state.targetBranch,
          action: action === "update" ? "update" : "merge",
        });
      const scope = await readCommitScope(state.cwd);
      if (scope.staged && scope.hasUnstagedChanges)
        throw new Error(
          "Some changes are unstaged. Commit your selection manually, or stage all changes before merging.",
        );
      const generated = await api.git.generateCommitMessage({
        cwd: state.cwd,
        ...(settings.textGenerationModel
          ? {
              textGenerationModel: settings.textGenerationModel,
              textGenerationModelSelection: {
                provider: settings.textGenerationProvider ?? "codex",
                model: settings.textGenerationModel,
              },
            }
          : {}),
        ...(settings.codexHomePath ? { codexHomePath: settings.codexHomePath } : {}),
        providerOptions: getProviderStartOptions(settings),
      });
      assertCommitScope(scope, await readCommitScope(state.cwd));
      if (hasUnsavedWorkspaceEditors(client))
        throw new Error("Save your open files before committing.");
      if (!generated.snapshot || !generated.scope)
        throw new Error(
          "Could not verify the generated commit scope. Use the manual commit controls.",
        );
      if (!scope.staged) {
        const staged = await api.git.stageFiles({ cwd: state.cwd, paths: scope.paths });
        if (!staged.ok) throw new Error("Could not stage changes.");
        assertStagedChanges(scope, await readCommitScope(state.cwd));
      }
      return api.git.localWorktreeAction({
        threadId,
        action: "merge",
        targetBranch: state.targetBranch,
        commit: {
          message: generated.message,
          snapshot: generated.snapshot,
          scope: generated.scope,
        },
      });
    },
    onSuccess: (state, action) =>
      toastManager.add({
        type: "success",
        title:
          action === "update"
            ? `Updated from ${state.targetBranch}`
            : `Merged into ${state.targetBranch}`,
        description: "Local only. Continue in this worktree.",
      }),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Local Git operation stopped",
        description: `${error.message}\nIf there is a conflict, resolve it in Source Control, then retry Merge.`,
      }),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ["git"] });
      if (status.data)
        await invalidateProjectFileQueriesForCwds(client, [status.data.cwd, status.data.targetCwd]);
    },
  });
  if (!cwd) return null;
  const state = status.data;
  if (summaryOnly)
    return state ? (
      <span
        className="truncate text-ui-xs text-muted-foreground"
        title={`Worktree: ${state.cwd}\nLocal target: ${state.targetCwd}`}
      >
        → {state.targetBranch ?? "detached"} · {state.ahead} outgoing · {state.behind} incoming
      </span>
    ) : null;
  const disabled =
    mutation.isPending || status.isPending || status.isError || Boolean(state?.blockedReason);
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-2 py-1.5">
      <div className="text-ui-sm" title={state ? `${state.cwd}\nTarget: ${state.targetCwd}` : cwd}>
        Worktree <span className="font-medium">{state?.branch ?? "…"}</span>
        {state ? <span> → {state.targetBranch ?? "detached"}</span> : null}
      </div>
      <p className="text-ui-xs text-muted-foreground">
        {state
          ? `${state.ahead} outgoing · ${state.behind} incoming · local checkout`
          : "Reading local checkout…"}
      </p>
      {state?.blockedReason || status.error ? (
        <p className="text-ui-xs text-muted-foreground">
          {state?.blockedReason ?? status.error?.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !state?.clean || !state?.behind}
          onClick={() => mutation.mutate("update")}
        >
          Update from {state?.targetBranch ?? "checkout"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !state?.clean || !state?.ahead}
          onClick={() => mutation.mutate("merge")}
        >
          Merge into {state?.targetBranch ?? "checkout"}
        </Button>
      </div>
      <Button
        size="sm"
        disabled={disabled || (state?.clean && !state.ahead)}
        onClick={() => mutation.mutate("commit_merge")}
      >
        {mutation.isPending ? <Spinner variant="action" /> : null}
        AI commit & merge into {state?.targetBranch ?? "checkout"}
      </Button>
      <p className="text-ui-xs text-muted-foreground">
        No push or PR. This chat keeps its worktree.
      </p>
    </div>
  );
}
