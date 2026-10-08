import { useCommittedChatRoute } from "../hooks/useCommittedChatRoute";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStore as useZustandStore, type StoreApi } from "zustand";
import type { AppStore } from "../appStore";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "../environments/environmentKey";
import { useComposerDraftStore } from "../composerDraftStore";
import { environmentOfProject, environmentOfThread } from "../environments/environmentStores";
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
import type { EnvironmentNativeApi } from "../wsNativeApi";
import { createStreamRuntime } from "./-streamRuntime";

type EnvironmentStreamConnection = Pick<
  EnvironmentNativeApi,
  "api" | "onWelcome" | "onThreadStreamFailure"
>;

// Streams one environment's shell and thread details into that environment's store.
export function EnvironmentEventRouter(props: {
  readonly environmentKey: EnvironmentKey;
  readonly connection: EnvironmentStreamConnection;
  readonly store: StoreApi<AppStore>;
}) {
  const { environmentKey, connection, store } = props;
  const local = environmentKey === LOCAL_ENVIRONMENT;
  const removeOrphanedTerminalStates = useTerminalStateStore(
    (state) => state.removeOrphanedTerminalStates,
  );
  const setServerWorkspacePaths = useWorkspacePathsStore((state) => state.setServerWorkspacePaths);
  const serverThreadIds = useZustandStore(store, (state) => state.threadIds ?? EMPTY_THREAD_IDS);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname, threadId: routeThreadId } = useCommittedChatRoute();

  // The route thread is leased by the environment that owns it. A draft is not in any store yet, so
  // it belongs to its project's environment; anything else unknown falls to the local server.
  const routeDraftProjectId = useComposerDraftStore((state) =>
    routeThreadId ? state.draftThreadsByThreadId[routeThreadId]?.projectId : undefined,
  );
  const routeThreadOwner = useStore(() =>
    routeThreadId
      ? (environmentOfThread(routeThreadId) ??
        (routeDraftProjectId ? environmentOfProject(routeDraftProjectId) : null))
      : null,
  );
  const hostThreadIds = useMemo(
    () =>
      routeThreadId && (routeThreadOwner === environmentKey || (local && routeThreadOwner === null))
        ? [routeThreadId]
        : [],
    [environmentKey, local, routeThreadId, routeThreadOwner],
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

    if (local && routeThreadId) setVisibleThreadDetailIds([routeThreadId]);
    else if (local) setVisibleThreadDetailIds([]);
  }, [local, pathname, routeThreadId, subscribedThreadIds]);

  useEffect(() => {
    const actions = store.getState();
    return createStreamRuntime({
      local,
      api: connection.api,
      onWelcome: connection.onWelcome,
      onThreadStreamFailure: connection.onThreadStreamFailure,
      store,
      syncServerShellSnapshot: actions.syncServerShellSnapshot,
      syncServerThreadDetailHotPath: actions.syncServerThreadDetailHotPath,
      applyShellEvent: actions.applyShellEvent,
      applyOrchestrationEventsHotPath: actions.applyOrchestrationEventsHotPath,
      setProjectExpanded: actions.setProjectExpanded,
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
    connection,
    local,
    navigate,
    queryClient,
    removeOrphanedTerminalStates,
    setServerWorkspacePaths,
    store,
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
