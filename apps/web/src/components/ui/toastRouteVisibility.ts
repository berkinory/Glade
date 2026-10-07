import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { RightDockThreadState } from "../../rightDockStore.logic";

export function resolveVisibleToastThreadIds(input: {
  activeThreadId: ThreadId | null;
  rightDockRendered: boolean;
  rightDockState?: RightDockThreadState | null;
}): ReadonlySet<ThreadId> {
  return input.activeThreadId ? new Set([input.activeThreadId]) : new Set<ThreadId>();
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
