import type { ThreadId } from "@glade/contracts";
import { create } from "zustand";

interface ExplorerRevealRequest {
  path: string;

  filePath?: string;

  nonce: number;
}

interface ExplorerRevealRequestState {
  requestsByThreadId: Record<string, ExplorerRevealRequest>;
  requestReveal: (threadId: ThreadId, path: string, filePath?: string) => void;
}

export const useExplorerRevealRequestStore = create<ExplorerRevealRequestState>((set) => ({
  requestsByThreadId: {},
  requestReveal: (threadId, path, filePath) => {
    set((state) => ({
      requestsByThreadId: {
        ...state.requestsByThreadId,
        [threadId]: {
          path,
          ...(filePath ? { filePath } : {}),
          nonce: (state.requestsByThreadId[threadId]?.nonce ?? 0) + 1,
        },
      },
    }));
  },
}));

export function requestExplorerReveal(threadId: ThreadId, path: string): void {
  useExplorerRevealRequestStore.getState().requestReveal(threadId, path);
}

export function requestExplorerFileReveal(threadId: ThreadId, filePath: string): void {
  const parent = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
  useExplorerRevealRequestStore.getState().requestReveal(threadId, parent, filePath);
}

export function directoryChain(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const chain: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    chain.push(segments.slice(0, index + 1).join("/"));
  }
  return chain;
}
