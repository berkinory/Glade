// FILE: explorerRevealRequestStore.ts
// Purpose: Lets surfaces outside the right dock (e.g. the Cmd+P search palette)
//          ask a thread's explorer pane to reveal a directory in its file tree.
//          Mirrors composerFocusRequestStore: a per-thread request with a
//          monotonic nonce, consumed by the pane whenever it is (or becomes)
//          mounted.
// Layer: Web UI state store

import type { ThreadId } from "@glade/contracts";
import { create } from "zustand";

interface ExplorerRevealRequest {
  /** Workspace-relative directory path to expand in the tree. */
  path: string;
  /** Optional file to select and preview after revealing its parent directory. */
  filePath?: string;
  /** Monotonic per thread so re-revealing the same path still fires the effect. */
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

/**
 * Every directory that must be expanded for `path` to be visible, shallowest
 * first and including `path` itself: "a/b/c" -> ["a", "a/b", "a/b/c"].
 */
export function directoryChain(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const chain: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    chain.push(segments.slice(0, index + 1).join("/"));
  }
  return chain;
}
