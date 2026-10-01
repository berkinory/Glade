import { type MessageId } from "@glade/contracts/core/baseSchemas";
import { LegendList } from "@legendapp/list/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentProps,
} from "react";
import { resolveThreadFindJumpTarget } from "~/components/chat/MessagesTimeline.logic.rowTypes";
import {
  resolveActiveTrailSnapshot,
  type MessageTrailAnchor,
} from "~/components/chat/messageTrail.logic";
import { applyActiveChatFindMatch } from "~/components/chat/threadFind.logic";
import {
  cssAttributeSelectorValue,
  FIND_FINE_SCROLL_MAX_RETRY_FRAMES,
  FIND_FINE_SCROLL_RETRY_TIMEOUT_MS,
  getMonotonicTimeMs,
  JUMP_HIGHLIGHT_DURATION_MS,
  MessagesTimelineController,
  MessagesTimelineProps,
  readLegendListState,
  scrollLegendListToEnd,
  scrollLegendListToIndex,
} from "./timelineSupport";
import type { useTimelineStateController } from "./useTimelineStateController";
export function useTimelineNavigationController({
  state,
  props,
}: {
  state: ReturnType<typeof useTimelineStateController>;
  props: MessagesTimelineProps;
}) {
  const {
    rows,
    setCollapsedWorkExpanded,
    setExpandedUserMessagesById,
    resolvedListRef,
    setHighlightedMessageId,
    timelineRootRef,
    activeFindMatchRef,
  } = state;
  const {
    controllerRef,
    onNavigate,
    editableUserMessageId,
    onIsAtEndChange,
    onTrailHighlightsChange,
    onMessagesScroll,
    onMessagesPointerCancel,
    onMessagesPointerDown,
    onMessagesTouchMove,
    onMessagesTouchStart,
    onMessagesWheel,
  } = props;

  // Latest rows kept in a ref so the imperative scroll controller can look up a message's index
  // lazily without re-installing the controller on every transcript change.
  const rowsRef = useRef(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows, rowsRef]);

  const jumpHighlightTimeoutRef = useRef<number | null>(null);

  const findFineScrollFrameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (jumpHighlightTimeoutRef.current !== null) {
        window.clearTimeout(jumpHighlightTimeoutRef.current);
      }
      if (findFineScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(findFineScrollFrameRef.current);
      }
    },
    [jumpHighlightTimeoutRef, findFineScrollFrameRef],
  );

  useEffect(() => {
    if (!controllerRef) {
      return;
    }
    const scrollToMessage = (
      messageId: MessageId,
      segmentIndex?: number,
    ): ReturnType<typeof resolveThreadFindJumpTarget> => {
      const target = resolveThreadFindJumpTarget(rowsRef.current, {
        messageId,
        ...(segmentIndex === undefined ? {} : { segmentIndex }),
      });
      if (!target) {
        return null;
      }
      onNavigate?.();
      if (target.expandCollapsedWorkMessageId) {
        setCollapsedWorkExpanded(target.expandCollapsedWorkMessageId, true);
      }
      setExpandedUserMessagesById((previous) => {
        const expandIds = [messageId, target.visibleMessageId];
        let changed = false;
        const next = { ...previous };
        for (const id of expandIds) {
          if (next[id] !== true) {
            next[id] = true;
            changed = true;
          }
        }
        return changed ? next : previous;
      });
      scrollLegendListToIndex(resolvedListRef, {
        index: target.rowIndex,
        animated: true,
        viewPosition: 0.2,
      });
      return target;
    };
    const clearJumpHighlightAfterDelay = () => {
      if (jumpHighlightTimeoutRef.current !== null) {
        window.clearTimeout(jumpHighlightTimeoutRef.current);
      }
      jumpHighlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedMessageId(null);
        jumpHighlightTimeoutRef.current = null;
      }, JUMP_HIGHLIGHT_DURATION_MS);
    };
    const cancelPendingFindFineScroll = () => {
      if (findFineScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(findFineScrollFrameRef.current);
        findFineScrollFrameRef.current = null;
      }
    };
    const applyActiveFindMatch = () => {
      const root = timelineRootRef.current;
      const match = activeFindMatchRef.current;
      applyActiveChatFindMatch(root, null);
      if (!root || match === null) {
        return;
      }
      const segmentSelector =
        match.segmentIndex === undefined
          ? ":not([data-chat-find-segment-index])"
          : `[data-chat-find-segment-index="${String(match.segmentIndex)}"]`;
      const scope = root.querySelector(
        `[data-chat-find-document-id="${cssAttributeSelectorValue(match.messageId)}"]${segmentSelector}`,
      );
      applyActiveChatFindMatch(scope, match);
    };
    const scheduleFindMatchFineScroll = (
      target: NonNullable<ReturnType<typeof resolveThreadFindJumpTarget>>,
    ) => {
      cancelPendingFindFineScroll();
      const deadlineMs = getMonotonicTimeMs() + FIND_FINE_SCROLL_RETRY_TIMEOUT_MS;
      let attempts = 0;
      const tick = () => {
        findFineScrollFrameRef.current = null;
        const root = timelineRootRef.current;
        if (!root) {
          return;
        }
        applyActiveFindMatch();
        const narrationId = target.collapsedNarrationMessageId;
        const scope =
          narrationId === undefined
            ? root
            : (root.querySelector(
                `[data-chat-find-narration-id="${cssAttributeSelectorValue(narrationId)}"]`,
              ) ?? root);
        const activeMatch = scope.querySelector('[data-chat-find-match="active"]');
        if (activeMatch instanceof HTMLElement) {
          activeMatch.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
          return;
        }
        if (narrationId !== undefined) {
          const narration = root.querySelector(
            `[data-chat-find-narration-id="${cssAttributeSelectorValue(narrationId)}"]`,
          );
          if (narration instanceof HTMLElement) {
            narration.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
            return;
          }
        }
        attempts += 1;
        if (getMonotonicTimeMs() <= deadlineMs && attempts < FIND_FINE_SCROLL_MAX_RETRY_FRAMES) {
          findFineScrollFrameRef.current = window.requestAnimationFrame(tick);
        }
      };
      findFineScrollFrameRef.current = window.requestAnimationFrame(tick);
    };
    const controller: MessagesTimelineController = {
      scrollToMessage: (messageId, options) => {
        cancelPendingFindFineScroll();
        const target = scrollToMessage(messageId, options?.segmentIndex);
        if (!target) {
          return;
        }
        setHighlightedMessageId(target.visibleMessageId);
        clearJumpHighlightAfterDelay();
        if (options?.fineScrollFind || target.collapsedNarrationMessageId) {
          scheduleFindMatchFineScroll(target);
        }
      },
      setActiveFindMatch: (match) => {
        activeFindMatchRef.current = match;
        applyActiveFindMatch();
      },
    };
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [
    controllerRef,
    onNavigate,
    resolvedListRef,
    setCollapsedWorkExpanded,
    rowsRef,
    setExpandedUserMessagesById,
    jumpHighlightTimeoutRef,
    setHighlightedMessageId,
    findFineScrollFrameRef,
    timelineRootRef,
    activeFindMatchRef,
  ]);

  const tailContentRowId = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]!;
      if (row.kind !== "working" && row.kind !== "worktree-setup") return row.id;
    }
    return null;
  }, [rows]);

  const tailScrollFrameRef = useRef<number | null>(null);

  const tailScrollTimeoutsRef = useRef<number[]>([]);

  const tailExpansionScrollSuppressedRef = useRef(false);

  const clearTailExpansionScrollTimers = useCallback(() => {
    if (tailScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(tailScrollFrameRef.current);
      tailScrollFrameRef.current = null;
    }
    for (const timeoutId of tailScrollTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    tailScrollTimeoutsRef.current = [];
  }, [tailScrollFrameRef, tailScrollTimeoutsRef]);

  const scrollTailExpansionToEnd = useCallback(() => {
    clearTailExpansionScrollTimers();
    if (tailExpansionScrollSuppressedRef.current) {
      return;
    }
    const scrollToEnd = () => {
      scrollLegendListToEnd(resolvedListRef);
    };
    tailScrollFrameRef.current = window.requestAnimationFrame(() => {
      tailScrollFrameRef.current = null;
      scrollToEnd();
    });
    for (const delay of [80, 180, 260]) {
      const timeoutId = window.setTimeout(scrollToEnd, delay);
      tailScrollTimeoutsRef.current.push(timeoutId);
    }
  }, [
    clearTailExpansionScrollTimers,
    resolvedListRef,
    tailExpansionScrollSuppressedRef,
    tailScrollFrameRef,
    tailScrollTimeoutsRef,
  ]);

  useEffect(() => clearTailExpansionScrollTimers, [clearTailExpansionScrollTimers]);

  const ignoreTimelineImageLoad = useCallback(() => {}, []);

  const latestEditableUserMessageId = editableUserMessageId ?? null;

  const previousRowCountRef = useRef(rows.length);

  useEffect(() => {
    const previousRowCount = previousRowCountRef.current;
    previousRowCountRef.current = rows.length;
    if (previousRowCount > 0 || rows.length === 0) {
      return;
    }
    onIsAtEndChange?.(true);
    const frameId = window.requestAnimationFrame(() => {
      scrollLegendListToEnd(resolvedListRef);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [onIsAtEndChange, resolvedListRef, rows.length, previousRowCountRef]);

  // Sent-message anchors (id + position in the virtualized row list) for the navigation trail. Held
  // in a ref so the viewability callback stays stable and doesn't re-subscribe LegendList on every
  // transcript change.
  const userMessageAnchors = useMemo<MessageTrailAnchor[]>(() => {
    const anchors: MessageTrailAnchor[] = [];
    rows.forEach((row, index) => {
      if (row.kind === "message" && row.message.role === "user") {
        anchors.push({ id: row.message.id, rowIndex: index });
      }
    });
    return anchors;
  }, [rows]);

  const userMessageAnchorsRef = useRef(userMessageAnchors);

  useLayoutEffect(() => {
    userMessageAnchorsRef.current = userMessageAnchors;
  }, [userMessageAnchors, userMessageAnchorsRef]);

  const emitTrailHighlightsForViewport = useCallback(
    (topRowIndex: number, bottomRowIndex: number) => {
      if (!onTrailHighlightsChange || !Number.isFinite(topRowIndex)) {
        return;
      }
      onTrailHighlightsChange(
        resolveActiveTrailSnapshot(userMessageAnchorsRef.current, topRowIndex, bottomRowIndex),
      );
    },
    [onTrailHighlightsChange, userMessageAnchorsRef],
  );

  const listScrollFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (listScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(listScrollFrameRef.current);
        listScrollFrameRef.current = null;
      }
    };
  }, [listScrollFrameRef]);

  const handleListScroll = useCallback<NonNullable<MessagesTimelineProps["onMessagesScroll"]>>(
    (event) => {
      onMessagesScroll?.(event);
      const state = readLegendListState(resolvedListRef);
      if (!state) {
        return;
      }
      tailExpansionScrollSuppressedRef.current = !state.isAtEnd;
      if (!state.isAtEnd) {
        clearTailExpansionScrollTimers();
      }
      onIsAtEndChange?.(state.isAtEnd);
      if (listScrollFrameRef.current !== null) {
        return;
      }
      listScrollFrameRef.current = window.requestAnimationFrame(() => {
        listScrollFrameRef.current = null;
        const frameState = readLegendListState(resolvedListRef);
        if (frameState) {
          emitTrailHighlightsForViewport(frameState.start, frameState.end);
        }
      });
    },
    [
      clearTailExpansionScrollTimers,
      emitTrailHighlightsForViewport,
      onIsAtEndChange,
      onMessagesScroll,
      resolvedListRef,
      tailExpansionScrollSuppressedRef,
      listScrollFrameRef,
    ],
  );

  const suppressTailExpansionScroll = useCallback(() => {
    tailExpansionScrollSuppressedRef.current = true;
    clearTailExpansionScrollTimers();
  }, [clearTailExpansionScrollTimers, tailExpansionScrollSuppressedRef]);

  const handleMessagesPointerCancel = useCallback<
    NonNullable<MessagesTimelineProps["onMessagesPointerCancel"]>
  >(
    (event) => {
      clearTailExpansionScrollTimers();
      onMessagesPointerCancel?.(event);
    },
    [clearTailExpansionScrollTimers, onMessagesPointerCancel],
  );

  const handleMessagesPointerDown = useCallback<
    NonNullable<MessagesTimelineProps["onMessagesPointerDown"]>
  >(
    (event) => {
      clearTailExpansionScrollTimers();
      onMessagesPointerDown?.(event);
    },
    [clearTailExpansionScrollTimers, onMessagesPointerDown],
  );

  const handleMessagesTouchMove = useCallback<
    NonNullable<MessagesTimelineProps["onMessagesTouchMove"]>
  >(
    (event) => {
      suppressTailExpansionScroll();
      onMessagesTouchMove?.(event);
    },
    [onMessagesTouchMove, suppressTailExpansionScroll],
  );

  const handleMessagesTouchStart = useCallback<
    NonNullable<MessagesTimelineProps["onMessagesTouchStart"]>
  >(
    (event) => {
      clearTailExpansionScrollTimers();
      onMessagesTouchStart?.(event);
    },
    [clearTailExpansionScrollTimers, onMessagesTouchStart],
  );

  const handleMessagesWheel = useCallback<NonNullable<MessagesTimelineProps["onMessagesWheel"]>>(
    (event) => {
      suppressTailExpansionScroll();
      onMessagesWheel?.(event);
    },
    [onMessagesWheel, suppressTailExpansionScroll],
  );

  const handleViewableItemsChanged = useCallback<
    NonNullable<ComponentProps<typeof LegendList>["onViewableItemsChanged"]>
  >(
    ({ viewableItems }) => {
      let topIndex = Number.POSITIVE_INFINITY;
      let bottomIndex = Number.NEGATIVE_INFINITY;
      for (const token of viewableItems) {
        if (token.isViewable) {
          topIndex = Math.min(topIndex, token.index);
          bottomIndex = Math.max(bottomIndex, token.index);
        }
      }
      emitTrailHighlightsForViewport(topIndex, bottomIndex);
    },
    [emitTrailHighlightsForViewport],
  );

  useEffect(() => {
    if (!onTrailHighlightsChange) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      const state = readLegendListState(resolvedListRef);
      if (state) {
        emitTrailHighlightsForViewport(state.start, state.end);
      }
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [emitTrailHighlightsForViewport, onTrailHighlightsChange, resolvedListRef, rows.length]);
  return {
    tailContentRowId,
    scrollTailExpansionToEnd,
    ignoreTimelineImageLoad,
    latestEditableUserMessageId,
    handleListScroll,
    handleMessagesPointerCancel,
    handleMessagesPointerDown,
    handleMessagesTouchMove,
    handleMessagesTouchStart,
    handleMessagesWheel,
    handleViewableItemsChanged,
  } as const;
}
