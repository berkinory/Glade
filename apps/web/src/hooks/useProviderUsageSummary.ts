import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type {
  ServerCodexResetCredits,
  ServerGetProviderUsageSnapshotResult,
  ServerProviderUsageLine,
} from "@glade/contracts/server/server";
import { useQuery } from "@tanstack/react-query";

import {
  isProviderUsageSnapshotNonOk,
  normalizeServerProviderUsageLines,
  normalizeServerProviderUsageRateLimit,
} from "~/lib/providerUsageSnapshot";
import {
  deriveProviderUsageLearnMoreHref,
  deriveRateLimitLearnMoreHref,
  deriveAccountRateLimits,
  mergeProviderRateLimits,
  type ProviderRateLimit,
} from "~/lib/rateLimits";
import {
  serverAllProviderUsageQueryOptions,
  serverProviderUsageSnapshotQueryOptions,
} from "~/lib/serverReactQuery";

export interface ProviderUsageSummaryData {
  readonly learnMoreHref: string | null;
  readonly rateLimits: ReadonlyArray<ProviderRateLimit>;
  readonly usageLines: ReadonlyArray<ServerProviderUsageLine>;
  readonly usageNotice: string | undefined;
  readonly resetCredits?: ServerCodexResetCredits | undefined;
}

function resolveProviderUsageSummary(input: {
  provider: ProviderKind | null;
  accountRateLimits: ReadonlyArray<ProviderRateLimit>;
  authoritativeLiveSnapshot: ServerGetProviderUsageSnapshotResult;
  localUsageSnapshot?: ServerGetProviderUsageSnapshotResult | undefined;
}): ProviderUsageSummaryData {
  const blocksFallback = isProviderUsageSnapshotNonOk(input.authoritativeLiveSnapshot);
  if (blocksFallback) {
    return {
      learnMoreHref: deriveProviderUsageLearnMoreHref(input.provider),
      rateLimits: [],
      usageLines: [],
      usageNotice: undefined,
      resetCredits: undefined,
    };
  }

  const derivedRateLimits = input.accountRateLimits.filter((rateLimit) =>
    input.provider ? rateLimit.provider === input.provider : true,
  );
  const liveUsageRateLimit = normalizeServerProviderUsageRateLimit(input.authoritativeLiveSnapshot);
  const localUsageRateLimit = normalizeServerProviderUsageRateLimit(input.localUsageSnapshot);
  const rateLimits = mergeProviderRateLimits(
    derivedRateLimits,
    mergeProviderRateLimits(
      liveUsageRateLimit ? [liveUsageRateLimit] : [],
      localUsageRateLimit ? [localUsageRateLimit] : [],
    ),
  );

  const liveUsageLines = normalizeServerProviderUsageLines(input.authoritativeLiveSnapshot);
  const localUsageLines = normalizeServerProviderUsageLines(input.localUsageSnapshot);
  const usageLines = liveUsageLines.length > 0 ? liveUsageLines : localUsageLines;
  const detail = input.authoritativeLiveSnapshot?.detail?.trim();

  return {
    learnMoreHref:
      deriveRateLimitLearnMoreHref(rateLimits) ?? deriveProviderUsageLearnMoreHref(input.provider),
    rateLimits,
    usageLines,
    usageNotice: detail ? detail : undefined,
    resetCredits:
      input.authoritativeLiveSnapshot?.provider === "codex"
        ? input.authoritativeLiveSnapshot.resetCredits
        : undefined,
  };
}

export function useProviderUsageSummary(input: {
  provider: ProviderKind | null | undefined;
  threads?: ReadonlyArray<Pick<OrchestrationThread, "activities">>;
  threadRateLimits?: ReadonlyArray<ProviderRateLimit> | undefined;
  codexHomePath?: string | null;
  providerSnapshot?: ServerGetProviderUsageSnapshotResult | undefined;
}) {
  const provider = input.provider ?? null;
  const shouldFetchLiveProviderUsage = provider !== null && input.providerSnapshot === undefined;
  const shouldFetchLocalProviderUsage = shouldFetchLiveProviderUsage;
  const allProviderUsageQuery = useQuery(
    serverAllProviderUsageQueryOptions({
      enabled: shouldFetchLiveProviderUsage,
    }),
  );
  const localUsageSnapshotQuery = useQuery(
    serverProviderUsageSnapshotQueryOptions({
      provider,
      homePath: provider === "codex" ? input.codexHomePath || null : null,
      enabled: shouldFetchLocalProviderUsage,
    }),
  );
  const liveProviderSnapshot = (allProviderUsageQuery.data ?? []).find(
    (snapshot) => snapshot.provider === provider,
  );
  const authoritativeLiveSnapshot = liveProviderSnapshot ?? input.providerSnapshot ?? null;
  const accountRateLimits = input.threadRateLimits ?? deriveAccountRateLimits(input.threads ?? []);
  const summary = resolveProviderUsageSummary({
    provider,
    accountRateLimits,
    authoritativeLiveSnapshot,
    localUsageSnapshot: localUsageSnapshotQuery.data ?? null,
  });

  const isLoading =
    shouldFetchLiveProviderUsage &&
    allProviderUsageQuery.isPending &&
    localUsageSnapshotQuery.isPending &&
    summary.rateLimits.length === 0 &&
    summary.usageLines.length === 0;

  return {
    isLoading,
    ...summary,
  } as const;
}
