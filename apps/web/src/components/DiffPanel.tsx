import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ThreadId, type ResolvedKeybindingsConfig, type TurnId } from "@glade/contracts";
import * as Schema from "effect/Schema";
import { XIcon } from "~/lib/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  gitBranchesQueryOptions,
  refreshGitAfterFileWrite,
  gitStatusQueryOptions,
  gitWorkingTreeDiffQueryOptions,
  gitWorkingTreeDiffStatsQueryOptions,
} from "~/lib/gitReactQuery";
import {
  checkpointDiffQueryOptions,
  resolveCheckpointDiffQueryDisplayState,
} from "~/lib/providerReactQuery";
import { stripDiffSearchParams } from "../diffRouteSearch";
import { useTheme } from "../hooks/useTheme";
import { useDiffRouteSearch } from "../hooks/useDiffRouteSearch";
import { useDiffChangeNavigationShortcuts } from "../hooks/useDiffChangeNavigationShortcuts";
import { useVisibleDiffFilePath } from "../hooks/useVisibleDiffFilePath";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { shortcutLabelForCommand } from "../keybindings";
import { useLocalStorage } from "../hooks/useLocalStorage";
import {
  buildFileDiffRenderKey,
  getRenderablePatch,
  resolveDiffCopyText,
  resolveFileDiffPath,
  sortFileDiffsByPath,
  summarizeRenderablePatchStats,
} from "../lib/diffRendering";
import { scrollDiffFileIntoView } from "../lib/diffScrollSurface";
import {
  appendChatFileReference,
  appendComposerPromptText,
  buildDiffSelectionReference,
  buildWhyChangedPrompt,
  normalizeSelectionSnippet,
} from "../lib/chatReferences";
import {
  resolveDiffEditBaseRev,
  resolveDiffFileEditMode,
  type DiffFileEditRequest,
} from "../lib/diffEditBaseRev";
import { resolveDiffEnvironmentState } from "../lib/threadEnvironment";
import { disclosureWidthClassName } from "../lib/disclosureMotion";
import { useCopyToClipboard } from "../lib/clipboard";
import { type RepoDiffScope, useRepoDiffScope, useRepoDiffScopeStore } from "../repoDiffScopeStore";
import { useStore } from "../store";
import { createProjectSelector } from "../storeSelectors";
import { inferCheckpointTurnCountByTurnId } from "../session-logic";
import { useAppSettings } from "../appSettings";
import { useComposerDraftStore } from "../composerDraftStore";
import { CHAT_HEADER_ICON_CONTROL_CLASS_NAME } from "./chat/chatHeaderControls";
import {
  areAllRenderableFilesCollapsed,
  isStaleDiffTurnSelection,
  resolveConversationCacheScope,
  resolveDiffPanelGitStatusQueriesEnabled,
  resolveDiffPanelQueriesEnabled,
  resolveDiffPanelScopeCountQueriesEnabled,
  resolveDiffPanelRepoLiveRefetchIntervalMs,
  resolveDiffPanelScopeFileCounts,
  resolveDiffPanelThread,
  resolveDiffPanelViewSource,
  resolveAdjacentDiffFilePath,
  resolveDiffSelectAllArmed,
  resolveDiffSelectAllWithinViewport,
  resolveInitialDiffViewKind,
  resolveSelectedTurnSummary,
  resolveWatchedDiffFilePath,
  type DiffChangeNavigationDirection,
  type DiffPanelRepoScopeOption,
  type DiffPanelTurnScopeIntent,
  type DiffViewKind,
} from "./DiffPanel.logic";
import { resolveDraftFallbackModelSelection } from "./ChatView.logic";
import { DiffPanelChangeMarkers } from "./DiffPanelChangeMarkers";
import { type DiffPanelChangeNavigation } from "./DiffPanelChangeNavigation";
import { DiffLineBlamePopover, type DiffLineBlameTarget } from "./DiffLineBlamePopover";
import { DiffPanelPatchViewport } from "./DiffPanelPatchViewport";
import { DiffPanelToolbar } from "./DiffPanelToolbar";
import { DiffTruncationWarning } from "./DiffTruncationWarning";
import { ReviewFileTreePanel } from "./ReviewFileTreePanel";
import { closestThroughShadow } from "./chat/chatSelectionActions";
import { TranscriptSelectionAction } from "./chat/TranscriptSelectionAction";
import { useCodeSelectionAction } from "./chat/useCodeSelectionAction";
import { useProjectFileChangeSubscription } from "../hooks/useProjectFileChangeSubscription";
import {
  createDiffPanelRepoLiveRefreshSelector,
  createDiffPanelThreadCatalogSelector,
  toDiffPanelThreadCatalog,
  type DiffPanelThreadCatalog,
} from "./diffPanelSelectors";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { IconButton } from "./ui/icon-button";
import { REPO_DIFF_SCOPE_LABELS, resolveRepoDiffScopeLabel } from "../repoDiffScopeStore";
import { PanelStateMessage } from "./chat/PanelStateMessage";
import { type SplitViewPanePanelState } from "../splitViewModel";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const DiffRenderModeSchema = Schema.Literals(["stacked", "split"]);

