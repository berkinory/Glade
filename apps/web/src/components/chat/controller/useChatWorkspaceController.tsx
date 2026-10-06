import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { deriveAssociatedWorktreeMetadata } from "@glade/shared/threads/threadWorkspace";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildThreadBreadcrumbs } from "../../ChatView.logic.subagents";
import { hasFileUndoSettled } from "../../ChatView.logic.session";
import { createThreadLineageSelector } from "~/components/ChatView.selectors";
import { deriveLatestRateLimitStatus } from "~/components/chat/RateLimitBanner";
import { useAsyncUserInputResponse } from "~/components/chat/useAsyncUserInputResponse";
import { useChatTerminalState } from "~/components/chat/useChatTerminalState";
import {
  activateChatTerminal,
  closeActiveChatTerminalWorkspaceView,
  closeChatTerminal,
  collapseChatTerminalWorkspace,
  createChatTerminal,
  createChatTerminalFromShortcut,
  expandChatTerminalWorkspace,
  handleChatTerminalSessionExited,
  openNewFullWidthChatTerminal,
  setChatTerminalHeight,
  setChatTerminalOpen,
  setChatTerminalWorkspaceTab,
  toggleChatTerminalVisibility,
} from "~/components/chat/chatTerminalActions";
import type { DraftThreadEnvMode } from "../../../composerDraftDomain";
import {
  useThreadComputerAvailability,
  useThreadComputerControlGeneration,
} from "~/computerStateStore";
import { useThreadComputerStateSeed } from "~/hooks/useThreadComputerStateSeed";
import { isHomeChatContainerProject } from "~/lib/chatProjects";
import { deriveCumulativeCostUsd, deriveLatestContextWindowState } from "~/lib/contextWindow";
import { GIT_WORKING_TREE_DIFF_LIVE_REFETCH_INTERVAL_MS } from "../../../lib/gitQueryOptions";
import { resolveDiffEnvironmentState } from "~/lib/threadEnvironment";
import { newThreadId } from "~/lib/utils";
import { hasLiveTurnTailWork, isLatestTurnSettled } from "~/session-logic";
import { useStore } from "~/store";
import { useTerminalStateStore } from "~/terminalStateStore";
import { createProjectSelector } from "~/storeSelectors";
import { DEFAULT_RUNTIME_MODE, type Thread } from "~/types";
import { useWorkspacePathsStore } from "~/workspacePathsStore";
import {
  ChatViewProps,
  EMPTY_ACTIVITIES,
  EMPTY_MESSAGES,
  getRateLimitBannerDismissalKey,
} from "./chatViewSupport";
import type { useChatSessionController } from "./useChatSessionController";
export function useChatWorkspaceController({
  props,
  session,
}: {
  props: ChatViewProps;
  session: ReturnType<typeof useChatSessionController>;
}) {
  const { threadId, panelState } = props;
  const {
    composerDraft,
    activeThread,
    pendingFileUndo,
    setPendingFileUndo,
    setIsRevertingCheckpoint,
    serverThread,
    localDraftThread,
    rawSearch,
    dismissedRateLimitBannerKey,
    draftThread,
    isFocusedPane,
    settings,
    setPullRequestDialogState,
    setComposerHighlightedItemId,
    getDraftThreadByProjectId,
    setDraftThreadContext,
    setProjectDraftThreadId,
    navigate,
    getDraftThread,
    clearProjectDraftThreadId,
    markThreadVisited,
  } = session;

  useThreadComputerStateSeed(threadId);

  const computerAvailability = useThreadComputerAvailability(threadId);

  const computerControlGeneration =
    useThreadComputerControlGeneration(threadId) ?? composerDraft.computerControlGeneration ?? 0;

  const computerControlAvailable = computerAvailability?.kind === "available";

  const [activeThreadBranchAtActivation, setActiveThreadBranchAtActivation] = useState<{
    threadId: ThreadId;
    branch: string | null;
    isSettled: boolean;
  } | null>(null);

  const [
    settledThreadBranchWarningDismissedThreadId,
    setSettledThreadBranchWarningDismissedThreadId,
  ] = useState<ThreadId | null>(null);

  useEffect(() => {
    if (!activeThread || activeThreadBranchAtActivation?.threadId === activeThread.id) {
      return;
    }
    setActiveThreadBranchAtActivation({
      threadId: activeThread.id,
      branch: activeThread.branch,
      isSettled: activeThread.settledAt != null,
    });
    setSettledThreadBranchWarningDismissedThreadId(null);
  }, [
    setActiveThreadBranchAtActivation,
    setSettledThreadBranchWarningDismissedThreadId,
    activeThread,
    activeThreadBranchAtActivation?.threadId,
  ]);

  const settledThreadBranchAtActivation =
    activeThreadBranchAtActivation !== null &&
    activeThreadBranchAtActivation.threadId === activeThread?.id &&
    activeThreadBranchAtActivation.isSettled
      ? activeThreadBranchAtActivation.branch
      : activeThread?.branch;

  useEffect(() => {
    if (
      !pendingFileUndo ||
      !hasFileUndoSettled({ pending: pendingFileUndo, thread: activeThread ?? null })
    ) {
      return;
    }

    const settle = window.setTimeout(() => {
      setPendingFileUndo(null);
      setIsRevertingCheckpoint(false);
    }, 0);
    return () => window.clearTimeout(settle);
  }, [setIsRevertingCheckpoint, setPendingFileUndo, activeThread, pendingFileUndo]);

  const runtimeMode =
    composerDraft.runtimeMode ?? activeThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;

  const isServerThread = serverThread !== undefined;

  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;

  const canCheckoutPullRequestIntoThread = isLocalDraftThread;

  const diffOpen = rawSearch.panel === "diff";

  const browserOpen = rawSearch.panel === "browser";

  const resolvedDiffOpen = panelState ? panelState.panel === "diff" : diffOpen;

  const onRespondToAsyncUserInput = useAsyncUserInputResponse(threadId);

  const activeThreadId = activeThread?.id ?? null;

  const activeLatestTurn = activeThread?.latestTurn ?? null;

  const activeLatestTurnId = activeLatestTurn?.turnId ?? null;

  const activeLatestTurnState = activeLatestTurn?.state ?? null;

  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;

  const hasLiveTurnTail = hasLiveTurnTailWork({
    latestTurn: activeLatestTurn,
    messages: activeThread?.messages ?? EMPTY_MESSAGES,
    activities: threadActivities,
    session: activeThread?.session ?? null,
  });

  const activeContextWindowState = deriveLatestContextWindowState(threadActivities);

  const activeContextWindow = activeContextWindowState.snapshot;

  const activeCumulativeCostUsd = deriveCumulativeCostUsd(threadActivities);

  const activeRateLimitStatus = deriveLatestRateLimitStatus(threadActivities);

  const activeRateLimitBannerDismissalKey = getRateLimitBannerDismissalKey(
    activeRateLimitStatus,
    activeThread?.id ?? null,
  );

  const visibleActiveRateLimitStatus =
    activeRateLimitBannerDismissalKey === dismissedRateLimitBannerKey
      ? null
      : activeRateLimitStatus;

  const latestTurnSettledByProvider = isLatestTurnSettled(
    activeLatestTurn,
    activeThread?.session ?? null,
  );

  const latestTurnSettled = latestTurnSettledByProvider && !hasLiveTurnTail;

  // `latestTurnSettled` is also false when there is NO started turn (a brand-new chat), because
  // `isLatestTurnSettled` treats a non-existent turn as unsettled. Gate live-turn UI on an
  // actually-started turn so composer chrome cannot appear on a fresh chat just because the repo
  // already has local edits.
  const latestTurnLive = Boolean(activeLatestTurn?.startedAt) && !latestTurnSettled;

  const activeProjectId = activeThread?.projectId ?? draftThread?.projectId ?? null;

  const activeProject = useStore(
    useMemo(() => createProjectSelector(activeProjectId), [activeProjectId]),
  );
  const storeSetTerminalMetadata = useTerminalStateStore((state) => state.setTerminalMetadata);
  const storeSetTerminalActivity = useTerminalStateStore((state) => state.setTerminalActivity);
  const storeOpenTerminalThreadPage = useTerminalStateStore(
    (state) => state.openTerminalThreadPage,
  );

  const {
    terminalState,
    terminalFocusRequestId,
    requestTerminalFocus,
    terminalWorkspaceOpen,
    terminalWorkspaceTerminalTabActive,
    terminalWorkspaceChatTabActive,
  } = useChatTerminalState({
    onOpenTerminal: props.onOpenTerminal,
    threadId,
    activeThreadId,
    isFocusedPane,
  });
  const terminalActionContext = useMemo(
    () => ({
      activeThreadId,
      activeProjectPresent: activeProject !== undefined,
      confirmTerminalClose: settings.confirmTerminalTabClose,
      requestTerminalFocus,
    }),
    [activeThreadId, activeProject, settings.confirmTerminalTabClose, requestTerminalFocus],
  );
  const setTerminalOpen = (open: boolean) => setChatTerminalOpen(terminalActionContext, open);
  const setTerminalWorkspaceTab = (tab: "terminal" | "chat") =>
    setChatTerminalWorkspaceTab(terminalActionContext, tab);
  const setTerminalHeight = (height: number) =>
    setChatTerminalHeight(terminalActionContext, height);
  const toggleTerminalVisibility = () =>
    toggleChatTerminalVisibility(terminalActionContext, terminalState);
  const expandTerminalWorkspace = () => expandChatTerminalWorkspace(terminalActionContext);
  const collapseTerminalWorkspace = () => collapseChatTerminalWorkspace(terminalActionContext);
  const createNewTerminal = () => createChatTerminal(terminalActionContext);
  const createTerminalFromShortcut = () => createChatTerminalFromShortcut(terminalActionContext);
  const openNewFullWidthTerminal = () => openNewFullWidthChatTerminal(terminalActionContext);
  const activateTerminal = (terminalId: string) =>
    activateChatTerminal(terminalActionContext, terminalId);
  const closeTerminal = (terminalId: string) =>
    closeChatTerminal(terminalActionContext, terminalState, terminalId);
  const handleTerminalSessionExited = useCallback(
    (terminalId: string) => handleChatTerminalSessionExited(terminalActionContext, terminalId),
    [terminalActionContext],
  );
  const closeActiveWorkspaceView = () =>
    closeActiveChatTerminalWorkspaceView(terminalActionContext, terminalState);

  const homeDir = useWorkspacePathsStore((state) => state.homeDir);

  const chatWorkspaceRoot = useWorkspacePathsStore((state) => state.chatWorkspaceRoot);

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);

  const isHomeChatContainer = isHomeChatContainerProject(activeProject, {
    homeDir,
    chatWorkspaceRoot,
  });

  const isContainerLandingProject = isHomeChatContainer;

  const activeProjectDisplayName = isHomeChatContainer
    ? activeProject?.folderName
    : activeProject?.name;

  const isChatProject = isContainerLandingProject;

  const threadLineageThreads = useStore(
    useMemo(() => createThreadLineageSelector(activeThread?.id ?? null), [activeThread?.id]),
  );

  const threadBreadcrumbs = buildThreadBreadcrumbs(threadLineageThreads, activeThread);

  const resolvedThreadEnvMode = isServerThread
    ? (activeThread?.envMode ?? null)
    : (draftThread?.envMode ?? null);

  const resolvedThreadWorktreePath = isServerThread
    ? (activeThread?.worktreePath ?? null)
    : (draftThread?.worktreePath ?? null);

  const resolvedThreadWorkingDirectory = isServerThread
    ? (activeThread?.workingDirectory ?? null)
    : (draftThread?.workingDirectory ?? null);

  const diffEnvironmentState = resolveDiffEnvironmentState({
    projectCwd: activeProject?.cwd ?? null,
    envMode: resolvedThreadEnvMode,
    worktreePath: resolvedThreadWorktreePath,
  });

  const diffEnvironmentPending = diffEnvironmentState.pending;

  const diffDisabledReason = diffEnvironmentState.disabledReason;

  const repoDiffBadgeRefreshIntervalMs =
    isFocusedPane && latestTurnLive && !diffEnvironmentPending && !resolvedDiffOpen
      ? GIT_WORKING_TREE_DIFF_LIVE_REFETCH_INTERVAL_MS
      : false;

  const activeThreadAssociatedWorktree = deriveAssociatedWorktreeMetadata({
    branch: activeThread?.branch ?? null,
    worktreePath: activeThread?.worktreePath ?? null,
    ...(activeThread?.associatedWorktreePath !== undefined
      ? { associatedWorktreePath: activeThread.associatedWorktreePath }
      : {}),
    ...(activeThread?.associatedWorktreeBranch !== undefined
      ? { associatedWorktreeBranch: activeThread.associatedWorktreeBranch }
      : {}),
    ...(activeThread?.associatedWorktreeRef !== undefined
      ? { associatedWorktreeRef: activeThread.associatedWorktreeRef }
      : {}),
  });

  const openPullRequestDialog = (reference?: string) => {
    if (!canCheckoutPullRequestIntoThread) {
      return;
    }
    setPullRequestDialogState({
      initialReference: reference ?? null,
      key: Date.now(),
    });
    setComposerHighlightedItemId(null);
  };

  const closePullRequestDialog = () => {
    setPullRequestDialogState(null);
  };

  const openOrReuseProjectDraftThread = async (input: {
    branch: string;
    worktreePath: string | null;
    envMode: DraftThreadEnvMode;
    lastKnownPr?: Thread["lastKnownPr"];
  }) => {
    if (!activeProject) {
      throw new Error("No active project is available for this pull request.");
    }
    const draftThreadContext = {
      branch: input.branch,
      worktreePath: input.worktreePath,
      envMode: input.envMode,
      ...(input.lastKnownPr !== undefined ? { lastKnownPr: input.lastKnownPr } : {}),
    };
    const storedDraftThread = getDraftThreadByProjectId(activeProject.id);
    if (storedDraftThread) {
      setDraftThreadContext(storedDraftThread.threadId, draftThreadContext);
      setProjectDraftThreadId(activeProject.id, storedDraftThread.threadId, draftThreadContext);
      if (storedDraftThread.threadId !== threadId) {
        await navigate({
          to: "/$threadId",
          params: { threadId: storedDraftThread.threadId },
        });
      }
      return;
    }

    const activeDraftThread = getDraftThread(threadId);
    if (!isServerThread && activeDraftThread?.projectId === activeProject.id) {
      setDraftThreadContext(threadId, draftThreadContext);
      setProjectDraftThreadId(activeProject.id, threadId, draftThreadContext);
      return;
    }

    clearProjectDraftThreadId(activeProject.id);
    const nextThreadId = newThreadId();
    setProjectDraftThreadId(activeProject.id, nextThreadId, {
      ...draftThreadContext,
      createdAt: new Date().toISOString(),
      runtimeMode: DEFAULT_RUNTIME_MODE,
    });
    await navigate({
      to: "/$threadId",
      params: { threadId: nextThreadId },
    });
  };

  const handlePreparedPullRequestThread = async (input: {
    branch: string;
    worktreePath: string | null;
    pullRequest: NonNullable<Thread["lastKnownPr"]>;
  }) => {
    await openOrReuseProjectDraftThread({
      branch: input.branch,
      worktreePath: input.worktreePath,
      envMode: input.worktreePath ? "worktree" : "local",
      lastKnownPr: input.pullRequest,
    });
  };

  useEffect(() => {
    if (!activeThread?.id) return;
    if (!latestTurnSettled) return;
    if (!activeLatestTurn?.completedAt) return;
    const turnCompletedAt = Date.parse(activeLatestTurn.completedAt);
    if (Number.isNaN(turnCompletedAt)) return;
    const lastVisitedAt = activeThread.lastVisitedAt ? Date.parse(activeThread.lastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= turnCompletedAt) return;

    markThreadVisited(activeThread.id);
  }, [
    activeThread?.id,
    activeThread?.lastVisitedAt,
    activeLatestTurn?.completedAt,
    latestTurnSettled,
    markThreadVisited,
  ]);
  return {
    computerControlGeneration,
    computerControlAvailable,
    settledThreadBranchWarningDismissedThreadId,
    setSettledThreadBranchWarningDismissedThreadId,
    settledThreadBranchAtActivation,
    runtimeMode,

    isServerThread,
    isLocalDraftThread,
    canCheckoutPullRequestIntoThread,
    diffOpen,
    browserOpen,
    resolvedDiffOpen,
    onRespondToAsyncUserInput,
    activeThreadId,
    activeLatestTurn,
    activeLatestTurnId,
    activeLatestTurnState,
    threadActivities,
    activeContextWindow,
    activeCumulativeCostUsd,
    activeRateLimitStatus,
    activeRateLimitBannerDismissalKey,
    visibleActiveRateLimitStatus,
    latestTurnSettled,
    latestTurnLive,
    activeProjectId,
    activeProject,
    terminalState,
    terminalFocusRequestId,
    requestTerminalFocus,
    terminalWorkspaceOpen,
    terminalWorkspaceTerminalTabActive,
    terminalWorkspaceChatTabActive,
    setTerminalOpen,
    setTerminalWorkspaceTab,
    setTerminalHeight,
    storeSetTerminalMetadata,
    storeSetTerminalActivity,
    storeOpenTerminalThreadPage,
    toggleTerminalVisibility,
    expandTerminalWorkspace,
    collapseTerminalWorkspace,
    createNewTerminal,
    createTerminalFromShortcut,
    openNewFullWidthTerminal,
    activateTerminal,
    closeTerminal,
    handleTerminalSessionExited,
    closeActiveWorkspaceView,
    homeDir,
    chatWorkspaceRoot,
    renameDialogOpen,
    setRenameDialogOpen,
    isHomeChatContainer,
    isContainerLandingProject,
    activeProjectDisplayName,
    isChatProject,
    threadLineageThreads,
    threadBreadcrumbs,
    resolvedThreadEnvMode,
    resolvedThreadWorktreePath,
    resolvedThreadWorkingDirectory,
    diffEnvironmentPending,
    diffDisabledReason,
    repoDiffBadgeRefreshIntervalMs,
    activeThreadAssociatedWorktree,
    openPullRequestDialog,
    closePullRequestDialog,
    handlePreparedPullRequestThread,
  } as const;
}
