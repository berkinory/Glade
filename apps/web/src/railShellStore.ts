import type { ProjectId } from "@glade/contracts/core/baseSchemas";
import { create } from "zustand";

import {
  RAIL_PANEL_ITEM_IDS,
  reconcileActiveRailItem,
  type RailItemId,
  type RailPanelItemId,
  type RailRouteItemId,
} from "./appRail.logic";

const STORAGE_KEY = "glade:rail-shell:v1";

interface PersistedRailShellState {
  activeItem: RailItemId;
  panelView: RailPanelItemId;
  spacesProjectId: ProjectId | null;
}

const DEFAULT_RAIL_SHELL_STATE: PersistedRailShellState = {
  activeItem: "home",
  panelView: "home",
  spacesProjectId: null,
};

function isRailPanelItemId(value: unknown): value is RailPanelItemId {
  return (RAIL_PANEL_ITEM_IDS as ReadonlyArray<unknown>).includes(value);
}

function readPersisted(): PersistedRailShellState {
  if (typeof window === "undefined") {
    return DEFAULT_RAIL_SHELL_STATE;
  }
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<PersistedRailShellState> | null;
    const panelView = isRailPanelItemId(parsed?.panelView) ? parsed.panelView : "home";
    return {
      activeItem: panelView,
      panelView,
      spacesProjectId:
        typeof parsed?.spacesProjectId === "string" ? (parsed.spacesProjectId as ProjectId) : null,
    };
  } catch {
    return DEFAULT_RAIL_SHELL_STATE;
  }
}

function persist(state: PersistedRailShellState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeItem: state.activeItem,
        panelView: state.panelView,
        spacesProjectId: state.spacesProjectId,
      }),
    );
  } catch {
    // A blocked storage API must not make the rail unusable.
  }
}

interface RailShellState extends PersistedRailShellState {
  reconciledRouteKey: string | null;
  selectPanelItem: (id: RailPanelItemId) => void;
  selectRouteItem: (id: RailRouteItemId) => void;
  openSpacesProject: (projectId: ProjectId) => void;
  closeSpacesProject: () => void;

  reconcile: (input: { pathname: string; projectIds: ReadonlySet<ProjectId> | null }) => void;
}

export const useRailShellStore = create<RailShellState>((set, get) => ({
  ...readPersisted(),
  reconciledRouteKey: null,
  selectPanelItem: (id) => {
    set({ activeItem: id, panelView: id });
    persist(get());
  },
  selectRouteItem: (id) => {
    set({ activeItem: id });
    persist(get());
  },
  openSpacesProject: (projectId) => {
    set({ spacesProjectId: projectId });
    persist(get());
  },
  closeSpacesProject: () => {
    set({ spacesProjectId: null });
    persist(get());
  },
  reconcile: ({ pathname, projectIds }) => {
    const current = get();

    const routeKey = pathname;
    const activeItem =
      routeKey === current.reconciledRouteKey
        ? current.activeItem
        : reconcileActiveRailItem({
            current: current.activeItem,
            pathname,
            panelView: current.panelView,
          });
    const spacesProjectId =
      current.spacesProjectId !== null &&
      projectIds !== null &&
      !projectIds.has(current.spacesProjectId)
        ? null
        : current.spacesProjectId;
    if (
      activeItem === current.activeItem &&
      spacesProjectId === current.spacesProjectId &&
      routeKey === current.reconciledRouteKey
    ) {
      return;
    }
    set({ activeItem, spacesProjectId, reconciledRouteKey: routeKey });
    persist(get());
  },
}));