interface DiffPanelProps {
  mode?: DiffPanelMode;
  initialViewKind?: DiffViewKind;
  threadId?: ThreadId | null;
  panelState?: Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">;
  onUpdatePanelState?: (
    patch: Partial<Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">>,
  ) => void;
  onClosePanel?: () => void;
  liveRefreshEnabled?: boolean;

  queriesEnabled?: boolean;
  onEditFile?: (request: DiffFileEditRequest) => void;
}

export default function DiffPanel({
  mode: modeProp,
  initialViewKind,
  threadId: controlledThreadId,
  panelState,
  onUpdatePanelState,
  onClosePanel,
  liveRefreshEnabled: liveRefreshEnabledProp,
  queriesEnabled: queriesEnabledProp,
  onEditFile,
}: DiffPanelProps) {
  const queryClient = useQueryClient();
  const mode = modeProp ?? "inline";
  const liveRefreshEnabled = liveRefreshEnabledProp ?? true;
  const queriesEnabled = queriesEnabledProp ?? true;
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { settings } = useAppSettings();
  const [diffRenderMode, setDiffRenderMode] = useLocalStorage(
    "glade:diff-render-mode:v1",
    "split",
    DiffRenderModeSchema,
  );
  const [diffWordWrap, setDiffWordWrap] = useState(settings.diffWordWrap);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(true);
  const [changeMarkersEnabled, setChangeMarkersEnabled] = useState(true);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const handleScopePickerOpenChange = useCallback((open: boolean) => {
    setScopePickerOpen((previous) => (previous === open ? previous : open));
  }, []);
  const setRepoDiffScope = useRepoDiffScopeStore((store) => store.setScope);
  const setRepoDiffCompareRef = useRepoDiffScopeStore((store) => store.setCompareRef);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());
  const [fileTreeOpen, setFileTreeOpen] = useState(false);

  const [fileTreeMounted, setFileTreeMounted] = useState(false);
  const toggleFileTree = useCallback(() => {
    setFileTreeOpen((previous) => !previous);
    setFileTreeMounted(true);
  }, []);
  const closeFileTree = useCallback(() => {
    setFileTreeOpen(false);
  }, []);
  const patchViewportRef = useRef<HTMLDivElement>(null);
  const diffSelectAllArmedRef = useRef(false);

  const lastPointerInDiffViewportRef = useRef(false);
  const previousDiffOpenRef = useRef(false);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const diffSearch = useDiffRouteSearch();
  const diffOpen = panelState ? panelState.panel === "diff" : diffSearch.diff === "1";
  const diffQueriesEnabled = useMemo(
    () =>
      resolveDiffPanelQueriesEnabled({
        diffOpen,
        queriesEnabled,
      }),
    [diffOpen, queriesEnabled],
  );
  const scopeCountQueriesEnabled = useMemo(
    () =>
      resolveDiffPanelScopeCountQueriesEnabled({
        queriesEnabled: diffQueriesEnabled,
        scopePickerOpen,
      }),
    [diffQueriesEnabled, scopePickerOpen],
  );
  const activeThreadId = controlledThreadId ?? routeThreadId;
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
        settingsDefaultProvider: settings.defaultProvider,
      }),
    });
    return draftBackedThread ? toDiffPanelThreadCatalog(draftBackedThread) : undefined;
  }, [
    activeThreadId,
    draftThread,
    fallbackDraftProject?.defaultModelSelection,
    serverThreadCatalog,
    settings.defaultProvider,
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
  const selectedTurnId = panelState
    ? (panelState.diffTurnId ?? null)
    : (diffSearch.diffTurnId ?? null);
  const [diffViewKind, setDiffViewKind] = useState<DiffViewKind>(
    () => initialViewKind ?? resolveInitialDiffViewKind(selectedTurnId),
  );
  const [turnScopeIntent, setTurnScopeIntent] = useState<DiffPanelTurnScopeIntent>(() =>
    selectedTurnId === null ? "all" : "last",
  );
  const gitStatusQueriesEnabled = useMemo(
    () =>
      resolveDiffPanelGitStatusQueriesEnabled({
        queriesEnabled: diffQueriesEnabled,
        activeCwd,
        diffViewKind,
      }),
    [activeCwd, diffQueriesEnabled, diffViewKind],
  );
  const gitBranchesQuery = useQuery({
    ...gitBranchesQueryOptions(activeCwd ?? null),
    enabled: diffQueriesEnabled && activeCwd !== null,
  });
  const gitStatusQuery = useQuery({
    ...gitStatusQueryOptions(activeCwd ?? null),
    enabled: gitStatusQueriesEnabled,
  });
  const gitRepoStatus = gitBranchesQuery.isSuccess ? gitBranchesQuery.data.isRepo : undefined;
  const gitRepoStatusError =
    gitBranchesQuery.error instanceof Error
      ? gitBranchesQuery.error.message
      : gitBranchesQuery.error
        ? "Failed to check git repository."
        : null;
  const isGitRepo = gitRepoStatus === true;
  const turnDiffSummaries = useMemo(
    () => activeThreadContext?.turnDiffSummaries ?? [],
    [activeThreadContext?.turnDiffSummaries],
  );
  const inferredCheckpointTurnCountByTurnId = useMemo(
    () => inferCheckpointTurnCountByTurnId(turnDiffSummaries),
    [turnDiffSummaries],
  );
  const repoDiffLiveRefreshIntervalMs = useMemo(
    () =>
      resolveDiffPanelRepoLiveRefetchIntervalMs({
        queriesEnabled: diffQueriesEnabled,
        liveRefreshEnabled,
        diffViewKind,
        shouldPollRepoDiff,
      }),
    [diffQueriesEnabled, diffViewKind, liveRefreshEnabled, shouldPollRepoDiff],
  );
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  const selectedFilePath = panelState
    ? (panelState.diffFilePath ?? null)
    : (diffSearch.diffFilePath ?? null);
  const selectedTurn = useMemo(
    () => resolveSelectedTurnSummary(selectedTurnId, orderedTurnDiffSummaries),
    [orderedTurnDiffSummaries, selectedTurnId],
  );
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const conversationCheckpointTurnCount = useMemo(() => {
    const turnCounts = orderedTurnDiffSummaries
      .map(
        (summary) =>
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
      )
      .filter((value): value is number => typeof value === "number");
    if (turnCounts.length === 0) {
      return undefined;
    }
    const latest = Math.max(...turnCounts);
    return latest > 0 ? latest : undefined;
  }, [inferredCheckpointTurnCountByTurnId, orderedTurnDiffSummaries]);
  const conversationCheckpointRange = useMemo(
    () =>
      !selectedTurn &&
      turnScopeIntent !== "last" &&
      typeof conversationCheckpointTurnCount === "number"
        ? {
            fromTurnCount: 0,
            toTurnCount: conversationCheckpointTurnCount,
          }
        : null,
    [conversationCheckpointTurnCount, selectedTurn, turnScopeIntent],
  );
  const activeCheckpointRange = selectedTurn
    ? selectedCheckpointRange
    : conversationCheckpointRange;
  const conversationCacheScope = useMemo(
    () =>
      selectedTurn || orderedTurnDiffSummaries.length === 0
        ? null
        : resolveConversationCacheScope(conversationCheckpointTurnCount),
    [conversationCheckpointTurnCount, orderedTurnDiffSummaries.length, selectedTurn],
  );
  const activeCheckpointDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      threadId: activeThreadId,
      fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
      ignoreWhitespace: diffIgnoreWhitespace,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : conversationCacheScope,
      enabled:
        diffQueriesEnabled && isGitRepo && !diffEnvironmentPending && diffViewKind === "turn",
    }),
  );
  const selectedTurnCheckpointDiff = selectedTurn
    ? activeCheckpointDiffQuery.data?.diff
    : undefined;
  const conversationCheckpointDiff = selectedTurn
    ? undefined
    : activeCheckpointDiffQuery.data?.diff;
  const checkpointDiffDisplay = resolveCheckpointDiffQueryDisplayState({
    isLoading: activeCheckpointDiffQuery.isLoading,
    isFetching: activeCheckpointDiffQuery.isFetching,
    data: activeCheckpointDiffQuery.data,
    error: activeCheckpointDiffQuery.error,
  });
  const isLoadingCheckpointDiff = checkpointDiffDisplay.isLoading;
  const checkpointDiffError = checkpointDiffDisplay.error;

  const selectedPatch = selectedTurn ? selectedTurnCheckpointDiff : conversationCheckpointDiff;
  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;

  const unstagedDiffStatsQuery = useQuery(
    gitWorkingTreeDiffStatsQueryOptions({
      cwd: activeCwd ?? null,
      scope: "unstaged",
      enabled: scopeCountQueriesEnabled && !diffEnvironmentPending,
    }),
  );
  const stagedDiffStatsQuery = useQuery(
    gitWorkingTreeDiffStatsQueryOptions({
      cwd: activeCwd ?? null,
      scope: "staged",
      enabled: scopeCountQueriesEnabled && !diffEnvironmentPending,
    }),
  );
  const branchDiffStatsQuery = useQuery(
    gitWorkingTreeDiffStatsQueryOptions({
      cwd: activeCwd ?? null,
      scope: "branch",
      enabled: scopeCountQueriesEnabled && !diffEnvironmentPending,
    }),
  );
  const refDiffStatsQuery = useQuery(
    gitWorkingTreeDiffStatsQueryOptions({
      cwd: activeCwd ?? null,
      scope: "ref",
      compareRef: repoDiffCompareRef,
      enabled: scopeCountQueriesEnabled && !diffEnvironmentPending,
    }),
  );
  const repoDiffQuery = useQuery(
    gitWorkingTreeDiffQueryOptions({
      cwd: activeCwd ?? null,
      scope: repoDiffScope,
      compareRef: repoDiffCompareRef,
      enabled: diffQueriesEnabled && !diffEnvironmentPending && diffViewKind === "repo",
      refetchInterval: repoDiffLiveRefreshIntervalMs,
    }),
  );
  const repoPatch = repoDiffQuery.data?.patch;
  const hasResolvedRepoPatch = typeof repoPatch === "string";
  const hasNoRepoChanges = hasResolvedRepoPatch && repoPatch.trim().length === 0;
  const repoDiffError =
    repoDiffQuery.error instanceof Error
      ? repoDiffQuery.error.message
      : repoDiffQuery.error
        ? "Failed to load repo diff."
        : null;
  const branchHasCommittedChanges = (gitStatusQuery.data?.aheadCount ?? 0) > 0;

  useEffect(() => {
    if (
      diffOpen &&
      diffViewKind === "repo" &&
      repoDiffScope === "workingTree" &&
      hasResolvedRepoPatch &&
      hasNoRepoChanges &&
      branchHasCommittedChanges
    ) {
      setRepoDiffScope("branch");
    }
  }, [
    branchHasCommittedChanges,
    diffOpen,
    diffViewKind,
    hasNoRepoChanges,
    hasResolvedRepoPatch,
    repoDiffScope,
    setRepoDiffScope,
  ]);

  const viewSource = useMemo(
    () =>
      resolveDiffPanelViewSource({
        diffViewKind,
        repoDiffScope,
        selectedTurnId,
      }),
    [diffViewKind, repoDiffScope, selectedTurnId],
  );
  const activeReviewPatch = diffViewKind === "repo" ? repoPatch : selectedPatch;
  const activeReviewTruncated = diffViewKind === "repo" && repoDiffQuery.data?.truncated === true;
  const activeReviewError = diffViewKind === "repo" ? repoDiffError : checkpointDiffError;
  const activeReviewIsLoading =
    diffViewKind === "repo" ? repoDiffQuery.isLoading : isLoadingCheckpointDiff;
  const activeDiffIsFetching =
    diffViewKind === "repo" ? repoDiffQuery.isFetching : activeCheckpointDiffQuery.isFetching;
  const handleDiffReload = useCallback(() => {
    void (diffViewKind === "repo" ? repoDiffQuery.refetch() : activeCheckpointDiffQuery.refetch());
  }, [activeCheckpointDiffQuery, diffViewKind, repoDiffQuery]);
  const activeReviewHasNoChanges = diffViewKind === "repo" ? hasNoRepoChanges : hasNoNetChanges;
  const { copyToClipboard: copyDiffToClipboard, isCopied: isDiffCopied } = useCopyToClipboard();

  const renderablePatch = useMemo(() => getRenderablePatch(activeReviewPatch), [activeReviewPatch]);
  const diffCopyText = useMemo(
    () => resolveDiffCopyText(activeReviewPatch, activeReviewTruncated),
    [activeReviewPatch, activeReviewTruncated],
  );
  const diffCopyLabel = isDiffCopied
    ? activeReviewTruncated
      ? "Copied partial diff"
      : "Copied diff"
    : activeReviewTruncated
      ? "Copy partial diff"
      : "Copy diff";
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return sortFileDiffsByPath(renderablePatch.files);
  }, [renderablePatch]);
  const watchedRepoFilePath =
    diffViewKind === "repo" ? resolveWatchedDiffFilePath(selectedFilePath, renderableFiles) : null;
  const handleWatchedRepoFileChange = useCallback(() => {
    if (!activeCwd) {
      return;
    }
    void refreshGitAfterFileWrite(queryClient, activeCwd);
  }, [activeCwd, queryClient]);
  useProjectFileChangeSubscription({
    cwd: activeCwd,
    relativePath: watchedRepoFilePath,
    enabled: diffQueriesEnabled && liveRefreshEnabled && watchedRepoFilePath !== null,
    onChange: handleWatchedRepoFileChange,
  });

  useEffect(() => {
    const isEventWithinDiffViewport = (event: Event) => {
      const viewport = patchViewportRef.current;
      return viewport ? event.composedPath().includes(viewport) : false;
    };
    const isTextEditingEvent = (event: Event) =>
      event
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            (target instanceof HTMLElement &&
              (target.isContentEditable || target.getAttribute("role") === "textbox")),
        );
    const handleKeyDown = (event: KeyboardEvent) => {
      const isWithinDiffViewport = resolveDiffSelectAllWithinViewport(
        isEventWithinDiffViewport(event),
        lastPointerInDiffViewportRef.current,
        isTextEditingEvent(event),
      );
      diffSelectAllArmedRef.current = resolveDiffSelectAllArmed(
        diffSelectAllArmedRef.current,
        event,
        isWithinDiffViewport,
      );
    };
    const handlePointerDown = (event: PointerEvent) => {
      lastPointerInDiffViewportRef.current = isEventWithinDiffViewport(event);
      diffSelectAllArmedRef.current = false;
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (isEventWithinDiffViewport(event)) {
        return;
      }
      lastPointerInDiffViewportRef.current = false;
      diffSelectAllArmedRef.current = false;
    };
    const handleCopy = (event: ClipboardEvent) => {
      if (!diffSelectAllArmedRef.current) {
        return;
      }
      diffSelectAllArmedRef.current = false;
      if (!diffCopyText || !event.clipboardData) {
        return;
      }
      event.preventDefault();
      event.clipboardData.setData("text/plain", diffCopyText);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("copy", handleCopy, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("copy", handleCopy, true);
    };
  }, [diffCopyText]);

  const activePatchStat = useMemo(
    () => summarizeRenderablePatchStats(renderablePatch),
    [renderablePatch],
  );
  const workingTreeDiffStatsQuery = useQuery(
    gitWorkingTreeDiffStatsQueryOptions({
      cwd: activeCwd ?? null,
      scope: "workingTree",
      enabled: scopeCountQueriesEnabled && !diffEnvironmentPending,
    }),
  );
  const pickerScopeFileCounts = useMemo(() => {
    const counts: Partial<Record<RepoDiffScope, number>> = {};
    const workingTreeCount = workingTreeDiffStatsQuery.data?.fileCount;
    const unstagedCount = unstagedDiffStatsQuery.data?.fileCount;
    const stagedCount = stagedDiffStatsQuery.data?.fileCount;
    const branchCount = branchDiffStatsQuery.data?.fileCount;
    const refCount = refDiffStatsQuery.data?.fileCount;
    if (typeof workingTreeCount === "number") counts.workingTree = workingTreeCount;
    if (typeof unstagedCount === "number") counts.unstaged = unstagedCount;
    if (typeof stagedCount === "number") counts.staged = stagedCount;
    if (typeof branchCount === "number") counts.branch = branchCount;
    if (typeof refCount === "number") counts.ref = refCount;
    return counts;
  }, [
    branchDiffStatsQuery.data?.fileCount,
    refDiffStatsQuery.data?.fileCount,
    stagedDiffStatsQuery.data?.fileCount,
    unstagedDiffStatsQuery.data?.fileCount,
    workingTreeDiffStatsQuery.data?.fileCount,
  ]);
  const scopeFileCounts = useMemo(
    () =>
      resolveDiffPanelScopeFileCounts({
        viewSource,
        activeScopeFileCount: activePatchStat?.fileCount,
        scopePickerOpen,
        pickerScopeCounts: pickerScopeFileCounts,
      }),
    [activePatchStat?.fileCount, pickerScopeFileCounts, scopePickerOpen, viewSource],
  );
  const allFilesCollapsed = useMemo(
    () => areAllRenderableFilesCollapsed(renderableFiles, collapsedFiles),
    [collapsedFiles, renderableFiles],
  );

  useEffect(() => {
    const wasOpen = previousDiffOpenRef.current;
    previousDiffOpenRef.current = diffOpen;
    if (!diffOpen || wasOpen || initialViewKind) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setDiffWordWrap(settings.diffWordWrap);
      setDiffViewKind(initialViewKind ?? resolveInitialDiffViewKind(selectedTurnId));
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [diffOpen, initialViewKind, selectedTurnId, settings.diffWordWrap]);

  useEffect(() => {
    if (selectedTurnId === null) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setDiffViewKind((current) => (current === "turn" ? current : "turn"));
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [selectedTurnId]);

  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }
    scrollDiffFileIntoView(patchViewportRef.current, selectedFilePath, "nearest");
  }, [selectedFilePath, renderableFiles]);

  const diffFilePaths = useMemo(
    () => renderableFiles.map((fileDiff) => resolveFileDiffPath(fileDiff)),
    [renderableFiles],
  );
  const visibleFilePath = useVisibleDiffFilePath(patchViewportRef, renderableFiles);
  const activeFilePath = visibleFilePath ?? selectedFilePath;
  const scrollToDiffFilePath = useCallback((filePath: string) => {
    scrollDiffFileIntoView(patchViewportRef.current, filePath, "start");
  }, []);
  const goToAdjacentChange = useCallback(
    (direction: DiffChangeNavigationDirection) => {
      const targetPath = resolveAdjacentDiffFilePath(diffFilePaths, activeFilePath, direction);
      if (!targetPath) {
        return;
      }
      scrollToDiffFilePath(targetPath);
    },
    [activeFilePath, diffFilePaths, scrollToDiffFilePath],
  );
  const goToPreviousChange = useCallback(() => {
    goToAdjacentChange("previous");
  }, [goToAdjacentChange]);
  const goToNextChange = useCallback(() => {
    goToAdjacentChange("next");
  }, [goToAdjacentChange]);
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const keybindings = serverConfigQuery.data?.keybindings ?? EMPTY_KEYBINDINGS;
  useDiffChangeNavigationShortcuts({
    keybindings,
    enabled: diffQueriesEnabled && diffFilePaths.length > 0,
    surfaceRef: patchViewportRef,
    onNavigate: goToAdjacentChange,
  });
  const changeNavigation = useMemo(
    (): DiffPanelChangeNavigation => ({
      canGoToPrevious:
        resolveAdjacentDiffFilePath(diffFilePaths, activeFilePath, "previous") !== null,
      canGoToNext: resolveAdjacentDiffFilePath(diffFilePaths, activeFilePath, "next") !== null,
      previousShortcutLabel: shortcutLabelForCommand(keybindings, "diff.change.previous"),
      nextShortcutLabel: shortcutLabelForCommand(keybindings, "diff.change.next"),
      onGoToPrevious: goToPreviousChange,
      onGoToNext: goToNextChange,
    }),
    [activeFilePath, diffFilePaths, goToNextChange, goToPreviousChange, keybindings],
  );

  const toggleFileCollapsed = useCallback((fileKey: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileKey)) next.delete(fileKey);
      else next.add(fileKey);
      return next;
    });
  }, []);

  const openFileInEditor = useMemo(
    () =>
      onEditFile
        ? (filePath: string, options?: { basePath?: string | null }) => {
            onEditFile({
              filePath,
              ...(options?.basePath ? { basePath: options.basePath } : {}),
              mode: resolveDiffFileEditMode(diffViewKind, repoDiffScope),
              baseRev: resolveDiffEditBaseRev(repoDiffScope, repoDiffCompareRef),
            });
          }
        : undefined,
    [diffViewKind, onEditFile, repoDiffCompareRef, repoDiffScope],
  );

  const diffFileChatActions = useMemo(
    () =>
      activeThreadId
        ? {
            onReferenceInChat: (filePath: string) => {
              appendChatFileReference(activeThreadId, { path: filePath });
            },
            onAskWhyChanged: (filePath: string) => {
              appendComposerPromptText(activeThreadId, buildWhyChangedPrompt(filePath));
            },
            ...(openFileInEditor ? { onEditFile: openFileInEditor } : {}),
          }
        : undefined,
    [activeThreadId, openFileInEditor],
  );

  const [blameTarget, setBlameTarget] = useState<DiffLineBlameTarget | null>(null);
  const showLineBlame = useCallback((target: DiffLineBlameTarget) => {
    setBlameTarget(target);
  }, []);
  const closeLineBlame = useCallback(() => {
    setBlameTarget(null);
  }, []);

  const blameEnabled =
    diffViewKind === "repo" && repoDiffScope !== "staged" && repoDiffScope !== "unstaged";
  useEffect(() => {
    if (!blameEnabled) {
      setBlameTarget(null);
    }
  }, [blameEnabled]);
  const referenceBlameLineInChat = useMemo(
    () =>
      activeThreadId
        ? (target: DiffLineBlameTarget) => {
            appendChatFileReference(activeThreadId, {
              path: target.filePath,
              startLine: target.line,
            });
          }
        : undefined,
    [activeThreadId],
  );

  const readDiffSelection = useCallback((container: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }
    const anchorRow = closestThroughShadow(selection.anchorNode, "[data-diff-file-path]");
    const focusRow = closestThroughShadow(selection.focusNode, "[data-diff-file-path]");
    if (!anchorRow || anchorRow !== focusRow || !container.contains(anchorRow)) {
      return null;
    }
    const filePath = anchorRow.getAttribute("data-diff-file-path") ?? "";

    const text = normalizeSelectionSnippet(selection.toString());
    if (filePath.length === 0 || text === null) {
      return null;
    }
    return { filePath, text };
  }, []);
  const commitDiffSelection = useCallback(
    (payload: { filePath: string; text: string }) => {
      if (activeThreadId) {
        appendComposerPromptText(
          activeThreadId,
          buildDiffSelectionReference(payload.filePath, payload.text),
        );
      }
    },
    [activeThreadId],
  );
  const diffSelectionAction = useCodeSelectionAction({
    enabled: activeThreadId !== null,
    readSelection: readDiffSelection,
    onCommit: commitDiffSelection,
  });

  const updateDiffSelection = useCallback(
    (input: { turnId: TurnId | null; filePath?: string | null }) => {
      if (!activeThreadContext) return;
      if (onUpdatePanelState) {
        onUpdatePanelState({
          panel: "diff",
          diffTurnId: input.turnId,
          diffFilePath: input.filePath ?? null,
        });
        return;
      }
      void navigate({
        to: "/$threadId",
        params: { threadId: activeThreadContext.id },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return {
            ...rest,
            panel: "diff",
            diff: "1",
            ...(input.turnId ? { diffTurnId: input.turnId } : {}),
            ...(input.filePath ? { diffFilePath: input.filePath } : {}),
          };
        },
      });
    },
    [activeThreadContext, navigate, onUpdatePanelState],
  );
  useEffect(() => {
    if (!diffOpen || !activeThreadContext) {
      return;
    }
    if (!isStaleDiffTurnSelection(selectedTurnId, orderedTurnDiffSummaries)) {
      return;
    }
    updateDiffSelection({ turnId: null, filePath: null });
  }, [
    activeThreadContext,
    diffOpen,
    orderedTurnDiffSummaries,
    selectedTurnId,
    updateDiffSelection,
  ]);
  const selectTurn = useCallback(
    (turnId: TurnId | null) => {
      setDiffViewKind("turn");
      setTurnScopeIntent(turnId === null ? "all" : "last");
      updateDiffSelection({ turnId, filePath: null });
    },
    [updateDiffSelection],
  );
  const selectRepoScope = useCallback(
    (scope: DiffPanelRepoScopeOption) => {
      setDiffViewKind("repo");
      setRepoDiffScope(scope);
      if (selectedTurnId !== null) {
        updateDiffSelection({ turnId: null, filePath: null });
      }
    },
    [selectedTurnId, setRepoDiffScope, updateDiffSelection],
  );
  const selectCompareRef = useCallback(
    (ref: string) => {
      const trimmed = ref.trim();
      if (trimmed.length === 0 || !activeCwd) {
        return;
      }
      setDiffViewKind("repo");
      setRepoDiffCompareRef(activeCwd, trimmed);
      setRepoDiffScope("ref");
      if (selectedTurnId !== null) {
        updateDiffSelection({ turnId: null, filePath: null });
      }
    },
    [activeCwd, selectedTurnId, setRepoDiffCompareRef, setRepoDiffScope, updateDiffSelection],
  );
  const selectAllTurns = useCallback(() => {
    setTurnScopeIntent("all");
    selectTurn(null);
  }, [selectTurn]);
  const selectLastTurn = useCallback(() => {
    const latestTurn = orderedTurnDiffSummaries[0];
    setTurnScopeIntent("last");
    setDiffViewKind("turn");
    if (!latestTurn) {
      if (selectedTurnId !== null) {
        updateDiffSelection({ turnId: null, filePath: null });
      }
      return;
    }
    selectTurn(latestTurn.turnId);
  }, [orderedTurnDiffSummaries, selectTurn, selectedTurnId, updateDiffSelection]);
  const toggleCollapseAll = useCallback(() => {
    setCollapsedFiles((previous) => {
      if (areAllRenderableFilesCollapsed(renderableFiles, previous)) {
        return new Set();
      }
      return new Set(renderableFiles.map((fileDiff) => buildFileDiffRenderKey(fileDiff)));
    });
  }, [renderableFiles]);
  const selectFile = useCallback(
    (filePath: string) => {
      updateDiffSelection({ turnId: selectedTurnId, filePath });
    },
    [selectedTurnId, updateDiffSelection],
  );
  const showDiffToolbar = Boolean(activeThreadContext && isGitRepo && !diffEnvironmentPending);
  const copyDiff = useCallback(() => {
    if (diffCopyText) {
      copyDiffToClipboard(diffCopyText, undefined);
    }
  }, [copyDiffToClipboard, diffCopyText]);
  const shellHeader = useMemo(
    () =>
      showDiffToolbar ? (
        <DiffPanelToolbar
          key={activeThreadId ?? "no-thread"}
          activeCwd={activeCwd}
          activeThreadId={activeThreadId}
          viewSource={viewSource}
          turnScopeIntent={turnScopeIntent}
          scopeFileCounts={scopeFileCounts}
          compareRef={repoDiffCompareRef}
          activeStats={
            activePatchStat
              ? {
                  additions: activePatchStat.additions,
                  deletions: activePatchStat.deletions,
                }
              : null
          }
          orderedTurnDiffSummaries={orderedTurnDiffSummaries}
          inferredCheckpointTurnCountByTurnId={inferredCheckpointTurnCountByTurnId}
          selectedTurnId={selectedTurnId}
          timestampFormat={settings.timestampFormat}
          renderableFiles={renderableFiles}
          selectedFilePath={activeFilePath}
          fileTreeOpen={fileTreeOpen}
          resolvedTheme={resolvedTheme}
          diffRenderMode={diffRenderMode}
          diffWordWrap={diffWordWrap}
          diffIgnoreWhitespace={diffIgnoreWhitespace}
          diffCopyText={diffCopyText}
          diffCopyLabel={diffCopyLabel}
          reloading={activeDiffIsFetching}
          allFilesCollapsed={allFilesCollapsed}
          changeMarkersEnabled={changeMarkersEnabled}
          changeNavigation={changeNavigation}
          onSelectRepoScope={selectRepoScope}
          onSelectCompareRef={selectCompareRef}
          onSelectAllTurns={selectAllTurns}
          onSelectLastTurn={selectLastTurn}
          onSelectTurn={selectTurn}
          onSelectFile={selectFile}
          onToggleFileTree={toggleFileTree}
          onDiffRenderModeChange={setDiffRenderMode}
          onDiffWordWrapChange={setDiffWordWrap}
          onDiffIgnoreWhitespaceChange={setDiffIgnoreWhitespace}
          onChangeMarkersEnabledChange={setChangeMarkersEnabled}
          onCopyDiff={copyDiff}
          onReload={handleDiffReload}
          onToggleCollapseAll={toggleCollapseAll}
          scopePickerOpen={scopePickerOpen}
          onScopePickerOpenChange={handleScopePickerOpenChange}
          {...(onClosePanel ? { onClosePanel } : {})}
        />
      ) : onClosePanel ? (
        <div className="flex h-full w-full items-center justify-end px-3 [-webkit-app-region:no-drag]">
          <IconButton
            variant="chrome"
            size="icon-xs"
            label="Close file view"
            className={CHAT_HEADER_ICON_CONTROL_CLASS_NAME}
            onClick={(event) => {
              event.stopPropagation();
              onClosePanel();
            }}
          >
            <XIcon className="size-3.5" />
          </IconButton>
        </div>
      ) : null,
    [
      activeCwd,
      activeDiffIsFetching,
      activePatchStat,
      activeThreadId,
      allFilesCollapsed,
      changeMarkersEnabled,
      changeNavigation,
      copyDiff,
      diffCopyText,
      diffCopyLabel,
      diffIgnoreWhitespace,
      diffRenderMode,
      diffWordWrap,
      fileTreeOpen,
      inferredCheckpointTurnCountByTurnId,
      handleScopePickerOpenChange,
      handleDiffReload,
      onClosePanel,
      orderedTurnDiffSummaries,
      repoDiffCompareRef,
      scopePickerOpen,
      renderableFiles,
      resolvedTheme,
      scopeFileCounts,
      selectAllTurns,
      selectCompareRef,
      selectFile,
      selectLastTurn,
      selectRepoScope,
      selectTurn,
      activeFilePath,
      selectedTurnId,
      setDiffRenderMode,
      settings.timestampFormat,
      showDiffToolbar,
      toggleCollapseAll,
      toggleFileTree,
      turnScopeIntent,
      viewSource,
    ],
  );

  return (
    <DiffPanelShell mode={mode} header={shellHeader}>
      {!activeThreadContext ? (
        <PanelStateMessage density="compact" fill="flex">
          Select a thread to inspect turn diffs.
        </PanelStateMessage>
      ) : gitRepoStatus === false ? (
        <PanelStateMessage density="compact" fill="flex">
          Turn diffs are unavailable because this project is not a git repository.
        </PanelStateMessage>
      ) : gitRepoStatusError ? (
        <PanelStateMessage density="compact" fill="flex">
          {gitRepoStatusError}
        </PanelStateMessage>
      ) : gitRepoStatus === undefined && diffQueriesEnabled && activeCwd ? (
        <DiffPanelLoadingState label="Checking git repository..." />
      ) : diffEnvironmentPending ? (
        <PanelStateMessage density="compact" fill="flex">
          This chat environment is still being prepared. Diffs will be available once the worktree
          is ready.
        </PanelStateMessage>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            ref={patchViewportRef}
            className="diff-panel-viewport relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            onMouseUp={diffSelectionAction.onContainerMouseUp}
          >
            {activeReviewTruncated ? <DiffTruncationWarning className="m-2 mb-0" /> : null}
            <DiffPanelPatchViewport
              renderablePatch={renderablePatch}
              renderableFiles={renderableFiles}
              resolvedTheme={resolvedTheme}
              diffRenderMode={diffRenderMode}
              diffWordWrap={diffWordWrap}
              workspaceRoot={activeCwd ?? null}
              collapsedFiles={collapsedFiles}
              onToggleFileCollapsed={toggleFileCollapsed}
              chatActions={diffFileChatActions}
              onBlameLine={blameEnabled ? showLineBlame : undefined}
              isLoading={activeReviewIsLoading}
              hasNoChanges={activeReviewHasNoChanges}
              error={activeReviewError}
              refreshStatus={diffViewKind === "turn" ? checkpointDiffDisplay.refreshStatus : null}
              viewKind={diffViewKind}
              loadingLabel={
                diffViewKind !== "repo"
                  ? "Loading checkpoint diff..."
                  : repoDiffScope === "ref"
                    ? `Loading diff ${resolveRepoDiffScopeLabel(repoDiffScope, repoDiffCompareRef)}...`
                    : `Loading ${REPO_DIFF_SCOPE_LABELS[repoDiffScope].toLowerCase()} diff...`
              }
              emptyLabel={
                diffViewKind === "repo"
                  ? "No changes in the selected diff source."
                  : orderedTurnDiffSummaries.length === 0
                    ? "No turn diffs are available yet."
                    : "No net changes in this selection."
              }
              unavailableLabel="No repo diff is available right now."
            />
            {changeMarkersEnabled ? (
              <DiffPanelChangeMarkers
                viewportRef={patchViewportRef}
                renderableFiles={renderableFiles}
                onSelectFilePath={scrollToDiffFilePath}
              />
            ) : null}
            {blameTarget ? (
              <DiffLineBlamePopover
                target={blameTarget}
                cwd={activeCwd ?? null}
                base={resolveDiffEditBaseRev(repoDiffScope, repoDiffCompareRef)}
                timestampFormat={settings.timestampFormat}
                onReferenceInChat={referenceBlameLineInChat}
                onClose={closeLineBlame}
              />
            ) : null}
            {diffSelectionAction.pendingAction ? (
              <TranscriptSelectionAction
                left={diffSelectionAction.pendingAction.left}
                top={diffSelectionAction.pendingAction.top}
                placement={diffSelectionAction.pendingAction.placement}
                onAddToChat={diffSelectionAction.commit}
              />
            ) : null}
          </div>
          <div
            className={disclosureWidthClassName(fileTreeOpen, "w-[min(42%,28rem)]", "shrink-0")}
            aria-hidden={!fileTreeOpen}
            inert={!fileTreeOpen}
          >
            {}
            {fileTreeMounted ? (
              <ReviewFileTreePanel
                files={renderableFiles}
                selectedFilePath={activeFilePath}
                resolvedTheme={resolvedTheme}
                isLoading={activeReviewIsLoading}
                onSelectFile={selectFile}
                onClose={closeFileTree}
              />
            ) : null}
          </div>
        </div>
      )}
    </DiffPanelShell>
  );
}
