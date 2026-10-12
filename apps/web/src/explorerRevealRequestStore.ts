import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { create } from "zustand";

interface ExplorerRevealRequest {
  path: string;
  nonce: number;
}

interface ExplorerRevealRequestState {
  acknowledgeRequest: (threadId: ThreadId, nonce: number) => void;
  requestsByThreadId: Record<string, ExplorerRevealRequest>;
  requestReveal: (threadId: ThreadId, path: string) => void;
}

let nextRevealNonce = 0;

export const useExplorerRevealRequestStore = create<ExplorerRevealRequestState>((set) => ({
  requestsByThreadId: {},
  acknowledgeRequest: (threadId, nonce) =>
    set((state) => {
      if (state.requestsByThreadId[threadId]?.nonce !== nonce) return state;
      const requestsByThreadId = { ...state.requestsByThreadId };
      delete requestsByThreadId[threadId];
      return { requestsByThreadId };
    }),
  requestReveal: (threadId, path) => {
    set((state) => ({
      requestsByThreadId: {
        ...state.requestsByThreadId,
        [threadId]: { path, nonce: ++nextRevealNonce },
      },
    }));
  },
}));

export function requestExplorerReveal(threadId: ThreadId, path: string): void {
  useExplorerRevealRequestStore.getState().requestReveal(threadId, path);
}

// Expands the tree down to a file's folder without opening it or showing the explorer.
export function requestExplorerFileReveal(threadId: ThreadId, filePath: string): void {
  const parent = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
  useExplorerRevealRequestStore.getState().requestReveal(threadId, parent);
}

export function directoryChain(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const chain: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    chain.push(segments.slice(0, index + 1).join("/"));
  }
  return chain;
}
