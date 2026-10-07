import { useCommittedChatRoute } from "./useCommittedChatRoute";
import { useCallback } from "react";

import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ResolvedTerminalVisualIdentity } from "@glade/shared/threads/terminalThreads";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { useSidebarStateStore } from "../sidebarStateStore";
import {
  buildRecentViewDisplayEntries,
  deriveCurrentRecentView,
  pruneRecentViews,
  recentViewKey,
  resolveRecentViewNavigationIndex,
  type RecentView,
  type RecentViewAvailability,
  type RecentViewDisplayEntry,
  type RecentViewThreadDraftSummary,
} from "../recentViews.logic";
import { useStore } from "../store";
import { useThreadDetailPrewarm } from "../threadDetailPrewarm";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import {
  resolveTerminalVisualIdentityMap,
  selectRepresentativeTerminalVisualIdentity,
} from "../terminalVisualIdentity";
import type { useHandleNewThread } from "./useHandleNewThread";

type NewThreadContext = ReturnType<typeof useHandleNewThread>;

const EMPTY_RECENT_VIEW_ENTRIES: RecentViewDisplayEntry[] = [];

interface RecentViewSwitcherState {
  selectedIndex: number;
  selectedKey: string;
}

interface UseRecentViewSwitcherInput {
  activeContextThreadId: NewThreadContext["activeContextThreadId"];
  activeDraftThread: NewThreadContext["activeDraftThread"];
  projects: NewThreadContext["projects"];
}

