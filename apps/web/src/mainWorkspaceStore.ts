import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { isRecord } from "@glade/shared/transport/payloadValues";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_WORKSPACE_LAYOUT,
  sanitizeWorkspaceLayout,
  selectWorkspaceTab,
  reconcileWorkspaceTabs,
  moveWorkspaceTab,
  splitWorkspaceTab,
  type WorkspaceLayout,
  type WorkspaceSplitDirection,
} from "./mainWorkspaceLayout";
import { sanitizeStringKeyedRecord } from "./persistedRecord";

export type WorkspaceReviewTab =
  | { id: string; kind: "commit"; sha: string; subject: string; filePath?: string }
  | { id: string; kind: "gitFile"; filePath: string; scope: "staged" | "unstaged" }
  | { id: string; kind: "diff"; turnId: TurnId; filePath: string | null };

interface MainWorkspaceState {
  layout: WorkspaceLayout;
  previewReviewIds: string[];
  activeTabId: string;
  reviews: WorkspaceReviewTab[];
}

const EMPTY_WORKSPACE: MainWorkspaceState = {
  layout: DEFAULT_WORKSPACE_LAYOUT,
  activeTabId: "chat",
  reviews: [],
  previewReviewIds: [],
};

function sanitizeWorkspace(value: unknown): MainWorkspaceState | null {
  if (!isRecord(value)) return null;
  const reviews: WorkspaceReviewTab[] = [];
  if (Array.isArray(value.reviews)) {
    for (const tab of value.reviews) {
      if (!isRecord(tab) || typeof tab.id !== "string") continue;
      if (tab.kind === "commit" && typeof tab.sha === "string" && typeof tab.subject === "string") {
        reviews.push({
          id: tab.id,
          kind: "commit",
          sha: tab.sha,
          subject: tab.subject,
          ...(typeof tab.filePath === "string" ? { filePath: tab.filePath } : {}),
        });
      } else if (
        tab.kind === "gitFile" &&
        typeof tab.filePath === "string" &&
        (tab.scope === "staged" || tab.scope === "unstaged")
      ) {
        reviews.push({ id: tab.id, kind: "gitFile", filePath: tab.filePath, scope: tab.scope });
      } else if (tab.kind === "diff" && typeof tab.turnId === "string") {
        reviews.push({
          id: tab.id,
          kind: "diff",
          turnId: tab.turnId as TurnId,
          filePath: typeof tab.filePath === "string" ? tab.filePath : null,
        });
      }
    }
  }
  return {
    layout: sanitizeWorkspaceLayout(value.layout),
    activeTabId: typeof value.activeTabId === "string" ? value.activeTabId : "chat",
    reviews,
    previewReviewIds: [
      ...new Set(
        (Array.isArray(value.previewReviewIds)
          ? value.previewReviewIds
          : typeof value.previewReviewId === "string"
            ? [value.previewReviewId]
            : []
        ).filter(
          (id): id is string => typeof id === "string" && reviews.some((tab) => tab.id === id),
        ),
      ),
    ],
  };
}

interface MainWorkspaceStore {
  states: Record<string, MainWorkspaceState | undefined>;
  selectTab: (threadId: ThreadId, tabId: string) => void;
  openReview: (threadId: ThreadId, tab: WorkspaceReviewTab, preview?: boolean) => void;
  pinReview: (threadId: ThreadId, tabId: string) => void;
  closeReview: (threadId: ThreadId, tabId: string) => void;
  clearThread: (threadId: ThreadId) => void;
  reconcileTabs: (threadId: ThreadId, ids: readonly string[], selected: string) => void;
  focusGroup: (threadId: ThreadId, group: number) => void;
  moveTab: (threadId: ThreadId, id: string, group: number) => void;
  splitTab: (threadId: ThreadId, id: string, direction: WorkspaceSplitDirection) => void;
  resizeSplit: (threadId: ThreadId, ratio: number) => void;
}

