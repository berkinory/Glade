import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useMainWorkspaceStore } from "./mainWorkspaceStore";
import { randomUUID } from "./lib/utils";
import {
  type OpenPaneInput,
  type RightDockPane,
  type RightDockThreadState,
  closePaneInState,
  createDefaultRightDockState,
  openPaneInState,
  sanitizeRightDockStateByThreadId,
  setActivePaneInState,
  setDockOpenInState,
  toggleSingletonPaneInState,
  updatePaneInState,
} from "./rightDockStore.logic";

const RIGHT_DOCK_STORAGE_KEY = "glade:right-dock-state:v1";

interface RightDockStore {
  dockStateByThreadId: Record<string, RightDockThreadState | undefined>;
  openPane: (
    threadId: ThreadId,
    input: Omit<OpenPaneInput, "paneId"> & { paneId?: string; activate?: boolean },
  ) => void;
  toggleSingletonPane: (
    threadId: ThreadId,
    input: Omit<OpenPaneInput, "paneId"> & { paneId?: string },
  ) => void;
  closePane: (threadId: ThreadId, paneId: string) => void;
  setActivePane: (threadId: ThreadId, paneId: string) => void;
  setDockOpen: (threadId: ThreadId, open: boolean) => void;
  updatePane: (
    threadId: ThreadId,
    paneId: string,
    patch: Partial<Pick<RightDockPane, "sourceControlView" | "diffTurnId" | "diffFilePath">>,
  ) => void;
  openFile: (threadId: ThreadId, path: string, options?: { preview?: boolean }) => void;
  pinFile: (threadId: ThreadId, path: string) => void;
  closeFile: (threadId: ThreadId, path: string) => void;
  clearThreadDockState: (threadId: ThreadId) => void;
}

const DEFAULT_RIGHT_DOCK_STATE = createDefaultRightDockState();
Object.freeze(DEFAULT_RIGHT_DOCK_STATE);
Object.freeze(DEFAULT_RIGHT_DOCK_STATE.panes);
Object.freeze(DEFAULT_RIGHT_DOCK_STATE.filePaths);

function commit(
  set: (fn: (store: RightDockStore) => Partial<RightDockStore>) => void,
  threadId: ThreadId,
  transform: (state: RightDockThreadState) => RightDockThreadState,
): void {
  set((store) => {
    const previous = store.dockStateByThreadId[threadId] ?? DEFAULT_RIGHT_DOCK_STATE;
    const next = transform(previous);
    if (next === previous) {
      return {};
    }
    return {
      dockStateByThreadId: {
        ...store.dockStateByThreadId,
        [threadId]: next,
      },
    };
  });
}

export const useRightDockStore = create<RightDockStore>()(
  persist(
    (set) => ({
      dockStateByThreadId: {},
      openPane: (threadId, input) =>
        commit(set, threadId, (state) => {
          const next = openPaneInState(state, { ...input, paneId: input.paneId ?? randomUUID() });
          return input.activate === false
            ? { ...next, open: state.open, activePaneId: state.activePaneId }
            : next;
        }),
      toggleSingletonPane: (threadId, input) =>
        commit(set, threadId, (state) =>
          toggleSingletonPaneInState(state, { ...input, paneId: input.paneId ?? randomUUID() }),
        ),
      closePane: (threadId, paneId) =>
        commit(set, threadId, (state) => closePaneInState(state, paneId)),
      setActivePane: (threadId, paneId) =>
        commit(set, threadId, (state) => setActivePaneInState(state, paneId)),
      setDockOpen: (threadId, open) =>
        commit(set, threadId, (state) => setDockOpenInState(state, open)),
      updatePane: (threadId, paneId, patch) =>
        commit(set, threadId, (state) => updatePaneInState(state, paneId, patch)),
      openFile: (threadId, path, options) => {
        const workspace = useMainWorkspaceStore.getState();
        const previewReviewId = workspace.states[threadId]?.previewReviewId;
        const dock = useRightDockStore.getState().dockStateByThreadId[threadId];
        const replacesPreview = !dock?.filePaths.includes(path) || dock.previewFilePath === path;
        if (options?.preview && replacesPreview && previewReviewId)
          workspace.closeReview(threadId, previewReviewId);
        commit(set, threadId, (state) => {
          const existing = state.filePaths.includes(path);
          if (options?.preview && (!existing || state.previewFilePath === path)) {
            const previousIndex = state.previewFilePath
              ? state.filePaths.indexOf(state.previewFilePath)
              : -1;
            const filePaths = state.filePaths.filter(
              (file) => file !== state.previewFilePath && file !== path,
            );
            filePaths.splice(previousIndex < 0 ? filePaths.length : previousIndex, 0, path);
            return { ...state, filePaths, activeFilePath: path, previewFilePath: path };
          }
          return {
            ...state,
            filePaths: existing ? state.filePaths : [...state.filePaths, path],
            activeFilePath: path,
            ...(state.previewFilePath === path ? { previewFilePath: null } : {}),
          };
        });
        useMainWorkspaceStore.getState().selectTab(threadId, `file:${path}`);
      },
      pinFile: (threadId, path) =>
        commit(set, threadId, (state) =>
          state.previewFilePath === path ? { ...state, previewFilePath: null } : state,
        ),
      closeFile: (threadId, path) =>
        commit(set, threadId, (state) => {
          const index = state.filePaths.indexOf(path);
          if (index === -1) return state;
          const filePaths = state.filePaths.filter((file) => file !== path);
          return {
            ...state,
            filePaths,
            ...(state.previewFilePath === path ? { previewFilePath: null } : {}),
            activeFilePath:
              state.activeFilePath === path
                ? (filePaths[Math.min(index, filePaths.length - 1)] ?? null)
                : state.activeFilePath,
          };
        }),
      clearThreadDockState: (threadId) => {
        useMainWorkspaceStore.getState().clearThread(threadId);
        set((store) => {
          if (!Object.hasOwn(store.dockStateByThreadId, threadId)) {
            return {};
          }
          const next = { ...store.dockStateByThreadId };
          delete next[threadId];
          return { dockStateByThreadId: next };
        });
      },
    }),
    {
      name: RIGHT_DOCK_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Validate persisted panes on rehydrate so a stale/unknown pane kind from an older app version can
      // never crash the dock during render.
      merge: (persisted, current) => ({
        ...current,
        dockStateByThreadId: sanitizeRightDockStateByThreadId(
          (persisted as { dockStateByThreadId?: unknown } | undefined)?.dockStateByThreadId,
        ),
      }),
    },
  ),
);

export function selectRightDockState(threadId: ThreadId | null) {
  return (store: RightDockStore) =>
    (threadId ? store.dockStateByThreadId[threadId] : undefined) ?? DEFAULT_RIGHT_DOCK_STATE;
}
