import type { PullRequestDetailInput } from "@glade/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export const pullRequestQueryKeys = {
  all: ["pull-requests"] as const,
  detail: (input: PullRequestDetailInput | null) =>
    [
      "pull-requests",
      "detail",
      input?.projectId ?? null,
      input?.repository ?? null,
      input?.number ?? null,
    ] as const,
  diff: (input: PullRequestDetailInput | null) =>
    [
      "pull-requests",
      "diff",
      input?.projectId ?? null,
      input?.repository ?? null,
      input?.number ?? null,
    ] as const,
};

/** Distinguish a cold-load failure from a background failure with usable cached data. */
export function pullRequestQueryErrorState<TData, TError>(
  query: { data: TData | undefined; error: TError | null; isError: boolean },
  enabled = true,
): { initialError: TError | null; backgroundError: TError | null } {
  if (!enabled || !query.isError) return { initialError: null, backgroundError: null };
  return query.data === undefined
    ? { initialError: query.error, backgroundError: null }
    : { initialError: null, backgroundError: query.error };
}

export function pullRequestDetailQueryOptions(
  input: PullRequestDetailInput | null,
  behavior: { pollingEnabled?: boolean } = {},
) {
  const pollingEnabled = behavior.pollingEnabled ?? true;
  return queryOptions({
    queryKey: pullRequestQueryKeys.detail(input),
    queryFn: () => {
      if (!input) throw new Error("Pull request detail is unavailable.");
      return ensureNativeApi().pullRequests.detail(input);
    },
    enabled: input !== null,
    staleTime: 30_000,
    refetchInterval: pollingEnabled ? 60_000 : false,
    refetchOnWindowFocus: pollingEnabled,
    refetchOnReconnect: pollingEnabled,
  });
}

export function pullRequestDiffQueryOptions(input: PullRequestDetailInput | null) {
  return queryOptions({
    queryKey: pullRequestQueryKeys.diff(input),
    queryFn: () => {
      if (!input) throw new Error("Pull request diff is unavailable.");
      return ensureNativeApi().pullRequests.diff(input);
    },
    enabled: input !== null,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}