export const useMainWorkspaceStore = create<MainWorkspaceStore>()(
  persist(
    (set) => ({
      states: {},
      selectTab: (threadId, activeTabId) =>
        set((store) => ({
          states: {
            ...store.states,
            [threadId]: {
              ...(store.states[threadId] ?? EMPTY_WORKSPACE),
              activeTabId,
              layout: selectWorkspaceTab(
                (store.states[threadId] ?? EMPTY_WORKSPACE).layout,
                activeTabId,
              ),
            },
          },
        })),
      openReview: (threadId, tab, preview = false) =>
        set((store) => {
          const state = store.states[threadId] ?? EMPTY_WORKSPACE;
          const existing = state.reviews.some((review) => review.id === tab.id);
          const owner = state.layout.groups.findIndex((group) => group.tabIds.includes(tab.id));
          const target = owner >= 0 ? owner : state.layout.activeGroup;
          const previousPreview = state.previewReviewIds.find((id) =>
            state.layout.groups[target]?.tabIds.includes(id),
          );
          const replacePreview = preview && (!existing || state.previewReviewIds.includes(tab.id));
          const reviews = replacePreview
            ? state.reviews.filter((review) => review.id !== previousPreview)
            : state.reviews;
          const previewReviewIds = state.previewReviewIds.filter((id) =>
            replacePreview ? id !== previousPreview && id !== tab.id : id !== tab.id,
          );
          return {
            states: {
              ...store.states,
              [threadId]: {
                ...state,
                previewReviewIds: replacePreview ? [...previewReviewIds, tab.id] : previewReviewIds,
                activeTabId: tab.id,
                layout: selectWorkspaceTab(state.layout, tab.id),
                reviews: reviews.some((review) => review.id === tab.id)
                  ? reviews.map((review) => (review.id === tab.id ? tab : review))
                  : [...reviews, tab],
              },
            },
          };
        }),
      pinReview: (threadId, tabId) =>
        set((store) => {
          const state = store.states[threadId] ?? EMPTY_WORKSPACE;
          return {
            states: {
              ...store.states,
              [threadId]: {
                ...state,
                previewReviewIds: state.previewReviewIds.filter((id) => id !== tabId),
              },
            },
          };
        }),
      closeReview: (threadId, tabId) =>
        set((store) => {
          const state = store.states[threadId] ?? EMPTY_WORKSPACE;
          return {
            states: {
              ...store.states,
              [threadId]: {
                ...state,
                previewReviewIds: state.previewReviewIds.filter((id) => id !== tabId),
                reviews: state.reviews.filter((tab) => tab.id !== tabId),
              },
            },
          };
        }),
      reconcileTabs: (threadId, ids, selected) =>
        set((store) => {
          const state = store.states[threadId] ?? EMPTY_WORKSPACE;
          const layout = reconcileWorkspaceTabs(state.layout, ids, selected);
          if (JSON.stringify(layout) === JSON.stringify(state.layout)) return {};
          return {
            states: {
              ...store.states,
              [threadId]: {
                ...state,
                layout,
                activeTabId: layout.groups[layout.activeGroup]?.activeTabId ?? "chat",
              },
            },
          };
        }),
      focusGroup: (threadId, activeGroup) =>
        set((store) => {
          const state = store.states[threadId] ?? EMPTY_WORKSPACE;
          const group = state.layout.groups[activeGroup];
          if (!group || state.layout.activeGroup === activeGroup) return {};
          return {
            states: {
              ...store.states,
              [threadId]: {
                ...state,
                activeTabId: group.activeTabId ?? "chat",
                layout: { ...state.layout, activeGroup },
              },
            },
          };
        }),
      moveTab: (threadId, id, group) =>
        set((store) => {
          const state = store.states[threadId] ?? EMPTY_WORKSPACE;
          const layout = moveWorkspaceTab(state.layout, id, group);
          return {
            states: {
              ...store.states,
              [threadId]: {
                ...state,
                layout,
                activeTabId: layout.groups[layout.activeGroup]?.activeTabId ?? "chat",
              },
            },
          };
        }),
      splitTab: (threadId, id, direction) =>
        set((store) => {
          const state = store.states[threadId] ?? EMPTY_WORKSPACE;
          const layout = splitWorkspaceTab(state.layout, id, direction);
          return {
            states: {
              ...store.states,
              [threadId]: {
                ...state,
                layout,
                activeTabId: layout.groups[layout.activeGroup]?.activeTabId ?? "chat",
              },
            },
          };
        }),
      resizeSplit: (threadId, ratio) =>
        set((store) => {
          const state = store.states[threadId] ?? EMPTY_WORKSPACE;
          return {
            states: {
              ...store.states,
              [threadId]: {
                ...state,
                layout: { ...state.layout, ratio: Math.max(0.2, Math.min(0.8, ratio)) },
              },
            },
          };
        }),
      clearThread: (threadId) =>
        set((store) => {
          const states = { ...store.states };
          delete states[threadId];
          return { states };
        }),
    }),
    {
      name: "glade:main-workspace:v1",
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => ({
        ...current,
        states: sanitizeStringKeyedRecord(
          isRecord(persisted) ? persisted.states : undefined,
          sanitizeWorkspace,
        ),
      }),
    },
  ),
);

export function selectMainWorkspace(threadId: ThreadId) {
  return (store: MainWorkspaceStore) => store.states[threadId] ?? EMPTY_WORKSPACE;
}
