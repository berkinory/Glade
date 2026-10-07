import { isRecord } from "@glade/shared/transport/payloadValues";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isElectron } from "./env";

export const WORKSPACE_SIDEBAR_VIEWS = ["explorer", "git", "terminal", "browser"] as const;
export type WorkspaceSidebarView = (typeof WORKSPACE_SIDEBAR_VIEWS)[number];

interface WorkspaceSidebarStore {
  readonly open: boolean;
  readonly view: WorkspaceSidebarView;
  readonly show: (view: WorkspaceSidebarView) => void;
  readonly toggle: (view: WorkspaceSidebarView) => void;
  readonly setOpen: (open: boolean) => void;
}

// The browser hosts native views, so it exists only in the desktop app.
function isAvailable(view: unknown): view is WorkspaceSidebarView {
  return (
    WORKSPACE_SIDEBAR_VIEWS.includes(view as WorkspaceSidebarView) &&
    (view !== "browser" || isElectron)
  );
}

// Which view the right sidebar shows and whether it is open. Session storage keeps it per window.
export const useWorkspaceSidebarStore = create<WorkspaceSidebarStore>()(
  persist(
    (set, get) => ({
      open: false,
      view: "explorer",
      show: (view) => {
        if (isAvailable(view)) set({ open: true, view });
      },
      toggle: (view) => {
        const state = get();
        if (state.open && state.view === view) set({ open: false });
        else state.show(view);
      },
      setOpen: (open) => set({ open }),
    }),
    {
      name: "glade:workspace-sidebar:v1",
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ open, view }) => ({ open, view }),
      merge: (persisted, current) =>
        isRecord(persisted) && isAvailable(persisted.view)
          ? { ...current, open: persisted.open === true, view: persisted.view }
          : current,
    },
  ),
);
