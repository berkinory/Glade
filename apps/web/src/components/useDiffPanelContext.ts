import { useParams } from "@tanstack/react-router";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useMemo } from "react";
import { useDiffRouteSearch } from "../hooks/useDiffRouteSearch";
import { resolveDiffEnvironmentState } from "../lib/threadEnvironment";
import { useRepoDiffScope } from "../repoDiffScopeStore";
import { useStore } from "../store";
import { createProjectSelector } from "../storeSelectors";
import { useComposerDraftStore } from "../composerDraftStore";
import type { SplitViewPanePanelState } from "../splitViewModel";
import { resolveDraftFallbackModelSelection } from "./ChatView.logic.worktree";
import {
  resolveDiffPanelQueriesEnabled,
  resolveDiffPanelScopeCountQueriesEnabled,
  resolveDiffPanelThread,
} from "./DiffPanel.logic";
import {
  createDiffPanelRepoLiveRefreshSelector,
  createDiffPanelThreadCatalogSelector,
  toDiffPanelThreadCatalog,
  type DiffPanelThreadCatalog,
} from "./diffPanelSelectors";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";

export function useDiffPanelContext(input: {
  controlledThreadId: ThreadId | null | undefined;
  panelState: Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath"> | undefined;
  queriesEnabled: boolean;
  scopePickerOpen: boolean;
  settingsDefaultProvider: ProviderKind;
}) {
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const diffSearch = useDiffRouteSearch();
  const diffOpen = input.panelState ? input.panelState.panel === "diff" : diffSearch.diff === "1";
  const diffQueriesEnabled = useMemo(
    () =>
      resolveDiffPanelQueriesEnabled({
        diffOpen,
        queriesEnabled: input.queriesEnabled,
      }),
    [diffOpen, input.queriesEnabled],
  );
  const scopeCountQueriesEnabled = useMemo(
    () =>
      resolveDiffPanelScopeCountQueriesEnabled({
        queriesEnabled: diffQueriesEnabled,
        scopePickerOpen: input.scopePickerOpen,
      }),
    [diffQueriesEnabled, input.scopePickerOpen],
  );
  const activeThreadId = input.controlledThreadId ?? routeThreadId;
  const serverThreadCatalog = useStore(
    useMemo(() => createDiffPanelThreadCatalogSelector(activeThreadId), [activeThreadId]),
  );
  const shouldPollRepoDiff = useStore(
    useMemo(() => createDiffPanelRepoLiveRefreshSelector(activeThreadId), [activeThreadId]),
  );
  const draftThread = useComposerDraftStore((store) =>
    activeThreadId ? (store.draftThreadsByThreadId[activeThreadId] ?? null) : null,
  );
  const fallbackDraftProjectId = draftThread?.projectId ?? null;
  const fallbackDraftProject = useStore(
    useMemo(() => createProjectSelector(fallbackDraftProjectId), [fallbackDraftProjectId]),
  );

  const activeThreadContext = useMemo((): DiffPanelThreadCatalog | undefined => {
    if (serverThreadCatalog) {
      return serverThreadCatalog;
    }
    const draftBackedThread = resolveDiffPanelThread({
      threadId: activeThreadId,
      serverThread: undefined,
      draftThread,
      fallbackModelSelection: resolveDraftFallbackModelSelection({
        projectDefault: fallbackDraftProject?.defaultModelSelection,
        settingsDefaultProvider: input.settingsDefaultProvider,
      }),
    });
    return draftBackedThread ? toDiffPanelThreadCatalog(draftBackedThread) : undefined;
  }, [
    activeThreadId,
    draftThread,
    fallbackDraftProject?.defaultModelSelection,
    serverThreadCatalog,
    input.settingsDefaultProvider,
  ]);
  const activeProjectId = activeThreadContext?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = useStore(
    useMemo(() => createProjectSelector(activeProjectId), [activeProjectId]),
  );
  const resolvedThreadEnvMode =
    serverThreadCatalog?.envMode ?? draftThread?.envMode ?? activeThreadContext?.envMode;
  const resolvedThreadWorktreePath =
    serverThreadCatalog?.worktreePath ??
    draftThread?.worktreePath ??
    activeThreadContext?.worktreePath ??
    null;
  const diffEnvironmentState = resolveDiffEnvironmentState({
    projectCwd: activeProject?.cwd ?? null,
    envMode: resolvedThreadEnvMode,
    worktreePath: resolvedThreadWorktreePath,
  });
  const diffEnvironmentPending = diffEnvironmentState.pending;
  const activeCwd = diffEnvironmentState.cwd;
  const { scope: repoDiffScope, compareRef: repoDiffCompareRef } = useRepoDiffScope(
    activeCwd ?? null,
  );
  const selectedTurnId = input.panelState
    ? (input.panelState.diffTurnId ?? null)
    : (diffSearch.diffTurnId ?? null);
  return {
    diffSearch,
    diffOpen,
    diffQueriesEnabled,
    scopeCountQueriesEnabled,
    activeThreadId,
    serverThreadCatalog,
    shouldPollRepoDiff,
    draftThread,
    activeThreadContext,
    activeProject,
    diffEnvironmentPending,
    activeCwd,
    repoDiffScope,
    repoDiffCompareRef,
    selectedTurnId,
  };
}