export function useRecentViewSwitcher(input: UseRecentViewSwitcherInput) {
  const navigate = useNavigate();
  const { pathname, threadId: routeThreadId, search: routeSearch } = useCommittedChatRoute();

  const [recentSwitcherState, setRecentSwitcherState] = useState<RecentViewSwitcherState | null>(
    null,
  );
  const recentViews = useSidebarStateStore((state) => state.recentViews);
  const recordRecentView = useSidebarStateStore((state) => state.recordRecentView);
  const pruneRecentViewsStore = useSidebarStateStore((state) => state.pruneRecentViews);
  const { prewarmThreadDetail, prewarmThreadDetails } = useThreadDetailPrewarm();
  const persistedPinnedThreadIds = useSidebarStateStore((state) => state.pinnedThreadIds);
  const draftThreadsByThreadId = useComposerDraftStore((state) => state.draftThreadsByThreadId);
  const sidebarThreadSummaryById = useStore((state) => state.sidebarThreadSummaryById);
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const openChatThreadPage = useTerminalStateStore((state) => state.openChatThreadPage);
  const openTerminalThreadPage = useTerminalStateStore((state) => state.openTerminalThreadPage);
  const threadsHydrated = useStore((state) => state.threadsHydrated);
  const settingsSection = typeof routeSearch.section === "string" ? routeSearch.section : undefined;
  const currentRecentView = deriveCurrentRecentView({
    pathname,
    routeThreadId,
    activeThreadId: routeThreadId ? (input.activeContextThreadId ?? routeThreadId) : null,
    settingsSection,
  });
  const currentRecentViewKey = currentRecentView ? recentViewKey(currentRecentView) : null;
  const recentThreadIds = recentViews.flatMap((view) =>
    view.kind === "thread" ? [view.threadId] : [],
  );
  const switcherOpen = recentSwitcherState !== null;
  let recentViewEntries: RecentViewDisplayEntry[] = EMPTY_RECENT_VIEW_ENTRIES;
  if (switcherOpen) {
    const terminalVisualIdentityByThreadId = new Map<ThreadId, ResolvedTerminalVisualIdentity>();
    for (const view of recentViews) {
      if (view.kind !== "thread") continue;
      const terminalState = selectThreadTerminalState(terminalStateByThreadId, view.threadId);
      if (terminalState.entryPoint === "terminal") {
        const terminalVisualIdentityById = resolveTerminalVisualIdentityMap({
          runningTerminalIds: terminalState.runningTerminalIds,
          terminalAttentionStatesById: terminalState.terminalAttentionStatesById,
          terminalCliKindsById: terminalState.terminalCliKindsById,
          terminalIds: terminalState.terminalIds,
          terminalLabelsById: terminalState.terminalLabelsById,
          terminalTitleOverridesById: terminalState.terminalTitleOverridesById,
        });
        const representativeIdentity = selectRepresentativeTerminalVisualIdentity({
          activeTerminalId: terminalState.activeTerminalId,
          terminalIds: terminalState.terminalIds,
          terminalVisualIdentityById,
        });
        if (representativeIdentity) {
          terminalVisualIdentityByThreadId.set(view.threadId, representativeIdentity.identity);
        }
      }
    }
    const draftThreadsById: Record<string, RecentViewThreadDraftSummary> = {};
    for (const [threadId, draftThread] of Object.entries(draftThreadsByThreadId)) {
      draftThreadsById[threadId] = {
        id: ThreadId.makeUnsafe(threadId),
        projectId: draftThread.projectId,
      };
    }
    if (input.activeDraftThread && input.activeContextThreadId) {
      draftThreadsById[input.activeContextThreadId] = {
        id: input.activeContextThreadId,
        projectId: input.activeDraftThread.projectId,
      };
    }
    recentViewEntries = buildRecentViewDisplayEntries({
      recentViews,
      currentView: currentRecentView,
      threadsById: sidebarThreadSummaryById,
      draftThreadsById,
      projects: input.projects,
      pinnedThreadIds: persistedPinnedThreadIds,
      terminalVisualIdentityByThreadId,
    });
  }
  const currentRecentViewRef = useRef<RecentView | null>(currentRecentView);
  const recentSwitcherStateRef = useRef<RecentViewSwitcherState | null>(recentSwitcherState);
  const recentViewsRef = useRef(recentViews);
  const activeContextThreadIdRef = useRef(input.activeContextThreadId);
  const activeDraftThreadRef = useRef(input.activeDraftThread);
  const didHydrationPruneRef = useRef(false);

  useEffect(() => {
    currentRecentViewRef.current = currentRecentView;
  }, [currentRecentView]);

  useEffect(() => {
    recentSwitcherStateRef.current = recentSwitcherState;
  }, [recentSwitcherState]);

  useEffect(() => {
    recentViewsRef.current = recentViews;
  }, [recentViews]);

  useEffect(() => {
    activeContextThreadIdRef.current = input.activeContextThreadId;
  }, [input.activeContextThreadId]);

  useEffect(() => {
    activeDraftThreadRef.current = input.activeDraftThread;
  }, [input.activeDraftThread]);

  const buildRecentViewAvailability = useCallback((): RecentViewAvailability => {
    const sidebarThreadSummaryById = useStore.getState().sidebarThreadSummaryById;
    const draftThreadsByThreadId = useComposerDraftStore.getState().draftThreadsByThreadId;
    const activeContextThreadId = activeContextThreadIdRef.current;
    const activeDraftThread = activeDraftThreadRef.current;

    const availableThreadIds = new Set<ThreadId>();
    for (const [threadId, thread] of Object.entries(sidebarThreadSummaryById)) {
      if (thread) availableThreadIds.add(ThreadId.makeUnsafe(threadId));
    }
    for (const threadId of Object.keys(draftThreadsByThreadId)) {
      availableThreadIds.add(ThreadId.makeUnsafe(threadId));
    }
    if (activeDraftThread && activeContextThreadId) {
      availableThreadIds.add(activeContextThreadId);
    }

    return { availableThreadIds };
  }, []);

  useEffect(() => {
    if (!currentRecentView) return;
    recordRecentView(currentRecentView);
  }, [currentRecentView, currentRecentViewKey, recordRecentView]);

  useEffect(() => {
    prewarmThreadDetails(recentThreadIds);
  }, [prewarmThreadDetails, recentThreadIds]);

  useEffect(() => {
    if (!threadsHydrated || didHydrationPruneRef.current) return;
    didHydrationPruneRef.current = true;
    pruneRecentViewsStore(buildRecentViewAvailability());
  }, [buildRecentViewAvailability, pruneRecentViewsStore, threadsHydrated]);

  const activateRecentView = useCallback(
    (view: RecentView) => {
      switch (view.kind) {
        case "thread": {
          if (!buildRecentViewAvailability().availableThreadIds.has(view.threadId)) {
            return;
          }
          prewarmThreadDetail(view.threadId);
          const terminalState = selectThreadTerminalState(
            useTerminalStateStore.getState().terminalStateByThreadId,
            view.threadId,
          );
          if (terminalState.entryPoint === "terminal") {
            openTerminalThreadPage(view.threadId);
          } else {
            openChatThreadPage(view.threadId);
          }
          void navigate({
            to: "/$threadId",
            params: { threadId: view.threadId },
            search: () => ({}),
          });
          return;
        }
        case "settings":
          void navigate({
            to: "/settings",
            search: () => (view.section ? { section: view.section } : {}),
          });
          return;
        case "plugins":
          void navigate({ to: "/plugins" });
          return;
      }
    },
    [
      buildRecentViewAvailability,
      prewarmThreadDetail,
      navigate,
      openChatThreadPage,
      openTerminalThreadPage,
    ],
  );

  const commitRecentSwitcherSelection = useCallback(() => {
    const state = recentSwitcherStateRef.current;
    if (!state) return;
    const views = recentViewsRef.current;
    const view =
      views.find((candidate) => recentViewKey(candidate) === state.selectedKey) ??
      views[state.selectedIndex];
    setRecentSwitcherState(null);
    if (!view) return;
    activateRecentView(view);
  }, [activateRecentView]);

  const cancelRecentSwitcher = () => {
    setRecentSwitcherState(null);
  };

  const openOrAdvanceRecentSwitcher = (direction: "next" | "previous") => {
    const currentState = recentSwitcherStateRef.current;
    let views = recentViewsRef.current;
    if (currentState === null) {
      const availability = buildRecentViewAvailability();
      pruneRecentViewsStore(availability);
      views = pruneRecentViews(views, availability);
    }
    const selectedIndex = resolveRecentViewNavigationIndex({
      recentViews: views,
      currentView: currentRecentViewRef.current,
      selectedKey: currentState?.selectedKey,
      direction,
    });

    if (selectedIndex === null) {
      return false;
    }

    const selectedView = views[selectedIndex];
    if (!selectedView) {
      return false;
    }

    if (selectedView.kind === "thread") {
      prewarmThreadDetail(selectedView.threadId);
    }

    setRecentSwitcherState({
      selectedIndex,
      selectedKey: recentViewKey(selectedView),
    });
    return true;
  };

  useEffect(() => {
    const onWindowKeyUp = (event: KeyboardEvent) => {
      if (!recentSwitcherStateRef.current || event.ctrlKey) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      commitRecentSwitcherSelection();
    };
    const onWindowBlur = () => {
      commitRecentSwitcherSelection();
    };

    window.addEventListener("keyup", onWindowKeyUp, { capture: true });
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keyup", onWindowKeyUp, { capture: true });
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [commitRecentSwitcherSelection]);

  return {
    recentSwitcherState,
    recentViewEntries,
    openOrAdvanceRecentSwitcher,
    commitRecentSwitcherSelection,
    cancelRecentSwitcher,
  };
}
