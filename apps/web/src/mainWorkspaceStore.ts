import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { isRecord } from "@glade/shared/transport/payloadValues";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { sanitizeStringKeyedRecord } from "./persistedRecord";

export type WorkspaceReviewTab =
  | { id: string; kind: "commit"; sha: string; subject: string; filePath?: string }
  | { id: string; kind: "gitFile"; filePath: string; scope: "staged" | "unstaged" }
  | { id: string; kind: "diff"; turnId: TurnId; filePath: string | null };

interface MainWorkspaceState {
  previewReviewId: string | null;
  activeTabId: string;
  reviews: WorkspaceReviewTab[];
}

const EMPTY_WORKSPACE: MainWorkspaceState = {
  activeTabId: "chat",
  reviews: [],
  previewReviewId: null,
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
    activeTabId: typeof value.activeTabId === "string" ? value.activeTabId : "chat",
    reviews,
    previewReviewId:
      typeof value.previewReviewId === "string" &&
      reviews.some((tab) => tab.id === value.previewReviewId)
        ? value.previewReviewId
        : null,
  };
}

interface MainWorkspaceStore {
  states: Record<string, MainWorkspaceState | undefined>;
  selectTab: (threadId: ThreadId, tabId: string) => void;
  openReview: (threadId: ThreadId, tab: WorkspaceReviewTab, preview?: boolean) => void;
  pinReview: (threadId: ThreadId, tabId: string) => void;
  closeReview: (threadId: ThreadId, tabId: string) => void;
}

export const useMainWorkspaceStore = create<MainWorkspaceStore>()(
  persist(
    (set) => ({
      states: {},
      selectTab: (threadId, activeTabId) =>
        set((store) => ({
          states: {
            ...store.states,
            [threadId]: { ...(store.states[threadId] ?? EMPTY_WORKSPACE), activeTabId },
          },
        })),
      openReview: (threadId, tab, preview = false) =>
        set((store) => {
          const state = store.states[threadId] ?? EMPTY_WORKSPACE;
          const existing = state.reviews.some((review) => review.id === tab.id);
          const replacePreview = preview && (!existing || state.previewReviewId === tab.id);
          const reviews = replacePreview
            ? state.reviews.filter((review) => review.id !== state.previewReviewId)
            : state.reviews;
          return {
            states: {
              ...store.states,
              [threadId]: {
                ...state,
                previewReviewId: replacePreview
                  ? tab.id
                  : state.previewReviewId === tab.id
                    ? null
                    : state.previewReviewId,
                activeTabId: tab.id,
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
                previewReviewId: state.previewReviewId === tabId ? null : state.previewReviewId,
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
                previewReviewId: state.previewReviewId === tabId ? null : state.previewReviewId,
                reviews: state.reviews.filter((tab) => tab.id !== tabId),
              },
            },
          };
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
