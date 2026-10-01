import { type MessageId } from "@glade/contracts/core/baseSchemas";
import { type LegendListRef } from "@legendapp/list/react";
import { useLayoutEffect, useRef, type RefObject } from "react";

import { ANCHOR_SLIDE_DURATION_MS, anchorSlideOffsetPx } from "./transcriptScroll";

const ANCHOR_SLIDE_MAX_MS = 3_000;

const ANCHOR_HOLD_QUIET_MS = 450;

const STEER_ANCHOR_MIN_SETTLE_MS = 500;

const ANCHOR_MOUNT_MAX_WAIT_MS = 1_000;

const ANCHOR_OVERFLOW_HANDOFF_FRAMES = 3;

const ANCHOR_OVERFLOW_SLACK_PX = 8;

const ANCHOR_POSITION_CONFIRM_MAX_MS = 150;

type ScrollableListRef = RefObject<Pick<LegendListRef, "getScrollableNode"> | null>;

interface UseTailAnchorScrollOptions {
  listRef: ScrollableListRef;
  timelineRootRef: RefObject<HTMLElement | null>;

  anchorMessageId: MessageId | null;

  anchorScrollInFlightRef?: RefObject<boolean> | undefined;

  onAnchorSlideFinished?: ((messageId: MessageId) => void) | undefined;

  contentChangeSignal?: unknown;

  messageChangeSignal?: unknown;

  animateAnchorSlide?: boolean | undefined;
}

function getScrollContainer(listRef: ScrollableListRef): HTMLElement | null {
  const node: unknown = listRef.current?.getScrollableNode?.();
  return node instanceof HTMLElement ? node : null;
}

