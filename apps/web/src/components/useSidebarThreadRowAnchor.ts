import { useLayoutEffect, useRef } from "react";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";

type ThreadRowAnchor = {
  threadId: ThreadId;
  row: HTMLElement;
  viewport: HTMLElement;
  top: number;
  scrollTop: number;
};

export function useSidebarThreadRowAnchor(input: {
  routeThreadId: ThreadId | null;
  activateThreadFromSidebarIntent: (threadId: ThreadId) => void;
}): (threadId: ThreadId, row: HTMLElement) => void {
  const { routeThreadId, activateThreadFromSidebarIntent } = input;
  const pendingAnchorRef = useRef<ThreadRowAnchor | null>(null);

  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (
      !anchor ||
      anchor.threadId !== routeThreadId ||
      !anchor.row.isConnected ||
      anchor.viewport.scrollTop !== anchor.scrollTop
    ) {
      return;
    }
    // Leaving a subagent removes its rows from above the activated row in the same commit as the
    // route change. Native scroll anchoring may hold an earlier row instead, so correct it here.
    anchor.viewport.scrollTop += anchor.row.getBoundingClientRect().top - anchor.top;
  }, [routeThreadId]);

  return (threadId, row) => {
    const viewport = row.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    pendingAnchorRef.current =
      viewport && threadId !== routeThreadId
        ? {
            threadId,
            row,
            viewport,
            top: row.getBoundingClientRect().top,
            scrollTop: viewport.scrollTop,
          }
        : null;
    activateThreadFromSidebarIntent(threadId);
  };
}
