import { subscribeThreadVisits } from "./threadVisitPersistence";
import { Fragment, type ReactNode, createElement, useEffect } from "react";
import { type ThreadId } from "@glade/contracts/core/baseSchemas";
import { Debouncer } from "@tanstack/react-pacer";

import { createAppStore } from "./appStore";
import { LOCAL_ENVIRONMENT } from "./environments/environmentKey";
import { registerEnvironmentStore } from "./environments/environmentStores";
import { createMergedAppStore } from "./environments/mergedAppStore";
import { applyThreadUpdate } from "./storeProjection.mutations";
import { persistState, readPersistedState, rememberProjectState } from "./storePersistence";
import { LOCAL_STORE_SIDE_EFFECTS } from "./storeSideEffects";
import { initialState, type AppState } from "./storeState";
import type { Project } from "./types";

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

// The local server's store. Only it persists: SSH hosts' projects and visits are not remembered.
const localStore = createAppStore({
  environmentKey: LOCAL_ENVIRONMENT,
  initialState: readPersistedState(initialState),
  effects: LOCAL_STORE_SIDE_EFFECTS,
  onProjectUiStateChanged: () => persistAppStateNow(),
});
registerEnvironmentStore(LOCAL_ENVIRONMENT, localStore);

export function persistAppStateNow(state: AppState = localStore.getState()): void {
  persistState(state);
}

export const useStore = createMergedAppStore(localStore);

subscribeThreadVisits((visits) => {
  localStore.setState((state) => {
    let next: AppState = state;
    for (const [id, at] of visits) {
      next = applyThreadUpdate(next, id as ThreadId, (thread) =>
        thread.lastVisitedAt === at ? thread : { ...thread, lastVisitedAt: at },
      );
    }
    return next;
  });
});

let lastRememberedProjects: readonly Project[] | undefined;
localStore.subscribe((state) => {
  if (state.projects !== lastRememberedProjects) {
    lastRememberedProjects = state.projects;
    rememberProjectState(state.projects);
  }
  debouncedPersistState.maybeExecute(state);
});

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => persistAppStateNow());
  window.addEventListener("beforeunload", () => {
    persistAppStateNow();
  });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    persistAppStateNow();
  }, []);
  return createElement(Fragment, null, children);
}
