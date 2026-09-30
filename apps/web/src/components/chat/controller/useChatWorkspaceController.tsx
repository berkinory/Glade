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
  createChatTerminalTab,
  expandChatTerminalWorkspace,
  handleChatTerminalSessionExited,
  moveChatTerminalToNewGroup,
  openNewFullWidthChatTerminal,
  setChatTerminalHeight,
  setChatTerminalOpen,
  setChatTerminalWorkspaceTab,
  splitChatTerminal,
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
import { useProjectPreferencesStore } from "~/projectPreferencesStore";
import { hasLiveTurnTailWork, isLatestTurnSettled } from "~/session-logic";
import { useStore } from "~/store";
import { useTerminalStateStore } from "~/terminalStateStore";
import { createProjectSelector } from "~/storeSelectors";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "~/types";
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

  const interactionMode =
    composerDraft.interactionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;

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

  const activeContextWindowState = useMemo(
    () => deriveLatestContextWindowState(threadActivities),
    [threadActivities],
  );

  const activeContextWindow = activeContextWindowState.snapshot;

  const activeCumulativeCostUsd = useMemo(
    () => deriveCumulativeCostUsd(threadActivities),
    [threadActivities],
  );

  const activeRateLimitStatus = useMemo(
    () => deriveLatestRateLimitStatus(threadActivities),
    [threadActivities],
  );

  const activeRateLimitBannerDismissalKey = useMemo(
    () => getRateLimitBannerDismissalKey(activeRateLimitStatus, activeThread?.id ?? null),
    [activeRateLimitStatus, activeThread?.id],
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
  const storeCloseTerminalGroup = useTerminalStateStore((state) => state.closeTerminalGroup);
  const storeResizeTerminalSplit = useTerminalStateStore((state) => state.resizeTerminalSplit);

  const {
    terminalState,
    terminalFocusRequestId,
    requestTerminalFocus,
    terminalWorkspaceOpen,
    terminalWorkspaceTerminalTabActive,
    terminalWorkspaceChatTabActive,
  } = useChatTerminalState({
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
  const setTerminalOpen = useCallback(
    (open: boolean) => setChatTerminalOpen(terminalActionContext, open),
    [terminalActionContext],
  );
  const setTerminalWorkspaceTab = useCallback(
    (tab: "terminal" | "chat") => setChatTerminalWorkspaceTab(terminalActionContext, tab),
    [terminalActionContext],
  );
  const setTerminalHeight = useCallback(
    (height: number) => setChatTerminalHeight(terminalActionContext, height),
    [terminalActionContext],
  );
  const toggleTerminalVisibility = useCallback(
    () => toggleChatTerminalVisibility(terminalActionContext, terminalState),
    [terminalActionContext, terminalState],
  );
  const expandTerminalWorkspace = useCallback(
    () => expandChatTerminalWorkspace(terminalActionContext),
    [terminalActionContext],
  );
  const collapseTerminalWorkspace = useCallback(
    () => collapseChatTerminalWorkspace(terminalActionContext),
    [terminalActionContext],
  );
  const splitTerminalLeft = useCallback(
    () => splitChatTerminal(terminalActionContext, terminalState, "left"),
    [terminalActionContext, terminalState],
  );
  const splitTerminalRight = useCallback(
    () => splitChatTerminal(terminalActionContext, terminalState, "right"),
    [terminalActionContext, terminalState],
  );
  const splitTerminalDown = useCallback(
    () => splitChatTerminal(terminalActionContext, terminalState, "down"),
    [terminalActionContext, terminalState],
  );
  const splitTerminalUp = useCallback(
    () => splitChatTerminal(terminalActionContext, terminalState, "up"),
    [terminalActionContext, terminalState],
  );
  const createNewTerminal = useCallback(
    () => createChatTerminal(terminalActionContext),
    [terminalActionContext],
  );
  const createNewTerminalTab = useCallback(
    (targetId: string) => createChatTerminalTab(terminalActionContext, targetId),
    [terminalActionContext],
  );
  const createTerminalFromShortcut = useCallback(
    () => createChatTerminalFromShortcut(terminalActionContext, terminalState),
    [terminalActionContext, terminalState],
  );
  const moveTerminalToNewGroup = useCallback(
    (terminalId: string) => moveChatTerminalToNewGroup(terminalActionContext, terminalId),
    [terminalActionContext],
  );
  const openNewFullWidthTerminal = useCallback(
    () => openNewFullWidthChatTerminal(terminalActionContext),
    [terminalActionContext],
  );
  const activateTerminal = useCallback(
    (terminalId: string) => activateChatTerminal(terminalActionContext, terminalId),
    [terminalActionContext],
  );
  const closeTerminal = useCallback(
    (terminalId: string) => closeChatTerminal(terminalActionContext, terminalState, terminalId),
    [terminalActionContext, terminalState],
  );
  const handleTerminalSessionExited = useCallback(
    (terminalId: string) =>
      handleChatTerminalSessionExited(terminalActionContext, terminalState, terminalId),
    [terminalActionContext, terminalState],
  );
  const closeActiveWorkspaceView = useCallback(
    () => closeActiveChatTerminalWorkspaceView(terminalActionContext, terminalState),
    [terminalActionContext, terminalState],
  );

  const projectInstructions = useProjectPreferencesStore((state) =>
    activeProjectId ? (state.instructionsByProjectId[activeProjectId] ?? "") : "",
  );

  const setProjectInstructions = useProjectPreferencesStore((state) => state.setInstructions);

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

  const activeProjectScripts =
    activeProject?.kind === "project" ? activeProject.scripts : undefined;

  const threadLineageThreads = useStore(
    useMemo(() => createThreadLineageSelector(activeThread?.id ?? null), [activeThread?.id]),
  );

  const threadBreadcrumbs = useMemo(
    () => buildThreadBreadcrumbs(threadLineageThreads, activeThread),
    [activeThread, threadLineageThreads],
  );

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

  const activeThreadAssociatedWorktree = useMemo(
    () =>
      deriveAssociatedWorktreeMetadata({
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
      }),
    [activeThread],
  );

  const openPullRequestDialog = useCallback(
    (reference?: string) => {
      if (!canCheckoutPullRequestIntoThread) {
        return;
      }
      setPullRequestDialogState({
        initialReference: reference ?? null,
        key: Date.now(),
      });
      setComposerHighlightedItemId(null);
    },
    [setComposerHighlightedItemId, setPullRequestDialogState, canCheckoutPullRequestIntoThread],
  );

  const closePullRequestDialog = useCallback(() => {
    setPullRequestDialogState(null);
  }, [setPullRequestDialogState]);

  const openOrReuseProjectDraftThread = useCallback(
    async (input: {
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
        interactionMode: DEFAULT_INTERACTION_MODE,
      });
      await navigate({
        to: "/$threadId",
        params: { threadId: nextThreadId },
      });
    },
    [
      activeProject,
      clearProjectDraftThreadId,
      getDraftThread,
      getDraftThreadByProjectId,
      isServerThread,
      navigate,
      setDraftThreadContext,
      setProjectDraftThreadId,
      threadId,
    ],
  );

  const handlePreparedPullRequestThread = useCallback(
    async (input: {
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
    },
    [openOrReuseProjectDraftThread],
  );

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
    interactionMode,
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
    storeCloseTerminalGroup,
    storeResizeTerminalSplit,
    toggleTerminalVisibility,
    expandTerminalWorkspace,
    collapseTerminalWorkspace,
    splitTerminalLeft,
    splitTerminalRight,
    splitTerminalDown,
    splitTerminalUp,
    createNewTerminal,
    createNewTerminalTab,
    createTerminalFromShortcut,
    moveTerminalToNewGroup,
    openNewFullWidthTerminal,
    activateTerminal,
    closeTerminal,
    handleTerminalSessionExited,
    closeActiveWorkspaceView,
    projectInstructions,
    setProjectInstructions,
    homeDir,
    chatWorkspaceRoot,
    renameDialogOpen,
    setRenameDialogOpen,
    isHomeChatContainer,
    isContainerLandingProject,
    activeProjectDisplayName,
    isChatProject,
    activeProjectScripts,
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
