import type {
  PullRequestActionInput,
  PullRequestCommentInput,
  PullRequestState,
} from "@glade/contracts";
import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";
import {
  optimisticallyPatchPullRequestGitCaches,
  pullRequestGitQueryFilters,
  rollbackPullRequestGitCaches,
  type GitPullRequestActionRollback,
} from "./pullRequestGitCache";
import {
  beginPullRequestActionProtection,
  finishPullRequestActionProtection,
  type PullRequestActionPatch,
} from "./pullRequestMutationCoordinator";
import { pullRequestQueryKeys } from "./pullRequestQueryOptions";

const pullRequestMutationKeys = {
  action: ["pull-requests", "action"] as const,
  comment: ["pull-requests", "comment"] as const,
};

type DetailFields = { state?: PullRequestState; isDraft?: boolean; closedAt?: string | null };

type ActionMutationContext = {
  previousDetailFields: DetailFields | null;
  optimisticPatch: PullRequestActionPatch;
  gitRollback: GitPullRequestActionRollback[];
  protection: ReturnType<typeof beginPullRequestActionProtection>;
};

function optimisticActionPatch(action: PullRequestActionInput["action"]): DetailFields {
  switch (action) {
    case "ready":
      return { isDraft: false };
    case "draft":
      return { isDraft: true };
    case "close":
      return { state: "closed", closedAt: new Date().toISOString() };
    case "reopen":
      return { state: "open", closedAt: null };
    case "merge":
      return {};
  }
}

function invalidateActionDetails(queryClient: QueryClient, input: PullRequestActionInput) {
  if (input.action !== "merge") {
    return queryClient.invalidateQueries({
      queryKey: pullRequestQueryKeys.detail(input),
      exact: true,
    });
  }
  // A stack merge can change several PRs in the same repository.
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return key[0] === "pull-requests" && key[1] === "detail" && key[3] === input.repository;
    },
  });
}

export function pullRequestActionMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: pullRequestMutationKeys.action,
    networkMode: "always",
    mutationFn: (input: PullRequestActionInput) => ensureNativeApi().pullRequests.action(input),
    onMutate: async (input): Promise<ActionMutationContext> => {
      const detailPatch = optimisticActionPatch(input.action);
      const optimisticPatch: PullRequestActionPatch = {
        ...(detailPatch.state !== undefined ? { state: detailPatch.state } : {}),
        ...(detailPatch.isDraft !== undefined ? { isDraft: detailPatch.isDraft } : {}),
      };
      const protection = beginPullRequestActionProtection(queryClient, input, optimisticPatch);
      try {
        const detailKey = pullRequestQueryKeys.detail(input);
        await Promise.all([
          queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
          queryClient.cancelQueries(pullRequestGitQueryFilters(input)),
        ]);
        const previousDetail = queryClient.getQueryData<DetailFields>(detailKey);
        const previousDetailFields = previousDetail
          ? {
              ...(detailPatch.state !== undefined ? { state: previousDetail.state } : {}),
              ...(detailPatch.isDraft !== undefined ? { isDraft: previousDetail.isDraft } : {}),
              ...(detailPatch.closedAt !== undefined ? { closedAt: previousDetail.closedAt } : {}),
            }
          : null;
        if (previousDetail && Object.keys(detailPatch).length > 0) {
          queryClient.setQueryData(detailKey, { ...previousDetail, ...detailPatch });
        }
        return {
          previousDetailFields,
          optimisticPatch,
          gitRollback: optimisticallyPatchPullRequestGitCaches(queryClient, input, optimisticPatch),
          protection,
        };
      } catch (error) {
        finishPullRequestActionProtection(queryClient, protection, "failed");
        throw error;
      }
    },
    onError: async (_error, input, context) => {
      if (context) {
        finishPullRequestActionProtection(queryClient, context.protection, "failed");
        if (context.previousDetailFields) {
          queryClient.setQueryData<DetailFields>(pullRequestQueryKeys.detail(input), (current) =>
            current ? { ...current, ...context.previousDetailFields } : current,
          );
        }
        rollbackPullRequestGitCaches({
          queryClient,
          identity: input,
          optimisticPatch: context.optimisticPatch,
          rollback: context.gitRollback,
        });
      }
      // The command may have reached GitHub even when its response failed.
      await Promise.allSettled([
        invalidateActionDetails(queryClient, input),
        queryClient.invalidateQueries(pullRequestGitQueryFilters(input)),
      ]);
    },
    onSuccess: async (result, input) => {
      // Follow-up reads cannot turn an accepted GitHub action into a failed mutation.
      await Promise.allSettled([
        invalidateActionDetails(queryClient, input),
        queryClient.invalidateQueries(pullRequestGitQueryFilters(input, result.workspaceRoot)),
      ]);
    },
    onSettled: (_result, error, _input, context) => {
      if (context) {
        finishPullRequestActionProtection(
          queryClient,
          context.protection,
          error ? "failed" : "succeeded",
        );
      }
    },
  });
}

export function pullRequestCommentMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: pullRequestMutationKeys.comment,
    networkMode: "always",
    mutationFn: (input: PullRequestCommentInput) => ensureNativeApi().pullRequests.comment(input),
    onSettled: async (_result, _error, input) => {
      await queryClient.invalidateQueries({
        queryKey: pullRequestQueryKeys.detail(input),
        exact: true,
      });
    },
  });
}
