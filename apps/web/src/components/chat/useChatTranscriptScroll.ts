import type { LegendListRef } from "@legendapp/list/react";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Debouncer } from "@tanstack/react-pacer";
import type { RefObject } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type WheelEvent,
} from "react";
import { flushSync } from "react-dom";
import { isScrollContainerNearBottom } from "../../chat-scroll";
import { isEditableEventTarget } from "../../lib/editableEventTarget";
import type { TimelineEntry } from "../../workLog.types";
import { buildTranscriptAutoFollowSignal, buildTranscriptTailKey } from "../ChatView.logic.session";
import {
  scrollTranscriptToSettledEnd,
  stopTranscriptScrollAtCurrentOffset,
} from "./transcriptScroll";

interface ChatTranscriptScrollInput {
  activeThreadId: ThreadId | null;
  legendListRef: RefObject<LegendListRef | null>;
  timelineEntries: readonly TimelineEntry[];
  hasStreamingAssistantText: boolean;
  composerTranscriptInsetPx: number;
  isInactiveSplitPane: boolean;
}

export function useChatTranscriptScroll({
  activeThreadId,
  legendListRef,
  timelineEntries,
  hasStreamingAssistantText,
  composerTranscriptInsetPx,
  isInactiveSplitPane,
}: ChatTranscriptScrollInput) {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const isAtEndRef = useRef(true);
  const autoFollowThreadIdRef = useRef<ThreadId | null>(null);
  const pendingInteractionAnchorRef = useRef<{
    element: HTMLElement;
    top: number;
  } | null>(null);
  const pendingInteractionAnchorFrameRef = useRef<number | null>(null);
  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), { wait: 150 }),
  );

  useEffect(() => {
    const scrollDebouncer = showScrollDebouncer.current;
    return () => {
      scrollDebouncer.cancel();
      const pendingFrame = pendingInteractionAnchorFrameRef.current;
      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame);
      }
    };
  }, []);

  const tailAnchorScrollInFlightRef = useRef(false);

  const programmaticScrollUntilRef = useRef(0);

  const [isUserScrollDetached, setIsUserScrollDetached] = useState(false);
  const isUserScrollDetachedRef = useRef(isUserScrollDetached);
  const setTranscriptScrollDetached = useCallback((detached: boolean) => {
    isUserScrollDetachedRef.current = detached;
    setIsUserScrollDetached(detached);
  }, []);
  const pendingScrollGestureRef = useRef<{
    container: HTMLElement;
    scrollTop: number;
    wasFollowing: boolean;
    keyboard?: boolean;
  } | null>(null);
  const pendingScrollGestureFrameRef = useRef<number | null>(null);
  const cancelPendingScrollGesture = useCallback(() => {
    const frameId = pendingScrollGestureFrameRef.current;
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    pendingScrollGestureFrameRef.current = null;
    pendingScrollGestureRef.current = null;
  }, []);
  useEffect(() => cancelPendingScrollGesture, [activeThreadId, cancelPendingScrollGesture]);

  const settledScrollRequestRef = useRef(0);
  const settledScrollInFlightRef = useRef(false);

  const animateNextAutoFollowScrollRef = useRef(false);
  const scrollToEnd = useCallback(
    (animated = false) => {
      const target = legendListRef.current;
      const container = target?.getScrollableNode();
      // An unnecessary end target makes the list compensate later row resizes even when everything fits.
      if (container instanceof HTMLElement && isScrollContainerNearBottom(container, 1)) return;
      programmaticScrollUntilRef.current = performance.now() + 200;
      void target?.scrollToEnd({ animated });
    },
    [legendListRef],
  );
  const armTranscriptAutoFollow = useCallback(
    (targetThreadId: ThreadId, animated = false) => {
      cancelPendingScrollGesture();
      autoFollowThreadIdRef.current = targetThreadId;
      animateNextAutoFollowScrollRef.current = animated;
      isAtEndRef.current = true;
      setTranscriptScrollDetached(false);
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
    },
    [cancelPendingScrollGesture, setTranscriptScrollDetached],
  );
  const clearTranscriptAutoFollow = useCallback(
    (synchronous = false) => {
      cancelPendingScrollGesture();
      const scrollTarget = settledScrollInFlightRef.current ? legendListRef.current : null;
      autoFollowThreadIdRef.current = null;
      animateNextAutoFollowScrollRef.current = false;
      settledScrollRequestRef.current += 1;
      settledScrollInFlightRef.current = false;
      programmaticScrollUntilRef.current = 0;

      tailAnchorScrollInFlightRef.current = false;
      const container = legendListRef.current?.getScrollableNode();
      const detached =
        container instanceof HTMLElement && container.scrollHeight > container.clientHeight + 1;
      if (detached !== isUserScrollDetachedRef.current) {
        // Disable list-owned follow before an already queued animation frame can run. Continuous wheel
        // events otherwise defer this prop update in React.
        if (synchronous) flushSync(() => setTranscriptScrollDetached(detached));
        else setTranscriptScrollDetached(detached);
      }
      if (scrollTarget) {
        void stopTranscriptScrollAtCurrentOffset(scrollTarget);
      }
    },
    [legendListRef, cancelPendingScrollGesture, setTranscriptScrollDetached],
  );
  const onTranscriptNavigate = useCallback(() => {
    clearTranscriptAutoFollow();
    isAtEndRef.current = false;
    showScrollDebouncer.current.maybeExecute();
  }, [clearTranscriptAutoFollow]);
  const transcriptMessageCount = useMemo(
    () => timelineEntries.filter((entry) => entry.kind === "message").length,
    [timelineEntries],
  );
  const latestTranscriptMessage = useMemo(() => {
    for (let index = timelineEntries.length - 1; index >= 0; index -= 1) {
      const entry = timelineEntries[index];
      if (entry?.kind === "message") {
        return entry.message;
      }
    }
    return null;
  }, [timelineEntries]);
  const transcriptTailKey = buildTranscriptTailKey(latestTranscriptMessage);
  const transcriptAutoFollowSignal = buildTranscriptAutoFollowSignal({
    messageCount: transcriptMessageCount,
    tailKey: transcriptTailKey,
  });
  const onIsAtEndChange = useCallback(
    (isAtEnd: boolean) => {
      const container = legendListRef.current?.getScrollableNode();
      const pending = pendingScrollGestureRef.current;
      if (pending?.keyboard && container === pending.container) {
        if (container.scrollTop >= pending.scrollTop || isScrollContainerNearBottom(container, 1))
          return;
        pendingScrollGestureRef.current = null;
      }
      if (!isAtEnd && !isUserScrollDetachedRef.current) {
        if (
          hasStreamingAssistantText &&
          container instanceof HTMLElement &&
          !isScrollContainerNearBottom(container, 1) &&
          !tailAnchorScrollInFlightRef.current &&
          !settledScrollInFlightRef.current &&
          performance.now() >= programmaticScrollUntilRef.current
        ) {
          const request = settledScrollRequestRef.current;
          programmaticScrollUntilRef.current = performance.now() + 200;
          window.requestAnimationFrame(() => {
            if (
              request === settledScrollRequestRef.current &&
              !isUserScrollDetachedRef.current &&
              !tailAnchorScrollInFlightRef.current &&
              !settledScrollInFlightRef.current &&
              legendListRef.current?.getScrollableNode() === container &&
              !isScrollContainerNearBottom(container, 1)
            )
              scrollToEnd();
          });
        }
        return;
      }
      if (
        !isAtEnd &&
        (tailAnchorScrollInFlightRef.current ||
          settledScrollInFlightRef.current ||
          performance.now() < programmaticScrollUntilRef.current)
      ) {
        return;
      }

      const atEnd =
        isAtEnd &&
        (!isUserScrollDetachedRef.current ||
          !(container instanceof HTMLElement) ||
          isScrollContainerNearBottom(container, 1));
      if (atEnd === isAtEndRef.current && (!atEnd || !isUserScrollDetachedRef.current)) return;
      // A gesture can detach without changing the previous edge notification.
      if (atEnd) {
        setTranscriptScrollDetached(false);
        showScrollDebouncer.current.cancel();
        setShowScrollToBottom(false);
      } else {
        // A changing layout can temporarily leave the end during output. Only user gestures detach live
        // follow; a geometry notification must not.
        showScrollDebouncer.current.maybeExecute();
      }
      isAtEndRef.current = atEnd;
    },
    [legendListRef, hasStreamingAssistantText, scrollToEnd, setTranscriptScrollDetached],
  );
  const cancelPendingInteractionAnchorAdjustment = useCallback(() => {
    const pendingFrame = pendingInteractionAnchorFrameRef.current;
    if (pendingFrame === null) return;
    pendingInteractionAnchorFrameRef.current = null;
    window.cancelAnimationFrame(pendingFrame);
  }, []);
  const onMessagesClickCaptureBase = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const scrollContainer = legendListRef.current?.getScrollableNode?.();
      if (!(scrollContainer instanceof HTMLElement) || !(event.target instanceof Element)) return;

      const trigger = event.target.closest<HTMLElement>(
        "button, summary, [role='button'], [data-scroll-anchor-target]",
      );
      if (!trigger || !scrollContainer.contains(trigger)) return;
      if (trigger.closest("[data-scroll-anchor-ignore]")) return;

      pendingInteractionAnchorRef.current = {
        element: trigger,
        top: trigger.getBoundingClientRect().top,
      };

      cancelPendingInteractionAnchorAdjustment();
      pendingInteractionAnchorFrameRef.current = window.requestAnimationFrame(() => {
        pendingInteractionAnchorFrameRef.current = null;
        const anchor = pendingInteractionAnchorRef.current;
        pendingInteractionAnchorRef.current = null;
        const activeScrollContainer = legendListRef.current?.getScrollableNode?.();
        if (!(activeScrollContainer instanceof HTMLElement) || !anchor) return;
        if (!anchor.element.isConnected || !activeScrollContainer.contains(anchor.element)) return;

        const nextTop = anchor.element.getBoundingClientRect().top;
        const delta = nextTop - anchor.top;
        if (Math.abs(delta) < 0.5) return;

        activeScrollContainer.scrollTop += delta;
      });
    },
    [legendListRef, cancelPendingInteractionAnchorAdjustment],
  );
  const onMessagesPointerDownBase = useCallback(() => {
    clearTranscriptAutoFollow(true);
  }, [clearTranscriptAutoFollow]);
  const releaseTranscriptScrollGesture = useCallback(() => {
    const state = legendListRef.current?.getState();
    if (state) onIsAtEndChange(state.isAtEnd);
  }, [legendListRef, onIsAtEndChange]);
  const onMessagesPointerCancelBase = releaseTranscriptScrollGesture;
  const onMessagesPointerUpBase = releaseTranscriptScrollGesture;
  const onMessagesScrollBase = useCallback(() => {}, []);
  const onMessagesTouchEndBase = releaseTranscriptScrollGesture;
  const onMessagesTouchMoveBase = useCallback(() => {
    clearTranscriptAutoFollow(true);
  }, [clearTranscriptAutoFollow]);
  const onMessagesTouchStartBase = useCallback(() => {
    clearTranscriptAutoFollow(true);
  }, [clearTranscriptAutoFollow]);
  const onMessagesScrollGesture = useCallback(
    (upward: boolean) => {
      const container = legendListRef.current?.getScrollableNode();
      if (!(container instanceof HTMLElement)) return;
      if (!upward && isAtEndRef.current && isScrollContainerNearBottom(container, 1)) return;
      const pending = pendingScrollGestureRef.current;
      const origin =
        pending?.container === container
          ? pending
          : {
              container,
              scrollTop: container.scrollTop,
              wasFollowing:
                isAtEndRef.current &&
                !isUserScrollDetachedRef.current &&
                (!upward || isScrollContainerNearBottom(container, 1)),
            };
      clearTranscriptAutoFollow(true);
      pendingScrollGestureRef.current = origin;

      pendingScrollGestureFrameRef.current = window.requestAnimationFrame(() => {
        pendingScrollGestureFrameRef.current = window.requestAnimationFrame(() => {
          pendingScrollGestureFrameRef.current = null;
          pendingScrollGestureRef.current = null;
          if (origin.wasFollowing && container.scrollTop >= origin.scrollTop) {
            // A nested or no-op wheel must not strand follow, even if new text increased the distance from the
            // bottom while the gesture settled.
            setTranscriptScrollDetached(false);
            onIsAtEndChange(true);
            scrollToEnd();
          } else {
            releaseTranscriptScrollGesture();
          }
        });
      });
    },
    [
      legendListRef,
      clearTranscriptAutoFollow,
      onIsAtEndChange,
      releaseTranscriptScrollGesture,
      scrollToEnd,
      setTranscriptScrollDetached,
    ],
  );
  const onMessagesWheelBase = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (event.ctrlKey || event.deltaY === 0) return;
      onMessagesScrollGesture(event.deltaY < 0);
    },
    [onMessagesScrollGesture],
  );
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const container = legendListRef.current?.getScrollableNode();
      if (
        !(container instanceof HTMLElement) ||
        !(event.target instanceof Element) ||
        !container.contains(event.target) ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableEventTarget(event)
      )
        return;
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
        return;
      if (event.key === " " && event.target.closest("button, a, [role='button']")) return;
      const upward =
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home" ||
        (event.key === " " && event.shiftKey);
      if (upward) {
        if (container.scrollTop <= 0) return;
        const pending = pendingScrollGestureRef.current;
        const origin =
          pending?.keyboard && pending.container === container
            ? pending
            : {
                container,
                scrollTop: container.scrollTop,
                wasFollowing: isAtEndRef.current && !isUserScrollDetachedRef.current,
                keyboard: true,
              };
        clearTranscriptAutoFollow(true);
        pendingScrollGestureRef.current = origin;
        isAtEndRef.current = false;
        showScrollDebouncer.current.maybeExecute();
      } else {
        onMessagesScrollGesture(false);
      }
    };
    const releaseKeyboardGesture = () => {
      const origin = pendingScrollGestureRef.current;
      if (!origin?.keyboard) return;
      const previousFrame = pendingScrollGestureFrameRef.current;
      if (previousFrame !== null) window.cancelAnimationFrame(previousFrame);

      const deadline = performance.now() + 150;
      const check = () => {
        pendingScrollGestureFrameRef.current = null;
        if (pendingScrollGestureRef.current !== origin) return;
        const movedUp = origin.container.scrollTop < origin.scrollTop - 1;
        if (!movedUp && performance.now() < deadline) {
          pendingScrollGestureFrameRef.current = window.requestAnimationFrame(check);
          return;
        }
        pendingScrollGestureRef.current = null;
        if (origin.wasFollowing && !movedUp) {
          setTranscriptScrollDetached(false);
          onIsAtEndChange(true);
          scrollToEnd();
        } else {
          releaseTranscriptScrollGesture();
        }
      };
      pendingScrollGestureFrameRef.current = window.requestAnimationFrame(check);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", releaseKeyboardGesture);
    window.addEventListener("blur", releaseKeyboardGesture);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", releaseKeyboardGesture);
      window.removeEventListener("blur", releaseKeyboardGesture);
    };
  }, [
    legendListRef,
    clearTranscriptAutoFollow,
    onIsAtEndChange,
    onMessagesScrollGesture,
    releaseTranscriptScrollGesture,
    scrollToEnd,
    setTranscriptScrollDetached,
  ]);

  useLayoutEffect(() => {
    isAtEndRef.current = true;
    settledScrollRequestRef.current += 1;
    settledScrollInFlightRef.current = false;
    programmaticScrollUntilRef.current = 0;
    setTranscriptScrollDetached(false);
    showScrollDebouncer.current.cancel();
    const settle = window.setTimeout(() => setShowScrollToBottom(false), 0);
    return () => window.clearTimeout(settle);
  }, [activeThreadId, setTranscriptScrollDetached]);
  useLayoutEffect(() => {
    const shouldFollowPendingTurn =
      activeThreadId !== null && autoFollowThreadIdRef.current === activeThreadId;
    if (isUserScrollDetachedRef.current || (!isAtEndRef.current && !shouldFollowPendingTurn)) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (tailAnchorScrollInFlightRef.current || isUserScrollDetachedRef.current) {
        return;
      }
      const shouldAnimate = animateNextAutoFollowScrollRef.current;
      animateNextAutoFollowScrollRef.current = false;
      scrollToEnd(shouldAnimate);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeThreadId, scrollToEnd, transcriptAutoFollowSignal]);

  // Re-stick a transcript that was already parked at the end. This is driven by the *committed* inset
  // rather than by a ResizeObserver on the composer: the inset lands a render after the measurement,
  // so a scroll scheduled from the observer would race the padding it is supposed to compensate for.
  // Here the new padding is already in the DOM, so the pre-resize viewport is simply the current one
  // with the inset delta backed out.
  const previousComposerTranscriptInsetRef = useRef({
    threadId: activeThreadId ?? null,
    insetPx: composerTranscriptInsetPx,
  });
  useLayoutEffect(() => {
    const threadId = activeThreadId ?? null;
    const previous = previousComposerTranscriptInsetRef.current;
    previousComposerTranscriptInsetRef.current = {
      threadId,
      insetPx: composerTranscriptInsetPx,
    };
    if (previous.threadId !== threadId) return;

    const insetDeltaPx = composerTranscriptInsetPx - previous.insetPx;
    if (isInactiveSplitPane || Math.abs(insetDeltaPx) < 0.5) return;

    const scrollContainer = legendListRef.current?.getScrollableNode?.();
    if (!(scrollContainer instanceof HTMLElement)) return;
    const wasNearEndBeforeResize = isScrollContainerNearBottom({
      scrollTop: scrollContainer.scrollTop,
      clientHeight: scrollContainer.clientHeight,
      scrollHeight: scrollContainer.scrollHeight - insetDeltaPx,
    });
    if (!wasNearEndBeforeResize) return;

    // Anchored end space absorbs composer growth without moving content. Only compensate the
    // portion that actually pushes the transcript footer past the viewport.
    const footer = scrollContainer.querySelector<HTMLElement>("[data-tail-anchor-spacer]");
    let scrollDeltaPx = insetDeltaPx;
    if (footer) {
      const contentEndPx = footer.getBoundingClientRect().bottom;
      const viewportEndPx = scrollContainer.getBoundingClientRect().bottom;
      scrollDeltaPx =
        insetDeltaPx > 0
          ? Math.min(
              insetDeltaPx,
              Math.max(0, contentEndPx + composerTranscriptInsetPx - viewportEndPx),
            )
          : contentEndPx + previous.insetPx < viewportEndPx - 1
            ? 0
            : insetDeltaPx;
    }
    if (Math.abs(scrollDeltaPx) < 0.5) return;

    programmaticScrollUntilRef.current = performance.now() + 200;
    scrollContainer.scrollTop += scrollDeltaPx;
  }, [legendListRef, activeThreadId, composerTranscriptInsetPx, isInactiveSplitPane]);

  const onScrollToBottom = useCallback(() => {
    cancelPendingScrollGesture();
    tailAnchorScrollInFlightRef.current = false;
    setTranscriptScrollDetached(false);
    isAtEndRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    const target = legendListRef.current;
    if (!target) {
      return;
    }

    const requestId = settledScrollRequestRef.current + 1;
    settledScrollRequestRef.current = requestId;
    settledScrollInFlightRef.current = true;
    programmaticScrollUntilRef.current = performance.now() + 200;
    void scrollTranscriptToSettledEnd({
      target,
      isCurrent: () =>
        settledScrollRequestRef.current === requestId && legendListRef.current === target,
      beforeFinalScroll: () => {
        programmaticScrollUntilRef.current = performance.now() + 200;
      },
    })
      .then((settled) => {
        if (settledScrollRequestRef.current !== requestId) {
          return;
        }
        settledScrollInFlightRef.current = false;
        if (!settled) {
          return;
        }
        isAtEndRef.current = true;
        showScrollDebouncer.current.cancel();
        setShowScrollToBottom(false);
      })
      .catch(() => {
        if (settledScrollRequestRef.current === requestId) {
          settledScrollInFlightRef.current = false;
        }
      });
  }, [legendListRef, cancelPendingScrollGesture, setTranscriptScrollDetached]);

  const previousThreadIdRef = useRef(activeThreadId);
  const pendingStreamingThreadRef = useRef<ThreadId | null>(null);
  useEffect(() => {
    if (previousThreadIdRef.current !== activeThreadId) {
      previousThreadIdRef.current = activeThreadId;
      pendingStreamingThreadRef.current = activeThreadId;
    }
    if (
      activeThreadId === null ||
      !hasStreamingAssistantText ||
      pendingStreamingThreadRef.current !== activeThreadId
    )
      return;
    pendingStreamingThreadRef.current = null;

    let cancelled = false;
    const settleAtEnd = async () => {
      const target = legendListRef.current;
      if (!target) return;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (
          cancelled ||
          tailAnchorScrollInFlightRef.current ||
          isUserScrollDetachedRef.current ||
          legendListRef.current !== target
        )
          return;
        programmaticScrollUntilRef.current = performance.now() + 200;
        await target.scrollToEnd({ animated: false });
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
        if (
          cancelled ||
          tailAnchorScrollInFlightRef.current ||
          isUserScrollDetachedRef.current ||
          legendListRef.current !== target
        )
          return;
        const node = target.getScrollableNode();
        if (node instanceof HTMLElement && isScrollContainerNearBottom(node, 1)) return;
      }
    };
    const frameId = window.requestAnimationFrame(() => void settleAtEnd());
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [activeThreadId, hasStreamingAssistantText, legendListRef]);

  return {
    showScrollToBottom,
    isUserScrollDetached,
    tailAnchorScrollInFlightRef,
    armTranscriptAutoFollow,
    onTranscriptNavigate,
    onIsAtEndChange,
    onScrollToBottom,
    onMessagesClickCaptureBase,
    onMessagesPointerDownBase,
    onMessagesPointerUpBase,
    onMessagesPointerCancelBase,
    onMessagesScrollBase,
    onMessagesTouchEndBase,
    onMessagesTouchMoveBase,
    onMessagesTouchStartBase,
    onMessagesWheelBase,
  };
}
