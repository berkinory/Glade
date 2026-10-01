import type {
  GitHandoffThreadInput,
  GitRemoveWorktreeInput,
  GitStackedAction,
} from "@glade/contracts/git/git";
import type { ModelSelection, ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";
import type { NativeApi } from "@glade/contracts/ipc/ipc";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { hasUnsavedWorkspaceEditors } from "./workspaceEditorSession";
import { ensureNativeApi } from "../nativeApi";
import { invalidateProjectFileQueriesForCwds } from "./projectReactQuery";
import {
  gitMutationKeys,
  gitQueryKeys,
  invalidateGitQueries,
  invalidateGitQueriesForCwds,
} from "./gitQueryOptions";

type GitMutationInvalidation = "all" | "cwd" | "source-control";
type GitMutationInvalidateOn = "success" | "settled";

function makeGitMutationOptions<TArgs, TResult>(config: {
  cwd: string | null;
  queryClient: QueryClient;
  mutationKey: readonly unknown[];
  unavailableMessage: string;
  run: (api: NativeApi, cwd: string, args: TArgs) => Promise<TResult>;
  invalidate?: GitMutationInvalidation;
  invalidateOn?: GitMutationInvalidateOn;
  awaitInvalidation?: boolean;
}) {
  const invalidate = config.invalidate ?? "all";
  const invalidateOn = config.invalidateOn ?? "settled";
  const runInvalidation = async () => {
    if (invalidate === "source-control") {
      if (config.cwd) {
        const cwd = config.cwd;
        await config.queryClient
          .invalidateQueries({ queryKey: gitQueryKeys.sourceControlFiles(cwd), exact: true })
          .catch(() => undefined);
        void invalidateGitQueriesForCwds(config.queryClient, [cwd]).catch(() => undefined);
      }
      return;
    }
    if (invalidate === "cwd") {
      if (config.cwd) {
        await invalidateGitQueriesForCwds(config.queryClient, [config.cwd]);
      }
      return;
    }
    await invalidateGitQueries(config.queryClient);
  };
  const handleInvalidation =
    config.awaitInvalidation === false
      ? () => {
          void runInvalidation().catch(() => undefined);
        }
      : runInvalidation;

  return mutationOptions({
    mutationKey: config.mutationKey,
    mutationFn: async (args: TArgs) => {
      const api = ensureNativeApi();
      if (!config.cwd) throw new Error(config.unavailableMessage);
      return config.run(api, config.cwd, args);
    },
    ...(invalidateOn === "success"
      ? { onSuccess: handleInvalidation }
      : { onSettled: handleInvalidation }),
  });
}

export function gitInitMutationOptions(input: { cwd: string | null; queryClient: QueryClient }) {
  return makeGitMutationOptions<void, void>({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.init(input.cwd),
    unavailableMessage: "Git init is unavailable.",
    invalidateOn: "success",
    run: (api, cwd) => api.git.init({ cwd }),
  });
}

export function gitStageFilesMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<readonly string[], { ok: boolean }>({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.stageFiles(input.cwd),
    unavailableMessage: "Staging is unavailable.",
    invalidate: "source-control",
    invalidateOn: "success",
    run: (api, cwd, paths) => {
      if (paths.length === 0) throw new Error("No files selected to stage.");
      return api.git.stageFiles({ cwd, paths: [...paths] });
    },
  });
}

export function gitRevertUnstagedFileMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<string, { ok: boolean }>({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.revertUnstagedFile(input.cwd),
    unavailableMessage: "Reverting is unavailable.",
    invalidate: "cwd",
    run: (api, cwd, path) => api.git.revertUnstagedFile({ cwd, path }),
  });
}

export function gitUnstageFilesMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<readonly string[], { ok: boolean }>({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.unstageFiles(input.cwd),
    unavailableMessage: "Unstaging is unavailable.",
    invalidate: "source-control",
    invalidateOn: "success",
    run: (api, cwd, paths) => {
      if (paths.length === 0) throw new Error("No files selected to unstage.");
      return api.git.unstageFiles({ cwd, paths: [...paths] });
    },
  });
}

export function gitRunStackedActionMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  model?: string | null;
  modelSelection?: ModelSelection | null;
  codexHomePath?: string | null;
  providerOptions?: ProviderStartOptions | null;
}) {
  return makeGitMutationOptions<
    {
      actionId: string;
      action: GitStackedAction;
      commitMessage?: string;
      featureBranch?: boolean;
      filePaths?: string[];
      prTitle?: string;
      prBody?: string;
      prDraft?: boolean;
      allowDirtyWorkingTree?: boolean;
    },
    Awaited<ReturnType<NativeApi["git"]["runStackedAction"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.runStackedAction(input.cwd),
    unavailableMessage: "Git action is unavailable.",
    invalidate: "cwd",
    awaitInvalidation: false,
    run: (
      api,
      cwd,
      {
        actionId,
        action,
        commitMessage,
        featureBranch,
        filePaths,
        prTitle,
        prBody,
        prDraft,
        allowDirtyWorkingTree,
      },
    ) =>
      api.git.runStackedAction({
        actionId,
        allowIntegration: !hasUnsavedWorkspaceEditors(input.queryClient, cwd),
        cwd,
        action,
        ...(commitMessage ? { commitMessage } : {}),
        ...(featureBranch ? { featureBranch } : {}),
        ...(filePaths ? { filePaths } : {}),
        ...(prTitle ? { prTitle } : {}),
        ...(prBody ? { prBody } : {}),
        ...(prDraft !== undefined ? { prDraft } : {}),
        ...(allowDirtyWorkingTree ? { allowDirtyWorkingTree } : {}),
        ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
        ...(input.model ? { textGenerationModel: input.model } : {}),
        ...(input.modelSelection ? { textGenerationModelSelection: input.modelSelection } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      }),
  });
}