function anchoredScrollTargetPx(
  container: HTMLElement,
  anchorElement: HTMLElement | null,
  topInsetPx: number,
): {
  desired: number;
  clamped: number;
  maxScrollTopPx: number;
  offsetFromViewportTop: number;
} | null {
  if (!anchorElement || anchorElement.getClientRects().length === 0) {
    return null;
  }
  const offsetFromViewportTop =
    anchorElement.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const maxScrollTopPx = Math.max(0, container.scrollHeight - container.clientHeight);
  const desired = Math.max(0, container.scrollTop + offsetFromViewportTop - topInsetPx);
  return {
    desired,
    clamped: Math.min(maxScrollTopPx, desired),
    maxScrollTopPx,
    offsetFromViewportTop,
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useTailAnchorScroll({
  listRef,
  timelineRootRef,
  anchorMessageId,
  anchorScrollInFlightRef,
  onAnchorSlideFinished,
  contentChangeSignal,
  messageChangeSignal,
  animateAnchorSlide = true,
}: UseTailAnchorScrollOptions): void {
  const anchorSlideCorrectionRef = useRef<(() => void) | null>(null);
  const lastContentChangeAtRef = useRef(0);
  const animateAnchorSlideRef = useRef(animateAnchorSlide);

  useLayoutEffect(() => {
    animateAnchorSlideRef.current = animateAnchorSlide;
  }, [anchorMessageId, animateAnchorSlide]);

  useLayoutEffect(() => {
    if (anchorMessageId === null) {
      if (anchorScrollInFlightRef) {
        anchorScrollInFlightRef.current = false;
      }
      return;
    }

    const anchorId = anchorMessageId;

    const easeToAnchor = animateAnchorSlideRef.current && !prefersReducedMotion();
    if (anchorScrollInFlightRef) {
      anchorScrollInFlightRef.current = true;
    }

    let disposed = false;
    let frameId: number | null = null;
    let layoutObserver: MutationObserver | null = null;

    let topInsetPx: number | null = null;
    const startedAt = performance.now();

    let hasLanded = false;
    let lastCorrectionAt = startedAt;
    let overflowFrames = 0;

    let confirmedDesired: number | null = null;

    let glideStartedAt: number | null = null;
    let glideFromOffsetPx = 0;

    let hasBeenReachable = false;

    function stopFrameLoop(): void {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      anchorSlideCorrectionRef.current = null;
      layoutObserver?.disconnect();
      layoutObserver = null;
    }

    function finishAnchorSlide(): void {
      stopFrameLoop();
      if (anchorScrollInFlightRef) {
        anchorScrollInFlightRef.current = false;
      }
      onAnchorSlideFinished?.(anchorId);
    }

    function findAnchorElement(): HTMLElement | null {
      return (
        timelineRootRef.current?.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(anchorId)}"]`,
        ) ?? null
      );
    }

    function advanceAnchorSlide(now: number): boolean {
      if (disposed) {
        return true;
      }

      if (anchorScrollInFlightRef && !anchorScrollInFlightRef.current) {
        finishAnchorSlide();
        return true;
      }
      const elapsedMs = now - startedAt;

      const container = getScrollContainer(listRef);
      if (container && topInsetPx === null) {
        topInsetPx = Number.parseFloat(window.getComputedStyle(container).paddingTop) || 0;
      }
      const target = container
        ? anchoredScrollTargetPx(container, findAnchorElement(), topInsetPx ?? 0)
        : null;
      if (!container || target === null) {
        if (elapsedMs < ANCHOR_MOUNT_MAX_WAIT_MS) {
          return false;
        }
        finishAnchorSlide();
        return true;
      }

      // `desired` is the anchor's own position in the content, so it does not change just because the
      // transcript scrolls. Before the first move, a value that does not repeat means the row was
      // measured mid-layout — acting on it would snap the transcript to a coordinate the message never
      // had, and the correction back is the visible jump. Only the snapping path needs this: the glide
      // below re-seeds instead of waiting, because the frames spent waiting are the frames it has to
      // animate in.
      if (!easeToAnchor && !hasLanded && elapsedMs < ANCHOR_POSITION_CONFIRM_MAX_MS) {
        const settled =
          confirmedDesired !== null && Math.abs(target.desired - confirmedDesired) <= 1;
        confirmedDesired = target.desired;
        if (!settled) {
          return false;
        }
      }

      const reachable = target.desired <= target.clamped + 1;
      hasBeenReachable = hasBeenReachable || reachable;

      if (hasLanded && target.maxScrollTopPx - target.desired > ANCHOR_OVERFLOW_SLACK_PX) {
        overflowFrames += 1;
        if (overflowFrames >= ANCHOR_OVERFLOW_HANDOFF_FRAMES) {
          container.scrollTop = target.maxScrollTopPx;
          finishAnchorSlide();
          return true;
        }
      } else {
        overflowFrames = 0;
      }

      const restOffsetPx = topInsetPx ?? 0;
      if (easeToAnchor && !hasLanded) {
        const scheduledOffsetPx =
          glideStartedAt === null
            ? Number.POSITIVE_INFINITY
            : anchorSlideOffsetPx({
                fromPx: glideFromOffsetPx,
                toPx: restOffsetPx,
                elapsedMs: now - glideStartedAt,
              });

        const belowSchedule = target.offsetFromViewportTop > scheduledOffsetPx + 1;
        if (
          glideStartedAt === null ||
          (belowSchedule && (!hasBeenReachable || elapsedMs < ANCHOR_POSITION_CONFIRM_MAX_MS))
        ) {
          glideFromOffsetPx = Math.min(
            Math.max(target.offsetFromViewportTop, restOffsetPx),
            container.clientHeight,
          );
          glideStartedAt = now;
        }
      }

      // The glide is over the instant its schedule is spent, so the frame that would land it takes the
      // absolute coordinate below instead. Relative placement accumulates the sub-pixel error of every
      // rect it was measured against; the hold has to be exact, because from here it is compared against
      // `target.clamped` to decide the anchor has arrived.
      const glideElapsedMs = glideStartedAt === null ? 0 : now - glideStartedAt;
      const gliding =
        glideStartedAt !== null && !hasLanded && glideElapsedMs < ANCHOR_SLIDE_DURATION_MS;

      const nextScrollTopPx = gliding
        ? Math.min(
            target.maxScrollTopPx,
            Math.max(
              0,
              container.scrollTop +
                target.offsetFromViewportTop -
                anchorSlideOffsetPx({
                  fromPx: glideFromOffsetPx,
                  toPx: restOffsetPx,
                  elapsedMs: glideElapsedMs,
                }),
            ),
          )
        : target.clamped;

      if (Math.abs(nextScrollTopPx - container.scrollTop) > 0.5) {
        lastCorrectionAt = now;
        container.scrollTop = nextScrollTopPx;
      }

      if (gliding) {
        return false;
      }

      if (reachable && Math.abs(target.clamped - container.scrollTop) <= 1) {
        hasLanded = true;
      } else {
        lastCorrectionAt = now;
      }

      const minHoldMs = easeToAnchor ? 0 : STEER_ANCHOR_MIN_SETTLE_MS;
      const quiet =
        hasLanded &&
        now - Math.max(lastCorrectionAt, lastContentChangeAtRef.current) >= ANCHOR_HOLD_QUIET_MS;
      if ((!quiet || elapsedMs < minHoldMs) && elapsedMs < ANCHOR_SLIDE_MAX_MS) {
        return false;
      }
      finishAnchorSlide();
      return true;
    }

    anchorSlideCorrectionRef.current = () => {
      advanceAnchorSlide(performance.now());
    };
    const timelineRoot = timelineRootRef.current;
    if (timelineRoot && typeof MutationObserver !== "undefined") {
      layoutObserver = new MutationObserver(() => {
        anchorSlideCorrectionRef.current?.();
      });

      layoutObserver.observe(timelineRoot, {
        attributes: true,
        attributeFilter: ["style"],
        subtree: true,
      });
    }

    const step = () => {
      frameId = null;
      if (!advanceAnchorSlide(performance.now())) {
        frameId = window.requestAnimationFrame(step);
      }
    };
    frameId = window.requestAnimationFrame(step);

    return () => {
      disposed = true;
      stopFrameLoop();
      if (anchorScrollInFlightRef) {
        anchorScrollInFlightRef.current = false;
      }
    };
  }, [anchorMessageId, anchorScrollInFlightRef, listRef, onAnchorSlideFinished, timelineRootRef]);

  // Tool and work activity also update the full timeline, but they must not extend the live-output
  // anchor past the message-stream settle window. This effect is declared before the geometry
  // correction so that, when a new message and a content change land in the same commit, the
  // timestamp updates before the correction runs.
  useLayoutEffect(() => {
    lastContentChangeAtRef.current = performance.now();
  }, [messageChangeSignal]);

  useLayoutEffect(() => {
    anchorSlideCorrectionRef.current?.();
  }, [contentChangeSignal]);
}
