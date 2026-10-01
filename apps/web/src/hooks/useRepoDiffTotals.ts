import { useQuery } from "@tanstack/react-query";

import { gitWorkingTreeDiffStatsQueryOptions } from "../lib/gitQueryOptions";

export interface RepoDiffTotals {
  additions: number;
  deletions: number;

  fileCount: number;

  hasChanges: boolean;
}

export function useRepoDiffTotals({
  gitCwd,
  isGitRepo,
  refetchInterval: refetchIntervalProp,
}: {
  gitCwd: string | null;
  isGitRepo: boolean;
  refetchInterval?: number | false;
}): RepoDiffTotals {
  const refetchInterval = refetchIntervalProp ?? false;

  const { data: totals } = useQuery(
    gitWorkingTreeDiffStatsQueryOptions({
      cwd: gitCwd,
      scope: "workingTree",
      enabled: isGitRepo,
      refetchInterval,
    }),
  );
  const additions = totals?.additions ?? 0;
  const deletions = totals?.deletions ?? 0;
  const fileCount = totals?.fileCount ?? 0;
  return { additions, deletions, fileCount, hasChanges: additions > 0 || deletions > 0 };
}
