import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { create } from "zustand";

interface ComposerFocusRequestState {
  requestsByThreadId: Record<string, number>;
  requestFocus: (threadId: ThreadId) => void;
}

export const useComposerFocusRequestStore = create<ComposerFocusRequestState>((set) => ({
  requestsByThreadId: {},
  requestFocus: (threadId) => {
    set((state) => ({
      requestsByThreadId: {
        ...state.requestsByThreadId,
        [threadId]: (state.requestsByThreadId[threadId] ?? 0) + 1,
      },
    }));
  },
}));

export function requestComposerFocus(threadId: ThreadId): void {
  useComposerFocusRequestStore.getState().requestFocus(threadId);
}
