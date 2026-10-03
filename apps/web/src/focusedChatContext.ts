import { type ThreadId as ThreadIdType } from "@glade/contracts/core/baseSchemas";
import { useMemo } from "react";
import { useCommittedChatRoute } from "./hooks/useCommittedChatRoute";
import type { DraftThreadState } from "./composerDraftDomain";
import { useComposerDraftStore } from "./composerDraftStore";
import { useDiffRouteSearch } from "./hooks/useDiffRouteSearch";
import {
  resolveSplitViewFocusedPaneThreadId,
  selectSplitView,
  useSplitViewStore,
} from "./splitViewStore";
import { type SplitView } from "./splitViewModel";
import { useStore } from "./store";
import { createProjectSelector } from "./storeSelectors";
import type { Project, Thread } from "./types";
import type { AppState } from "./storeState";
import { shallow } from "zustand/shallow";

type FocusedThreadMetadata = Pick<
  Thread,
  | "id"
  | "projectId"
  | "modelSelection"
  | "envMode"
  | "runtimeMode"
  | "worktreePath"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "error"
> & {
  sessionStatus: NonNullable<Thread["session"]>["status"] | null;
  latestTurnState: NonNullable<Thread["latestTurn"]>["state"] | null;
  messageCount: number;
  activityCount: number;
};

function createFocusedThreadSelector(threadId: ThreadIdType | null) {
  let previous: FocusedThreadMetadata | undefined;
  return (state: AppState): FocusedThreadMetadata | undefined => {
    const thread = threadId ? state.threadShellById?.[threadId] : undefined;
    if (!thread || !threadId) return undefined;
    const next: FocusedThreadMetadata = {
      id: thread.id,
      projectId: thread.projectId,
      modelSelection: thread.modelSelection,
      envMode: thread.envMode,
      runtimeMode: thread.runtimeMode,
      worktreePath: thread.worktreePath,
      hasPendingApprovals: thread.hasPendingApprovals === true,
      hasPendingUserInput: thread.hasPendingUserInput === true,
      error: thread.error,
      sessionStatus: state.threadSessionById?.[threadId]?.status ?? null,
      latestTurnState: state.threadTurnStateById?.[threadId]?.latestTurn?.state ?? null,
      messageCount: state.messageIdsByThreadId?.[threadId]?.length ?? 0,
      activityCount: state.activityIdsByThreadId?.[threadId]?.length ?? 0,
    };
    if (previous && shallow(previous, next)) return previous;
    previous = next;
    return next;
  };
}

export interface FocusedChatContext {
  routeThreadId: ThreadIdType | null;
  splitView: SplitView | null;
  focusedThreadId: ThreadIdType | null;
  activeThread: FocusedThreadMetadata | null;
  activeDraftThread: DraftThreadState | null;
  activeProject: Project | null;
  activeProjectId: Project["id"] | null;
}

export function useFocusedChatContext(): FocusedChatContext {
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const { threadId: routeThreadId } = useCommittedChatRoute();
  const routeSearch = useDiffRouteSearch();
  const activeSplitView = useSplitViewStore(
    useMemo(() => selectSplitView(routeSearch.splitViewId ?? null), [routeSearch.splitViewId]),
  );
  const focusedThreadId = activeSplitView
    ? resolveSplitViewFocusedPaneThreadId(activeSplitView)
    : routeThreadId;
  const activeThread = useStore(
    useMemo(() => createFocusedThreadSelector(focusedThreadId), [focusedThreadId]),
  );
  const activeDraftThread =
    focusedThreadId !== null ? (draftThreadsByThreadId[focusedThreadId] ?? null) : null;
  const activeProjectId =
    activeDraftThread?.projectId ??
    activeThread?.projectId ??
    activeSplitView?.ownerProjectId ??
    null;
  const activeProject = useStore(
    useMemo(() => createProjectSelector(activeProjectId), [activeProjectId]),
  );

  return {
    routeThreadId,
    splitView: activeSplitView,
    focusedThreadId,
    activeThread: activeThread ?? null,
    activeDraftThread,
    activeProject: activeProject ?? null,
    activeProjectId,
  };
}
