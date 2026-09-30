import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { resolveSplitViewPaneIdForThread } from "./splitViewStore";
import { type PaneId, type SplitView, type SplitViewId } from "./splitViewModel";

export type ThreadCommandActivation =
  | { kind: "ignore" }
  | { kind: "single"; threadId: ThreadId }
  | { kind: "split"; threadId: ThreadId; splitViewId: SplitViewId; paneId: PaneId };

export function resolveThreadCommandActivation(input: {
  threadId: ThreadId;
  threadExists: boolean;
  activeSidebarThreadId: ThreadId | null | undefined;
  preferredSplitViewId: SplitViewId | null;
  splitPaneId: PaneId | null;
}): ThreadCommandActivation {
  if (!input.threadExists) {
    return { kind: "ignore" };
  }

  if (input.preferredSplitViewId && input.splitPaneId) {
    return {
      kind: "split",
      threadId: input.threadId,
      splitViewId: input.preferredSplitViewId,
      paneId: input.splitPaneId,
    };
  }

  if (input.threadId === input.activeSidebarThreadId) {
    return { kind: "ignore" };
  }

  return { kind: "single", threadId: input.threadId };
}

// Otherwise every persisted split block can be restored, but ambiguous non-source membership falls
// back to single chat instead of guessing by recency.
export function resolvePreferredSplitForCommand(input: {
  activeSplitView: SplitView | null;
  splitViewsById: Record<SplitViewId, SplitView | undefined>;
  threadId: ThreadId;
}): { splitViewId: SplitViewId; paneId: PaneId } | null {
  if (input.activeSplitView) {
    const paneId = resolveSplitViewPaneIdForThread(input.activeSplitView, input.threadId);
    if (paneId) {
      return { splitViewId: input.activeSplitView.id, paneId };
    }
  }

  const matchingSplits = Object.values(input.splitViewsById)
    .filter((splitView): splitView is SplitView => splitView !== undefined)
    .map((splitView) => ({
      splitView,
      paneId: resolveSplitViewPaneIdForThread(splitView, input.threadId),
    }))
    .filter((match): match is { splitView: SplitView; paneId: PaneId } => match.paneId !== null);

  const sourceMatch = matchingSplits.find(
    ({ splitView }) => splitView.sourceThreadId === input.threadId,
  );
  const match = sourceMatch ?? (matchingSplits.length === 1 ? matchingSplits[0] : null);
  return match ? { splitViewId: match.splitView.id, paneId: match.paneId } : null;
}
