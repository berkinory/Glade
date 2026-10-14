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
  readonly width: number | null;
}

const EMPTY_SIDEBAR: WorkspaceSidebarState = {
  open: false,
  view: "explorer",
  width: null,
};

interface WorkspaceSidebarStore {
  readonly states: Record<string, WorkspaceSidebarState | undefined>;
  readonly show: (threadId: ThreadId, view: WorkspaceSidebarView) => void;
  readonly toggle: (threadId: ThreadId, view: WorkspaceSidebarView) => void;
  readonly setOpen: (threadId: ThreadId, open: boolean) => void;
  readonly setWidth: (threadId: ThreadId, width: number) => void;
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
        setWidth: (threadId, width) => {
          if (Number.isFinite(width) && width > 0)
            update(threadId, (state) => ({ ...state, width }));
        },
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
            width:
              typeof raw.width === "number" && Number.isFinite(raw.width) && raw.width > 0
                ? raw.width
                : null,
          };
        }),
      }),
    },
  ),
);

export const selectWorkspaceSidebar =
  (threadId: ThreadId | null) => (store: WorkspaceSidebarStore) =>
    (threadId ? store.states[threadId] : undefined) ?? EMPTY_SIDEBAR;
