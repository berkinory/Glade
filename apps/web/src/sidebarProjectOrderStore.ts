import type { ProjectId } from "@glade/contracts/core/baseSchemas";
import { create } from "zustand";
import { readPersistedStoreField, writePersistedStoreField } from "./persistedStoreFields";

const PROJECT_ORDER_KEY = "glade:project-order:v1";
const storage = () => (typeof localStorage === "undefined" ? null : localStorage);

// The manual sidebar order of projects from every machine. Each server only knows its own projects,
// so the order across machines is kept on this one; projects of an offline host keep their place.
interface SidebarProjectOrderState {
  projectOrder: ReadonlyArray<ProjectId>;
  // Projects without a place yet join in the order the sidebar shows them, so the first drag keeps
  // every other project where it was.
  moveProject: (
    draggedId: ProjectId,
    targetId: ProjectId,
    shownOrder: ReadonlyArray<ProjectId>,
  ) => void;
  pruneProjectOrder: (knownIds: ReadonlyArray<ProjectId>) => void;
}

function readProjectOrder(): ProjectId[] {
  const value = readPersistedStoreField(storage(), PROJECT_ORDER_KEY, "projectOrder");
  return Array.isArray(value)
    ? value.filter((id): id is ProjectId => typeof id === "string" && id.length > 0)
    : [];
}

function writeProjectOrder(projectOrder: ReadonlyArray<ProjectId>): void {
  writePersistedStoreField(storage(), PROJECT_ORDER_KEY, "projectOrder", projectOrder);
}

export const useSidebarProjectOrderStore = create<SidebarProjectOrderState>((set, get) => ({
  projectOrder: readProjectOrder(),
  moveProject: (draggedId, targetId, shownOrder) => {
    const current = get().projectOrder;
    const placed = new Set(current);
    const order = [...current, ...shownOrder.filter((id) => !placed.has(id))];
    const from = order.indexOf(draggedId);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    order.splice(from, 1);
    order.splice(to, 0, draggedId);
    set({ projectOrder: order });
    writeProjectOrder(order);
  },
  pruneProjectOrder: (knownIds) => {
    const known = new Set(knownIds);
    const current = get().projectOrder;
    const next = current.filter((id) => known.has(id));
    if (next.length === current.length) return;
    set({ projectOrder: next });
    writeProjectOrder(next);
  },
}));
