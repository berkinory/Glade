import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { isRecord } from "@glade/shared/transport/payloadValues";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isLocalDesktopActive } from "./environments/activeEnvironment";
import { sanitizeStringKeyedRecord } from "./persistedRecord";

export const WORKSPACE_SIDEBAR_VIEWS = [
  "explorer",
  "git",
  "terminal",
  "browser",
  "pullRequests",
] as const;
export type WorkspaceSidebarView = (typeof WORKSPACE_SIDEBAR_VIEWS)[number];

interface WorkspaceSidebarState {
  readonly open: boolean;
  readonly view: WorkspaceSidebarView;
  readonly leftOpen: boolean;
}

const EMPTY_SIDEBAR: WorkspaceSidebarState = {
  open: false,
  view: "explorer",
  leftOpen: false,
};

interface WorkspaceSidebarStore {
  readonly states: Record<string, WorkspaceSidebarState | undefined>;
  readonly show: (threadId: ThreadId, view: WorkspaceSidebarView) => void;
  readonly toggle: (threadId: ThreadId, view: WorkspaceSidebarView) => void;
  readonly setOpen: (threadId: ThreadId, open: boolean) => void;
  readonly setLeftOpen: (threadId: ThreadId, open: boolean) => void;
}

// The browser hosts native views, so it exists only in the desktop app.
function isAvailable(view: unknown): view is WorkspaceSidebarView {
  return (
    WORKSPACE_SIDEBAR_VIEWS.includes(view as WorkspaceSidebarView) &&
    (view !== "browser" || isLocalDesktopActive())
  );
}

// Each chat keeps its own sidebar choices within this window's session.
export const useWorkspaceSidebarStore = create<WorkspaceSidebarStore>()(
  persist(
    (set) => {
      const update = (
        threadId: ThreadId,
        change: (current: WorkspaceSidebarState) => WorkspaceSidebarState,
      ) =>
        set((store) => ({
          states: {
            ...store.states,
            [threadId]: change(store.states[threadId] ?? EMPTY_SIDEBAR),
          },
        }));
      return {
        states: {},
        show: (threadId, view) => {
          if (isAvailable(view)) update(threadId, (state) => ({ ...state, open: true, view }));
        },
        toggle: (threadId, view) => {
          if (isAvailable(view))
            update(threadId, (state) => ({
              ...state,
              open: !state.open || state.view !== view,
              view,
            }));
        },
        setOpen: (threadId, open) => update(threadId, (state) => ({ ...state, open })),
        setLeftOpen: (threadId, leftOpen) => update(threadId, (state) => ({ ...state, leftOpen })),
      };
    },
    {
      name: "glade:workspace-sidebar:v2",
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ states }) => ({ states }),
      merge: (persisted, current) => ({
        ...current,
        states: sanitizeStringKeyedRecord(isRecord(persisted) ? persisted.states : null, (raw) => {
          if (!isRecord(raw)) return null;
          return {
            open: isAvailable(raw.view) && raw.open === true,
            view: isAvailable(raw.view) ? raw.view : "explorer",
            leftOpen: raw.leftOpen === true,
          };
        }),
      }),
    },
  ),
);

export const selectWorkspaceSidebar =
  (threadId: ThreadId | null) => (store: WorkspaceSidebarStore) =>
    (threadId ? store.states[threadId] : undefined) ?? EMPTY_SIDEBAR;
