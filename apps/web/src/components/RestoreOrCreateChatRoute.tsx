import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SplashScreen } from "./SplashScreen";
import {
  type EmptyRouteRestoreRecoveryState,
  type LastThreadRoute,
  shouldHoldRememberedRouteFallback,
  shouldStartRememberedRouteRecovery,
} from "../chatRouteRestore";
import { readSidebarUiState } from "./Sidebar.uiState";
import {
  refreshEmptyRouteRestoreSnapshot,
  waitForEmptyRouteRestoreFallbackDelay,
} from "../chatRouteRecovery";
import type { StartContainerChatResult } from "../lib/startContainerChat";
import { readNativeApi } from "../nativeApi";
import { useSplitViewStore } from "../splitViewStore";
import { EMPTY_THREAD_IDS, useStore } from "../store";

type RestoreRouteResolverInput = {
  readonly availableSplitViewIds: ReadonlySet<string>;
};

// Resolves which thread route (if any) this surface should restore to. Returning `null` defers to
// `createFreshChat` (e.g. because there is a draft to reopen instead of an existing thread).
export type RestoreRouteResolver = (input: RestoreRouteResolverInput) => LastThreadRoute | null;

export function RestoreOrCreateChatRoute({
  resolveRestoreRoute,
  createFreshChat,
  recoverRememberedRoute = true,
}: {
  readonly resolveRestoreRoute: RestoreRouteResolver;
  readonly createFreshChat: () => Promise<StartContainerChatResult>;

  readonly recoverRememberedRoute?: boolean;
}) {
  const navigate = useNavigate();
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const threadIds = useStore((state) => state.threadIds ?? EMPTY_THREAD_IDS);
  const splitViewsHydrated = useSplitViewStore((state) => state.hasHydrated);
  const splitViewsById = useSplitViewStore((state) => state.splitViewsById);
  const splitViewIds = Object.keys(splitViewsById).filter(
    (splitViewId) => splitViewsById[splitViewId],
  );
  const [attempt, setAttempt] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emptyRestoreRecoveryState, setEmptyRestoreRecoveryState] =
    useState<EmptyRouteRestoreRecoveryState>("idle");
  const mountedRef = useRef(true);
  const emptyRestoreRecoveryRunRef = useRef(0);

  const createFreshChatInFlightRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!(threadIds.length > 0 && emptyRestoreRecoveryState !== "idle")) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      emptyRestoreRecoveryRunRef.current += 1;
      setEmptyRestoreRecoveryState("idle");
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [emptyRestoreRecoveryState, threadIds.length]);

  useEffect(() => {
    if (!threadsHydrated || !splitViewsHydrated) {
      return;
    }

    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      if (cancelled) {
        return;
      }
      setErrorMessage(null);
      const lastThreadRoute = readSidebarUiState().lastThreadRoute;
      if (
        recoverRememberedRoute &&
        shouldStartRememberedRouteRecovery({
          lastThreadRoute,
          availableThreadCount: threadIds.length,
          recoveryState: emptyRestoreRecoveryState,
        })
      ) {
        const recoveryRun = (emptyRestoreRecoveryRunRef.current += 1);
        setEmptyRestoreRecoveryState("pending");
        await Promise.all([
          refreshEmptyRouteRestoreSnapshot(readNativeApi()).catch(() => false),
          waitForEmptyRouteRestoreFallbackDelay(),
        ]);
        if (mountedRef.current && emptyRestoreRecoveryRunRef.current === recoveryRun) {
          setEmptyRestoreRecoveryState("done");
        }
        return;
      }

      if (
        recoverRememberedRoute &&
        shouldHoldRememberedRouteFallback({
          lastThreadRoute,
          availableThreadCount: threadIds.length,
          recoveryState: emptyRestoreRecoveryState,
        })
      ) {
        return;
      }

      const restorableRoute = resolveRestoreRoute({
        availableSplitViewIds: new Set(splitViewIds),
      });
      if (restorableRoute) {
        if (cancelled) {
          return;
        }
        await navigate({
          to: "/$threadId",
          params: { threadId: ThreadId.makeUnsafe(restorableRoute.threadId) },
          replace: true,
          search: () => ({
            splitViewId: restorableRoute.splitViewId,
          }),
        });
        return;
      }

      if (cancelled || createFreshChatInFlightRef.current) {
        return;
      }
      createFreshChatInFlightRef.current = true;

      const result: StartContainerChatResult = await createFreshChat().finally(() => {
        createFreshChatInFlightRef.current = false;
      });
      if (cancelled || result.ok) {
        return;
      }
      setErrorMessage(result.error);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    attempt,
    createFreshChat,
    emptyRestoreRecoveryState,
    navigate,
    recoverRememberedRoute,
    resolveRestoreRoute,
    splitViewIds,
    splitViewsHydrated,
    threadIds.length,
    threadsHydrated,
  ]);

  return (
    <SplashScreen
      errorMessage={errorMessage}
      onRetry={errorMessage ? () => setAttempt((value) => value + 1) : null}
    />
  );
}
