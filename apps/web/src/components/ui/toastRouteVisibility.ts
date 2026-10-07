import type { ThreadId } from "@glade/contracts/core/baseSchemas";

export function resolveVisibleToastThreadIds(
  activeThreadId: ThreadId | null,
): ReadonlySet<ThreadId> {
  return activeThreadId ? new Set([activeThreadId]) : new Set<ThreadId>();
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
