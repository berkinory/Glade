import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useComputerEventBridge } from "../hooks/useComputerEventBridge";
import { useDeviceEventBridge } from "../hooks/useDeviceEventBridge";
import { useDiffRouteSearch } from "../hooks/useDiffRouteSearch";
import { readNativeApi } from "../nativeApi";
import { resolveSplitViewThreadIds, selectSplitView, useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";
import { arraysShallowEqual } from "../storeNormalization.shared";
import { EMPTY_THREAD_IDS } from "../storeState";
import { useTerminalStateStore } from "../terminalStateStore";
import {
  resolveThreadDetailSubscriptionLeaseIds,
  setVisibleThreadDetailIds,
  useRetainedThreadDetailIds,
} from "../threadDetailSubscriptionRetention";
import { useWorkspacePathsStore } from "../workspacePathsStore";
import { createStreamRuntime } from "./-streamRuntime";
export function EventRouter() {
  useDeviceEventBridge();
  useComputerEventBridge();
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);
  const syncServerThreadDetailHotPath = useStore((store) => store.syncServerThreadDetailHotPath);
  const applyShellEvent = useStore((store) => store.applyShellEvent);
  const applyOrchestrationEventsHotPath = useStore(
    (store) => store.applyOrchestrationEventsHotPath,
  );
  const setProjectExpanded = useStore((store) => store.setProjectExpanded);
  const removeOrphanedTerminalStates = useTerminalStateStore(
    (store) => store.removeOrphanedTerminalStates,
  );
  const setServerWorkspacePaths = useWorkspacePathsStore((store) => store.setServerWorkspacePaths);
  const serverThreadIds = useStore((store) => store.threadIds ?? EMPTY_THREAD_IDS);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const routeSearch = useDiffRouteSearch();
  const activeSplitView = useSplitViewStore(
    useMemo(() => selectSplitView(routeSearch.splitViewId ?? null), [routeSearch.splitViewId]),
  );
  const hostThreadIds = useMemo(
    () =>
      activeSplitView
        ? resolveSplitViewThreadIds(activeSplitView)
        : routeThreadId
          ? [routeThreadId]
          : [],
    [activeSplitView, routeThreadId],
  );
  const retainedThreadIds = useRetainedThreadDetailIds();
  const serverThreadIdSet = useMemo(() => new Set(serverThreadIds), [serverThreadIds]);

  const nextSubscribedThreadIds = resolveThreadDetailSubscriptionLeaseIds({
    visibleThreadIds: hostThreadIds,
    retainedThreadIds,
    serverThreadIds: serverThreadIdSet,
  });
  const subscribedThreadIdsRef = useRef(nextSubscribedThreadIds);
  const subscribedThreadIds = arraysShallowEqual(
    subscribedThreadIdsRef.current,
    nextSubscribedThreadIds,
  )
    ? subscribedThreadIdsRef.current
    : nextSubscribedThreadIds;
  const pathnameRef = useRef(pathname);
  const handledBootstrapThreadIdRef = useRef<string | null>(null);
  const visibleThreadIdsRef = useRef(subscribedThreadIds);
  const reconcileThreadSubscriptionsRef = useRef<
    ((threadIds: readonly ThreadId[]) => Promise<void>) | null
  >(null);

  useEffect(() => {
    pathnameRef.current = pathname;
    visibleThreadIdsRef.current = subscribedThreadIds;
    subscribedThreadIdsRef.current = subscribedThreadIds;

    setVisibleThreadDetailIds(hostThreadIds);
  }, [pathname, subscribedThreadIds, hostThreadIds]);

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    return createStreamRuntime({
      api,
      syncServerShellSnapshot,
      syncServerThreadDetailHotPath,
      applyShellEvent,
      applyOrchestrationEventsHotPath,
      setProjectExpanded,
      removeOrphanedTerminalStates,
      setServerWorkspacePaths,
      queryClient,
      navigate,
      pathnameRef,
      handledBootstrapThreadIdRef,
      visibleThreadIdsRef,
      reconcileThreadSubscriptionsRef,
    });
  }, [
    applyOrchestrationEventsHotPath,
    applyShellEvent,
    navigate,
    queryClient,
    removeOrphanedTerminalStates,
    setProjectExpanded,
    setServerWorkspacePaths,
    syncServerShellSnapshot,
    syncServerThreadDetailHotPath,
  ]);

  useLayoutEffect(() => {
    const reconcile = reconcileThreadSubscriptionsRef.current;
    if (!reconcile) {
      return;
    }
    void reconcile(subscribedThreadIds);
  }, [subscribedThreadIds]);

  return null;
}
