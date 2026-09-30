import { type MessageId } from "@glade/contracts/core/baseSchemas";
import { isLocalAbsolutePath } from "@glade/shared/platform/path";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  type CollapsedTurnItem,
  type MessagesTimelineRow,
  type StableMessagesTimelineRowsState,
} from "~/components/chat/MessagesTimeline.logic.rowTypes";
import { computeStableMessagesTimelineRows } from "~/components/chat/MessagesTimeline.logic.stability";
import { DISCLOSURE_CLEANUP_BUFFER_MS, DISCLOSURE_TRANSITION_MS } from "~/lib/disclosureMotion";
import { type WorktreeSetupSnapshot } from "~/types";
import { type WorkLogEntry } from "~/workLog.types";
import {
  MESSAGE_SEND_ENTER_ANIMATION_MS,
  MESSAGE_SEND_ENTER_CLEANUP_BUFFER_MS,
  SettledTurnCollapseTimer,
  SettledTurnCollapseTransition,
} from "./timelineSupport";
export function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const previousStateRef = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<string, MessagesTimelineRow>(),
    result: [],
  });

  return useMemo(() => reconcileStableTimelineRows(rows, previousStateRef), [rows]);
}
function reconcileStableTimelineRows(
  rows: MessagesTimelineRow[],
  previousStateRef: RefObject<StableMessagesTimelineRowsState>,
): MessagesTimelineRow[] {
  const nextState = computeStableMessagesTimelineRows(rows, previousStateRef.current);
  previousStateRef.current = nextState;
  return nextState.result;
}
export function useMessageSendEnterAnimations(
  rows: readonly MessagesTimelineRow[],
  enteringUserMessageIds: ReadonlySet<MessageId>,
): ReadonlySet<string> {
  const [enteringRowIds, setEnteringRowIds] = useState<ReadonlySet<string>>(() => new Set());
  const previousRowIdsRef = useRef<ReadonlySet<string> | null>(null);
  const cleanupTimeoutsRef = useRef<number[]>([]);

  useLayoutEffect(() => {
    applyMessageSendEnterAnimation({
      rows,
      enteringUserMessageIds,
      previousRowIdsRef,
      cleanupTimeoutsRef,
      setEnteringRowIds,
    });
  }, [enteringUserMessageIds, rows]);

  useEffect(
    () => () => {
      for (const timeoutId of cleanupTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      cleanupTimeoutsRef.current = [];
    },
    [],
  );

  return enteringRowIds;
}
function applyMessageSendEnterAnimation(params: {
  rows: readonly MessagesTimelineRow[];
  enteringUserMessageIds: ReadonlySet<MessageId>;
  previousRowIdsRef: RefObject<ReadonlySet<string> | null>;
  cleanupTimeoutsRef: RefObject<number[]>;
  setEnteringRowIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
}): void {
  const { rows, enteringUserMessageIds, previousRowIdsRef, cleanupTimeoutsRef, setEnteringRowIds } =
    params;
  const currentRowIds = new Set(rows.map((row) => row.id));
  const previousRowIds = previousRowIdsRef.current;
  previousRowIdsRef.current = currentRowIds;

  const freshUserRowIds = rows
    .filter(
      (row) =>
        row.kind === "message" &&
        row.message.role === "user" &&
        enteringUserMessageIds.has(row.message.id) &&
        (previousRowIds === null || !previousRowIds.has(row.id)),
    )
    .map((row) => row.id);
  if (freshUserRowIds.length === 0) {
    return;
  }

  setEnteringRowIds((current) => {
    const next = new Set(current);
    for (const rowId of freshUserRowIds) {
      next.add(rowId);
    }
    return next;
  });

  const cleanupTimeout = window.setTimeout(() => {
    cleanupTimeoutsRef.current = cleanupTimeoutsRef.current.filter((id) => id !== cleanupTimeout);
    setEnteringRowIds((current) => {
      const next = new Set(current);
      for (const rowId of freshUserRowIds) {
        next.delete(rowId);
      }
      return next.size === current.size ? current : next;
    });
  }, MESSAGE_SEND_ENTER_ANIMATION_MS + MESSAGE_SEND_ENTER_CLEANUP_BUFFER_MS);
  cleanupTimeoutsRef.current.push(cleanupTimeout);
}
interface WorktreeSetupPresentation {
  snapshot: WorktreeSetupSnapshot;
  open: boolean;
}
export function useWorktreeSetupPresentation(
  worktreeSetup: WorktreeSetupSnapshot | null,
): WorktreeSetupPresentation | null {
  const [presented, setPresented] = useState<WorktreeSetupPresentation | null>(null);
  const closeFrameRef = useRef<number | null>(null);
  const cleanupTimeoutRef = useRef<number | null>(null);

  const clearCloseTimers = useCallback(() => {
    if (closeFrameRef.current !== null) {
      window.cancelAnimationFrame(closeFrameRef.current);
      closeFrameRef.current = null;
    }
    if (cleanupTimeoutRef.current !== null) {
      window.clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    reconcileWorktreeSetupPresentation({
      worktreeSetup,
      presented,
      clearCloseTimers,
      closeFrameRef,
      cleanupTimeoutRef,
      setPresented,
    });
  }, [worktreeSetup, presented, clearCloseTimers]);

  useLayoutEffect(() => clearCloseTimers, [clearCloseTimers]);

  return presented;
}
function reconcileWorktreeSetupPresentation(params: {
  worktreeSetup: WorktreeSetupSnapshot | null;
  presented: WorktreeSetupPresentation | null;
  clearCloseTimers: () => void;
  closeFrameRef: RefObject<number | null>;
  cleanupTimeoutRef: RefObject<number | null>;
  setPresented: Dispatch<SetStateAction<WorktreeSetupPresentation | null>>;
}): void {
  const {
    worktreeSetup,
    presented,
    clearCloseTimers,
    closeFrameRef,
    cleanupTimeoutRef,
    setPresented,
  } = params;
  if (worktreeSetup) {
    clearCloseTimers();
    setPresented((current) =>
      current?.open && current.snapshot === worktreeSetup
        ? current
        : { snapshot: worktreeSetup, open: true },
    );
    return;
  }
  if (!presented?.open || closeFrameRef.current !== null) {
    return;
  }
  closeFrameRef.current = window.requestAnimationFrame(() => {
    closeFrameRef.current = null;
    setPresented((current) => (current?.open ? { ...current, open: false } : current));
    cleanupTimeoutRef.current = window.setTimeout(() => {
      cleanupTimeoutRef.current = null;
      setPresented(null);
    }, DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS);
  });
}
export function useSettledTurnCollapseTransitions(
  rows: readonly MessagesTimelineRow[],
): Readonly<Record<string, SettledTurnCollapseTransition>> {
  const [transitions, setTransitions] = useState<Record<string, SettledTurnCollapseTransition>>({});
  const previousAssistantMessageIdsRef = useRef<ReadonlySet<string>>(new Set());
  const previousCollapsedSignaturesRef = useRef<ReadonlyMap<string, string>>(new Map());
  const watchedLiveMessageIdsRef = useRef(new Set<string>());
  const timersRef = useRef(new Map<string, SettledTurnCollapseTimer>());

  const clearTransitionTimer = useCallback((messageId: string) => {
    const timer = timersRef.current.get(messageId);
    if (!timer) {
      return;
    }
    if (timer.closeFrame !== null) {
      window.cancelAnimationFrame(timer.closeFrame);
    }
    if (timer.cleanupTimeout !== null) {
      window.clearTimeout(timer.cleanupTimeout);
    }
    timersRef.current.delete(messageId);
  }, []);

  const scheduleTransitionClose = useCallback(
    (messageId: string) => {
      clearTransitionTimer(messageId);
      const closeFrame = window.requestAnimationFrame(() => {
        const timer = timersRef.current.get(messageId);
        if (!timer) {
          return;
        }
        timersRef.current.set(messageId, { ...timer, closeFrame: null });
        setTransitions((current) => {
          const transition = current[messageId];
          if (!transition || !transition.open) {
            return current;
          }
          return {
            ...current,
            [messageId]: { ...transition, open: false },
          };
        });

        const cleanupTimeout = window.setTimeout(() => {
          timersRef.current.delete(messageId);
          setTransitions((current) => {
            if (!current[messageId]) {
              return current;
            }
            const next = { ...current };
            delete next[messageId];
            return next;
          });
        }, DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS);
        timersRef.current.set(messageId, { closeFrame: null, cleanupTimeout });
      });
      timersRef.current.set(messageId, { closeFrame, cleanupTimeout: null });
    },
    [clearTransitionTimer],
  );

  useLayoutEffect(() => {
    applySettledTurnCollapseTransitions({
      rows,
      previousAssistantMessageIdsRef,
      previousCollapsedSignaturesRef,
      watchedLiveMessageIdsRef,
      clearTransitionTimer,
      scheduleTransitionClose,
      setTransitions,
    });
  }, [clearTransitionTimer, rows, scheduleTransitionClose]);

  useEffect(
    () => () => {
      for (const messageId of Array.from(timersRef.current.keys())) {
        clearTransitionTimer(messageId);
      }
    },
    [clearTransitionTimer],
  );

  return transitions;
}
function applySettledTurnCollapseTransitions(params: {
  rows: readonly MessagesTimelineRow[];
  previousAssistantMessageIdsRef: RefObject<ReadonlySet<string>>;
  previousCollapsedSignaturesRef: RefObject<ReadonlyMap<string, string>>;
  watchedLiveMessageIdsRef: RefObject<Set<string>>;
  clearTransitionTimer: (messageId: string) => void;
  scheduleTransitionClose: (messageId: string) => void;
  setTransitions: Dispatch<SetStateAction<Record<string, SettledTurnCollapseTransition>>>;
}): void {
  const {
    rows,
    previousAssistantMessageIdsRef,
    previousCollapsedSignaturesRef,
    watchedLiveMessageIdsRef,
    clearTransitionTimer,
    scheduleTransitionClose,
    setTransitions,
  } = params;
  const currentAssistantMessageIds = new Set<string>();
  const currentCollapsed = new Map<
    string,
    { signature: string; items: readonly CollapsedTurnItem[] }
  >();
  const watchedLiveMessageIds = watchedLiveMessageIdsRef.current;

  for (const row of rows) {
    if (row.kind !== "message" || row.message.role !== "assistant") {
      continue;
    }
    const messageId = row.message.id;
    currentAssistantMessageIds.add(messageId);
    // Only the assistant row belonging to the live turn has an expanded layout on screen worth
    // animating away. Thread-wide working state also covers reconnects, approvals, and newer turns, so
    // it must not qualify history.
    if (row.assistantTurnInProgress || row.message.streaming) {
      watchedLiveMessageIds.add(messageId);
    }
    if (row.collapsedTurnItems && row.collapsedTurnItems.length > 0) {
      currentCollapsed.set(messageId, {
        signature: collapsedTurnItemsSignature(row.collapsedTurnItems),
        items: row.collapsedTurnItems,
      });
    }
  }

  for (const messageId of watchedLiveMessageIds) {
    if (!currentAssistantMessageIds.has(messageId)) {
      watchedLiveMessageIds.delete(messageId);
    }
  }

  const previousAssistantMessageIds = previousAssistantMessageIdsRef.current;
  const previousCollapsedSignatures = previousCollapsedSignaturesRef.current;
  const startedTransitions: Array<{
    messageId: string;
    items: readonly CollapsedTurnItem[];
  }> = [];

  for (const [messageId, collapsed] of currentCollapsed) {
    if (
      watchedLiveMessageIds.has(messageId) &&
      previousAssistantMessageIds.has(messageId) &&
      !previousCollapsedSignatures.has(messageId)
    ) {
      startedTransitions.push({ messageId, items: collapsed.items });
    }
  }

  previousAssistantMessageIdsRef.current = currentAssistantMessageIds;
  previousCollapsedSignaturesRef.current = new Map(
    Array.from(currentCollapsed, ([messageId, collapsed]) => [messageId, collapsed.signature]),
  );

  setTransitions((current) => {
    let next: Record<string, SettledTurnCollapseTransition> | null = null;
    const ensureNext = () => {
      next ??= { ...current };
      return next;
    };

    for (const messageId of Object.keys(current)) {
      if (!currentCollapsed.has(messageId)) {
        clearTransitionTimer(messageId);
        delete ensureNext()[messageId];
      }
    }

    for (const transition of startedTransitions) {
      ensureNext()[transition.messageId] = {
        open: true,
        items: transition.items,
      };
    }

    return next ?? current;
  });

  for (const transition of startedTransitions) {
    scheduleTransitionClose(transition.messageId);
  }
}
function collapsedTurnItemsSignature(items: readonly CollapsedTurnItem[]): string {
  return items.map((item) => `${item.kind}:${item.id}`).join("|");
}
export function collectAbsoluteFilePathsFromWorkEntries(
  entries: ReadonlyArray<WorkLogEntry>,
): string[] {
  const paths = new Set<string>();
  for (const entry of entries) {
    for (const path of entry.changedFiles ?? []) {
      if (isLocalAbsolutePath(path)) paths.add(path);
    }
    const detail = entry.detail?.trim();
    if (detail && isLocalAbsolutePath(detail)) paths.add(detail);
    const command = entry.command?.trim();
    if (command && isLocalAbsolutePath(command)) paths.add(command);
  }
  return [...paths];
}
