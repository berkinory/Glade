import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useProjectFileChangeSubscription } from "../hooks/useProjectFileChangeSubscription";
import { refreshGitAfterFileWrite } from "../lib/gitReactQuery";
import { resolveWatchedDiffFilePath, type DiffViewKind } from "./DiffPanel.logic";

export function useWatchedDiffFileRefresh(input: {
  diffViewKind: DiffViewKind;
  selectedFilePath: string | null;
  renderableFiles: Parameters<typeof resolveWatchedDiffFilePath>[1];
  activeCwd: string | null;
  queryClient: QueryClient;
  diffQueriesEnabled: boolean;
  liveRefreshEnabled: boolean;
}): void {
  const watchedRepoFilePath =
    input.diffViewKind === "repo"
      ? resolveWatchedDiffFilePath(input.selectedFilePath, input.renderableFiles)
      : null;
  const handleWatchedRepoFileChange = useCallback(() => {
    if (!input.activeCwd) {
      return;
    }
    void refreshGitAfterFileWrite(input.queryClient, input.activeCwd);
  }, [input.activeCwd, input.queryClient]);
  useProjectFileChangeSubscription({
    cwd: input.activeCwd,
    relativePath: watchedRepoFilePath,
    enabled: input.diffQueriesEnabled && input.liveRefreshEnabled && watchedRepoFilePath !== null,
    onChange: handleWatchedRepoFileChange,
  });
}
