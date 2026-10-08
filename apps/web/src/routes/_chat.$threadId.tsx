import { type ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  type EmptyRouteRestoreRecoveryState,
  shouldHoldMissingThreadRouteFallback,
  shouldStartMissingThreadRouteRecovery,
} from "../chatRouteRestore";
import {
  refreshEmptyRouteRestoreSnapshot,
  waitForEmptyRouteRestoreFallbackDelay,
} from "../chatRouteRecovery";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  remoteEnvironmentsSettled,
  useRemoteEnvironments,
} from "../environments/remoteEnvironments";
import { useActiveThreadEnvironment } from "../environments/threadEnvironment";
import { parseDiffRouteSearch } from "../diffRouteSearch";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { createThreadExistsSelector, createThreadProjectIdSelector } from "../storeSelectors";
import { SingleChatSurface } from "../components/chat/SingleChatSurface";
import { resolveSingleProjectId } from "./-chatThreadRoute.logic";

function ChatThreadRouteView() {
  useRemoteEnvironments();
  const localThreadsHydrated = useStore((store) => store.threadsHydrated);
  const remoteEnvironmentsSettledNow = useStore(() => remoteEnvironmentsSettled());
  const hasKnownServerThreads = useStore((store) => (store.threadIds?.length ?? 0) > 0);
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  useActiveThreadEnvironment(threadId);
  const threadProjectIdSelector = createThreadProjectIdSelector(threadId);
  const threadExistsSelector = createThreadExistsSelector(threadId);
  const threadProjectId: ProjectId | null = useStore(threadProjectIdSelector);
  const threadExists = useStore(threadExistsSelector);
  const draftThreadState = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );
  const draftThreadExists = draftThreadState !== null;
  const routeThreadExists = threadExists || draftThreadExists;
  const activeProjectId = resolveSingleProjectId({
    threadProjectId,
    draftProjectId: draftThreadState?.projectId ?? null,
  });
  const navigate = useNavigate();
  const [missingThreadRecoveryState, setMissingThreadRecoveryState] =
    useState<EmptyRouteRestoreRecoveryState>("idle");
  const mountedRef = useRef(true);
  const missingThreadRecoveryRunRef = useRef(0);

  const recoveryStartedRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Invalidate any in-flight recovery and start a fresh episode for the new thread route. The run
    // bump + guard reset are synchronous (so a stale async completion cannot stamp "done"); the state
    // reset is deferred async setState.
    missingThreadRecoveryRunRef.current += 1;
    recoveryStartedRef.current = false;
    const timer = window.setTimeout(() => setMissingThreadRecoveryState("idle"), 0);
    return () => window.clearTimeout(timer);
  }, [threadId]);

  useEffect(() => {
    if (routeThreadExists && missingThreadRecoveryState !== "idle") {
      missingThreadRecoveryRunRef.current += 1;
      recoveryStartedRef.current = false;
      const timer = window.setTimeout(() => setMissingThreadRecoveryState("idle"), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [missingThreadRecoveryState, routeThreadExists]);

  useEffect(() => {
    // A thread on an SSH host that is still connecting is not missing yet.
    if (!localThreadsHydrated || (!routeThreadExists && !remoteEnvironmentsSettledNow)) {
      return;
    }

    if (!routeThreadExists) {
      if (
        shouldStartMissingThreadRouteRecovery({
          hasKnownServerThreads,
          recoveryState: missingThreadRecoveryState,
          routeThreadExists,
        }) &&
        !recoveryStartedRef.current
      ) {
        recoveryStartedRef.current = true;
        const recoveryRun = (missingThreadRecoveryRunRef.current += 1);

        const pendingTimer = window.setTimeout(() => {
          if (missingThreadRecoveryRunRef.current === recoveryRun) {
            setMissingThreadRecoveryState("pending");
          }
        }, 0);
        void Promise.all([
          refreshEmptyRouteRestoreSnapshot(readNativeApi()).catch(() => false),
          waitForEmptyRouteRestoreFallbackDelay(),
        ]).finally(() => {
          window.clearTimeout(pendingTimer);
          if (mountedRef.current && missingThreadRecoveryRunRef.current === recoveryRun) {
            setMissingThreadRecoveryState("done");
          }
        });
        return;
      }

      if (
        shouldHoldMissingThreadRouteFallback({
          hasKnownServerThreads,
          recoveryState: missingThreadRecoveryState,
          routeThreadExists,
        })
      ) {
        return;
      }
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
    }
  }, [
    hasKnownServerThreads,
    missingThreadRecoveryState,
    localThreadsHydrated,
    navigate,
    remoteEnvironmentsSettledNow,
    routeThreadExists,
  ]);

  if (
    !localThreadsHydrated ||
    (!routeThreadExists && !remoteEnvironmentsSettledNow) ||
    shouldHoldMissingThreadRouteFallback({
      hasKnownServerThreads,
      recoveryState: missingThreadRecoveryState,
      routeThreadExists,
    })
  ) {
    return null;
  }

  if (!routeThreadExists) {
    return null;
  }

  return <SingleChatSurface threadId={threadId} search={search} projectId={activeProjectId} />;
}

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  component: ChatThreadRouteView,
});
