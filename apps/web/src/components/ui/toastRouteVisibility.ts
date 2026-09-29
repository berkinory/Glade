// FILE: toastRouteVisibility.ts
// Purpose: Keeps thread-scoped toasts visible for every thread currently rendered in the route.
// Layer: UI helpers
// Exports: visible-thread resolver shared by toast containers and split-aware tests

import type { ThreadId } from "@glade/contracts";
import { resolveSplitViewThreadIds } from "../../splitViewStore";
import { type SplitView } from "../../splitViewModel";
import type { RightDockThreadState } from "../../rightDockStore.logic";

export function resolveVisibleToastThreadIds(input: {
  activeThreadId: ThreadId | null;
  splitView: SplitView | null;
  rightDockRendered: boolean;
  rightDockState?: RightDockThreadState | null;
}): ReadonlySet<ThreadId> {
  const visibleThreadIds = input.splitView
    ? new Set(resolveSplitViewThreadIds(input.splitView))
    : input.activeThreadId
      ? new Set([input.activeThreadId])
      : new Set<ThreadId>();

  return visibleThreadIds;
}

export function shouldRenderToastForVisibleThreads(input: {
  allowCrossThreadVisibility?: boolean | undefined;
  toastThreadId?: ThreadId | null | undefined;
  visibleThreadIds: ReadonlySet<ThreadId>;
}): boolean {
  if (input.allowCrossThreadVisibility) {
    return true;
  }
  const toastThreadId = input.toastThreadId;
  if (!toastThreadId) {
    return true;
  }
  return input.visibleThreadIds.has(toastThreadId);
}
