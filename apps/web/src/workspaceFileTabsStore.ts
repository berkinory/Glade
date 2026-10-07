import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { isRecord } from "@glade/shared/transport/payloadValues";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useMainWorkspaceStore } from "./mainWorkspaceStore";
import { sanitizeStringKeyedRecord } from "./persistedRecord";

// The storage key and persisted field keep their right dock names so stored tabs survive.
const WORKSPACE_FILE_TABS_STORAGE_KEY = "glade:right-dock-state:v1";

export type SourceControlView = "changes" | "history";

// Per-thread workspace file tabs and the Source Control subview. Which right sidebar view is open
// lives in the per-window workspace sidebar store.
interface WorkspaceFileTabs {
  filePaths: string[];
  activeFilePath: string | null;
  previewFilePath?: string | null;
  sourceControlView: SourceControlView;
}

interface WorkspaceFileTabsStore {
  tabsByThreadId: Record<string, WorkspaceFileTabs | undefined>;
  setSourceControlView: (threadId: ThreadId, view: SourceControlView) => void;
  openFile: (threadId: ThreadId, path: string, options?: { preview?: boolean }) => void;
  pinFile: (threadId: ThreadId, path: string) => void;
  closeFile: (threadId: ThreadId, path: string) => void;
}

const DEFAULT_WORKSPACE_FILE_TABS: WorkspaceFileTabs = {
  filePaths: [],
  activeFilePath: null,
  sourceControlView: "changes",
};
Object.freeze(DEFAULT_WORKSPACE_FILE_TABS);
Object.freeze(DEFAULT_WORKSPACE_FILE_TABS.filePaths);

const isFilePath = (path: unknown): path is string => typeof path === "string" && path.length > 0;

function sanitizeWorkspaceFileTabs(value: unknown): WorkspaceFileTabs | null {
  if (!isRecord(value)) return null;
  // Files were once dock panes; those older states still carry them under `panes`.
  const legacyFiles = (Array.isArray(value.panes) ? value.panes : [])
    .filter(isRecord)
    .filter((pane) => pane.kind === "file");
  const filePaths = [
    ...new Set([
      ...(Array.isArray(value.filePaths) ? value.filePaths.filter(isFilePath) : []),
      ...legacyFiles.map((pane) => pane.filePath).filter(isFilePath),
    ]),
  ];
  const legacyActiveFile = legacyFiles.find((pane) => pane.id === value.activePaneId)?.filePath;
  const requestedActiveFile = isFilePath(legacyActiveFile)
    ? legacyActiveFile
    : value.activeFilePath;
  return {
    filePaths,
    activeFilePath:
      isFilePath(requestedActiveFile) && filePaths.includes(requestedActiveFile)
        ? requestedActiveFile
        : (filePaths[0] ?? null),
    ...(isFilePath(value.previewFilePath) && filePaths.includes(value.previewFilePath)
      ? { previewFilePath: value.previewFilePath }
      : {}),
    sourceControlView: value.sourceControlView === "history" ? "history" : "changes",
  };
}

function commit(
  set: (fn: (store: WorkspaceFileTabsStore) => Partial<WorkspaceFileTabsStore>) => void,
  threadId: ThreadId,
  transform: (state: WorkspaceFileTabs) => WorkspaceFileTabs,
): void {
  set((store) => {
    const previous = store.tabsByThreadId[threadId] ?? DEFAULT_WORKSPACE_FILE_TABS;
    const next = transform(previous);
    if (next === previous) {
      return {};
    }
    return {
      tabsByThreadId: {
        ...store.tabsByThreadId,
        [threadId]: next,
      },
    };
  });
}

export const useWorkspaceFileTabsStore = create<WorkspaceFileTabsStore>()(
  persist(
    (set) => ({
      tabsByThreadId: {},
      setSourceControlView: (threadId, sourceControlView) =>
        commit(set, threadId, (state) =>
          state.sourceControlView === sourceControlView ? state : { ...state, sourceControlView },
        ),
      openFile: (threadId, path, options) => {
        const workspace = useMainWorkspaceStore.getState();
        const previewReviewId = workspace.states[threadId]?.previewReviewId;
        const fileTabs = useWorkspaceFileTabsStore.getState().tabsByThreadId[threadId];
        const replacesPreview =
          !fileTabs?.filePaths.includes(path) || fileTabs.previewFilePath === path;
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
    }),
    {
      name: WORKSPACE_FILE_TABS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ tabsByThreadId }) => ({ dockStateByThreadId: tabsByThreadId }),
      merge: (persisted, current) => ({
        ...current,
        tabsByThreadId: sanitizeStringKeyedRecord(
          (persisted as { dockStateByThreadId?: unknown } | undefined)?.dockStateByThreadId,
          sanitizeWorkspaceFileTabs,
        ),
      }),
    },
  ),
);

export function selectWorkspaceFileTabs(threadId: ThreadId | null) {
  return (store: WorkspaceFileTabsStore) =>
    (threadId ? store.tabsByThreadId[threadId] : undefined) ?? DEFAULT_WORKSPACE_FILE_TABS;
}