export function gitPullMutationOptions(input: { cwd: string | null; queryClient: QueryClient }) {
  return makeGitMutationOptions<void, Awaited<ReturnType<NativeApi["git"]["pull"]>>>({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.pull(input.cwd),
    unavailableMessage: "Git pull is unavailable.",
    invalidate: "cwd",
    awaitInvalidation: false,
    run: (api, cwd) => api.git.pull({ cwd }),
  });
}

export function gitCreateDetachedWorktreeMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async ({
      cwd,
      ref,
      path,
      copyChangesFrom,
      newBranch,
      progressId,
    }: {
      cwd: string;
      ref: string;
      path?: string | null;
      copyChangesFrom?: string;
      newBranch?: string;
      progressId?: string;
    }) => {
      const api = ensureNativeApi();
      if (!cwd) throw new Error("Git worktree creation is unavailable.");
      return api.git.createDetachedWorktree({
        cwd,
        ref,
        path: path ?? null,
        ...(copyChangesFrom ? { copyChangesFrom } : {}),
        ...(newBranch ? { newBranch } : {}),
        ...(progressId ? { progressId } : {}),
      });
    },
    mutationKey: ["git", "mutation", "create-detached-worktree"] as const,
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitRemoveWorktreeMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async ({
      cwd,
      path,
      force,
      archiveCleanup,
      reclaimTemporaryBranch = true,
    }: GitRemoveWorktreeInput) => {
      const api = ensureNativeApi();
      if (!cwd) throw new Error("Git worktree removal is unavailable.");

      return api.git.removeWorktree({ cwd, path, force, reclaimTemporaryBranch, archiveCleanup });
    },
    mutationKey: ["git", "mutation", "remove-worktree"] as const,
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitPreparePullRequestThreadMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    { reference: string; mode: "local" | "worktree" },
    Awaited<ReturnType<NativeApi["git"]["preparePullRequestThread"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.preparePullRequestThread(input.cwd),
    unavailableMessage: "Pull request thread preparation is unavailable.",
    run: (api, cwd, { reference, mode }) =>
      api.git.preparePullRequestThread({ cwd, reference, mode }),
  });
}

export function gitHandoffThreadMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<
    Omit<GitHandoffThreadInput, "cwd">,
    Awaited<ReturnType<NativeApi["git"]["handoffThread"]>>
  >({
    cwd: input.cwd,
    queryClient: input.queryClient,
    mutationKey: gitMutationKeys.handoffThread(input.cwd),
    unavailableMessage: "Git handoff is unavailable.",
    run: (api, cwd, request) => api.git.handoffThread({ cwd, ...request }),
  });
}

export type SourceControlAction =
  | { action: "commit"; message: string }
  | { action: "fetch" | "pull" | "push" }
  | { action: "ignore"; paths: string[] }
  | {
      action: "rebase";
      rebase:
        | { action: "start"; target: string }
        | {
            action: "continue" | "abort";
            operation?: "rebase" | "merge" | "cherry-pick" | "revert" | "sequencer";
          };
    };

export function gitRebaseStateQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: ["git", "rebase-state", cwd],
    enabled: cwd !== null,
    queryFn: () => ensureNativeApi().git.rebaseState({ cwd: cwd! }),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function gitSourceControlActionMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return makeGitMutationOptions<SourceControlAction, void>({
    ...input,
    mutationKey: ["git", "mutation", "source-control", input.cwd],
    unavailableMessage: "Source control is unavailable.",
    invalidate: "source-control",
    run: async (api, cwd, request) => {
      try {
        switch (request.action) {
          case "commit":
            await api.git.commitStaged({ cwd, message: request.message });
            break;
          case "fetch":
            await api.git.fetch({ cwd });
            break;
          case "pull":
            await api.git.pull({ cwd });
            break;
          case "push":
            await api.git.runStackedAction({
              cwd,
              action: "push",
              actionId: crypto.randomUUID(),
              allowDirtyWorkingTree: true,
              allowIntegration: !hasUnsavedWorkspaceEditors(input.queryClient, cwd),
            });
            break;
          case "ignore":
            await api.git.ignorePaths({ cwd, paths: request.paths });
            break;
          case "rebase": {
            const rebase = request.rebase;
            if (rebase.action === "start") {
              if (!rebase.target) throw new Error("Select a branch to rebase onto.");
              await api.git.rebase({ cwd, action: "start", target: rebase.target });
            } else await api.git.rebase({ cwd, ...rebase });
            break;
          }
        }
      } finally {
        if (
          request.action === "ignore" ||
          request.action === "pull" ||
          request.action === "rebase"
        ) {
          void invalidateProjectFileQueriesForCwds(input.queryClient, [cwd]);
        }
        void input.queryClient.invalidateQueries({
          queryKey: ["git", "rebase-state", cwd],
        });
      }
    },
  });
}
