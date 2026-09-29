import { useMemo, useCallback } from "react";

import { type MessageId } from "@glade/contracts";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "~/lib/utils";
import { DISCLOSURE_CONTENT_MOTION_CLASS } from "~/lib/disclosureMotion";
import { APP_TOOLTIP_SURFACE_CLASS_NAME } from "./composerPickerStyles";
import {
  clampNumber,
  clampTooltipTop,
  computeFocusedIndex,
  computeGaussianWeights,
  computeRestStyles,
  computeSigma,
  computeTickStyles,
  computeTrailGeometry,
  type ActiveTrailStore,
  type MessageTrailItem,
  type TickStyle,
  type TrailGeometry,
} from "./messageTrail.logic";

interface MessageTrailProps {
  items: readonly MessageTrailItem[];

  activeStore: ActiveTrailStore;
  onSelect: (messageId: MessageId) => void;
}

const MIN_PANE_WIDTH_PX = 864;

const RAIL_WIDTH_PX = 56;

const RAIL_MAX_HEIGHT_RATIO = 0.8;

const TICK_LEFT_PAD_PX = 14;
const TICK_HEIGHT_PX = 2;

const TICK_BASE_W = 6;
const TICK_MAX_W = 30;

const TICK_SPACING_PX = 10;

const TICK_REST_OPACITY = 0.2;
const TICK_VISIBLE_OPACITY = 0.52;
const TICK_ANCHOR_OPACITY = 0.9;

const TICK_FOCUS_OPACITY = 1;
const TOOLTIP_ESTIMATED_H_PX = 56;
const TOOLTIP_OFFSET_X_PX = 8;

export function MessageTrail({ items, activeStore, onSelect }: MessageTrailProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipMessageRef = useRef<HTMLDivElement | null>(null);
  const tooltipResponseRef = useRef<HTMLDivElement | null>(null);
  const tickRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tooltipId = useId();

  const [hasGutter, setHasGutter] = useState(false);
  const [rovingIndex, setRovingIndex] = useState(0);

  const trailSnapshot = useSyncExternalStore(
    activeStore.subscribe,
    activeStore.get,
    activeStore.get,
  );
  const anchorIndex = items.findIndex((item) => item.id === trailSnapshot.currentId);
  const visibleIdSet = new Set(trailSnapshot.visibleIds);
  const visibleIndexes: number[] = useMemo(() => [], []);
  items.forEach((item, index) => {
    if (visibleIdSet.has(item.id)) {
      visibleIndexes.push(index);
    }
  });
  const visibleIndexSet = new Set(visibleIndexes);

  const visible = hasGutter && items.length > 1;

  const geometry = computeTrailGeometry({ count: items.length, spacingPx: TICK_SPACING_PX });

  const rafIdRef = useRef<number | null>(null);

  const latestPointerClientYRef = useRef<number | null>(null);
  const focusOverrideIndexRef = useRef<number | null>(null);
  const geometryRef = useRef<TrailGeometry | null>(geometry);
  const viewportTopRef = useRef(0);
  const tooltipIndexRef = useRef(-1);
  const reducedMotionRef = useRef(false);

  const itemsRef = useRef(items);
  const anchorIndexRef = useRef(anchorIndex);
  const visibleIndexesRef = useRef(visibleIndexes);
  const onSelectRef = useRef(onSelect);
  const visibleRef = useRef(visible);
  useEffect(() => {
    geometryRef.current = geometry;
    itemsRef.current = items;
    anchorIndexRef.current = anchorIndex;
    visibleIndexesRef.current = visibleIndexes;
    onSelectRef.current = onSelect;
    visibleRef.current = visible;

    if (tickRefs.current.length > items.length) {
      tickRefs.current.length = items.length;
    }
  }, [geometry, items, anchorIndex, visibleIndexes, onSelect, visible]);

  const writeStyles = (styles: readonly TickStyle[]) => {
    const refs = tickRefs.current;
    for (let i = 0; i < styles.length; i += 1) {
      const el = refs[i];
      if (!el) {
        continue;
      }
      el.style.width = `${styles[i]!.width}px`;
      el.style.opacity = `${styles[i]!.opacity}`;
    }
  };

  const hideTooltip = useCallback(() => {
    tooltipIndexRef.current = -1;
    const tip = tooltipRef.current;
    if (tip) {
      tip.style.visibility = "hidden";
    }
  }, []);

  const showTooltip = (index: number, geometry: TrailGeometry) => {
    const tip = tooltipRef.current;
    const item = itemsRef.current[index];
    if (!tip || !item) {
      return;
    }
    if (tooltipIndexRef.current !== index) {
      tooltipIndexRef.current = index;
      const messageEl = tooltipMessageRef.current;
      const responseEl = tooltipResponseRef.current;
      if (messageEl) {
        messageEl.textContent = item.preview;
      }
      if (responseEl) {
        responseEl.textContent = item.responsePreview;

        responseEl.style.display = item.responsePreview ? "" : "none";
      }
    }

    const viewport = viewportRef.current;
    const viewportHeight = viewport?.clientHeight ?? 0;
    const tooltipHeight = tip.offsetHeight || TOOLTIP_ESTIMATED_H_PX;
    const centerY = geometry.centerYs[index] ?? viewportHeight / 2;
    const visibleY = centerY - (viewport?.scrollTop ?? 0);
    const offsetTop = viewport?.offsetTop ?? 0;
    tip.style.top = `${offsetTop + clampTooltipTop(visibleY, tooltipHeight, viewportHeight)}px`;
    tip.style.visibility = "visible";
  };

  const applyHighlightFloors = (styles: TickStyle[]) => {
    const anchorIndexValue = anchorIndexRef.current;
    for (const index of visibleIndexesRef.current) {
      const style = styles[index];
      if (style) {
        style.opacity = Math.max(style.opacity, TICK_VISIBLE_OPACITY);
      }
    }
    const anchorStyle = anchorIndexValue >= 0 ? styles[anchorIndexValue] : undefined;
    if (anchorStyle) {
      anchorStyle.opacity = Math.max(anchorStyle.opacity, TICK_ANCHOR_OPACITY);
    }
  };

  const applyRest = useCallback(() => {
    const styles = computeRestStyles(
      itemsRef.current.length,
      anchorIndexRef.current,
      TICK_BASE_W,
      TICK_REST_OPACITY,
      TICK_ANCHOR_OPACITY,
    );
    applyHighlightFloors(styles);
    writeStyles(styles);
    hideTooltip();
  }, [hideTooltip]);

  // Position the ticks vertically in content space and reset to rest when idle. Width changes never
  // reflow this, so it only runs when the layout changes.
  const layoutTicks = useCallback(() => {
    const geometryValue = geometryRef.current;
    if (!geometryValue) {
      return;
    }
    const refs = tickRefs.current;
    for (let i = 0; i < refs.length; i += 1) {
      const el = refs[i];
      if (!el) {
        continue;
      }
      const centerY = geometryValue.centerYs[i] ?? 0;
      el.style.top = `${centerY - TICK_HEIGHT_PX / 2}px`;
    }
    if (latestPointerClientYRef.current === null && focusOverrideIndexRef.current === null) {
      applyRest();
    }
  }, [applyRest]);

  const renderFrame = () => {
    rafIdRef.current = null;
    const geometry = geometryRef.current;
    if (!geometry || !visibleRef.current) {
      return;
    }
    const count = itemsRef.current.length;
    if (count === 0) {
      return;
    }

    let activeY: number | null = null;
    const rawPointerY = latestPointerClientYRef.current;
    if (rawPointerY !== null) {
      activeY = rawPointerY + (viewportRef.current?.scrollTop ?? 0);
    } else if (focusOverrideIndexRef.current !== null) {
      activeY = geometry.centerYs[focusOverrideIndexRef.current] ?? null;
    }
    if (activeY === null) {
      applyRest();
      return;
    }
    const anchor = anchorIndexRef.current;
    const focusedIndex = computeFocusedIndex(activeY, geometry);

    let styles: TickStyle[];
    if (geometry.spacing === 0 || reducedMotionRef.current) {
      styles = computeRestStyles(
        count,
        anchor,
        TICK_BASE_W,
        TICK_REST_OPACITY,
        TICK_ANCHOR_OPACITY,
      );
      const focusedStyle = styles[focusedIndex];
      if (focusedStyle) {
        focusedStyle.width = TICK_MAX_W;
      }
    } else {
      const sigma = computeSigma(geometry.spacing);
      const weights = computeGaussianWeights(geometry.centerYs, activeY, sigma);
      styles = computeTickStyles(
        weights,
        anchor,
        TICK_BASE_W,
        TICK_MAX_W,
        TICK_REST_OPACITY,
        TICK_ANCHOR_OPACITY,
      );
    }
    applyHighlightFloors(styles);

    const focusedStyle = styles[focusedIndex];
    if (focusedStyle) {
      focusedStyle.opacity = TICK_FOCUS_OPACITY;
    }
    writeStyles(styles);
    showTooltip(focusedIndex, geometry);
  };

  const scheduleFrame = () => {
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(renderFrame);
    }
  };

  const cancelFrame = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const pane = root?.parentElement;
    if (!pane || typeof ResizeObserver === "undefined") {
      return;
    }
    let pendingRaf: number | null = null;
    const measure = () => {
      pendingRaf = null;
      setHasGutter(pane.clientWidth >= MIN_PANE_WIDTH_PX);
    };
    const schedule = () => {
      if (pendingRaf === null) {
        pendingRaf = requestAnimationFrame(measure);
      }
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(pane);
    return () => {
      if (pendingRaf !== null) {
        cancelAnimationFrame(pendingRaf);
      }
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    layoutTicks();
  }, [geometry, layoutTicks]);

  useEffect(() => {
    if (latestPointerClientYRef.current === null && focusOverrideIndexRef.current === null) {
      applyRest();
    }
  }, [anchorIndex, applyRest, visibleIndexes]);

  useEffect(() => {
    reducedMotionRef.current =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
  }, []);

  useEffect(() => {
    if (!visible) {
      cancelFrame();
      latestPointerClientYRef.current = null;
      focusOverrideIndexRef.current = null;
      hideTooltip();
    }
  }, [visible, cancelFrame, hideTooltip]);

  // Unmount: MessageTrail outlives thread switches (the timeline is keyed), so a stray in-flight
  // frame must be cancelled.
  useEffect(() => cancelFrame, [cancelFrame]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || !visibleRef.current) {
      return;
    }
    latestPointerClientYRef.current = event.clientY - viewportTopRef.current;
    scheduleFrame();
  };

  const handlePointerEnter = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || !visibleRef.current) {
      return;
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect) {
      viewportTopRef.current = rect.top;
    }
    latestPointerClientYRef.current = event.clientY - viewportTopRef.current;
    scheduleFrame();
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      return;
    }
    latestPointerClientYRef.current = null;
    cancelFrame();
    // A keyboard-focused tick keeps its magnification; otherwise go to rest.
    if (focusOverrideIndexRef.current !== null) {
      scheduleFrame();
    } else {
      applyRest();
    }
  };

  const handleScroll = () => {
    if (latestPointerClientYRef.current !== null || focusOverrideIndexRef.current !== null) {
      scheduleFrame();
    }
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const geometryValue = geometryRef.current;
    const viewport = viewportRef.current;
    if (!geometryValue || !viewport) {
      return;
    }
    const contentY = event.clientY - viewport.getBoundingClientRect().top + viewport.scrollTop;
    const index = computeFocusedIndex(contentY, geometryValue);
    const item = itemsRef.current[index];
    if (item) {
      onSelectRef.current(item.id);
    }
  };

  const focusTick = (index: number) => {
    setRovingIndex(index);
    tickRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const count = itemsRef.current.length;
    if (count === 0) {
      return;
    }
    const current = clampNumber(rovingIndex, 0, count - 1);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusTick(Math.min(count - 1, current + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        focusTick(Math.max(0, current - 1));
        break;
      case "Home":
        event.preventDefault();
        focusTick(0);
        break;
      case "End":
        event.preventDefault();
        focusTick(count - 1);
        break;
      case "Enter":
      case " ": {
        event.preventDefault();
        const item = itemsRef.current[current];
        if (item) {
          onSelectRef.current(item.id);
        }
        break;
      }
      case "Escape":
        tickRefs.current[current]?.blur();
        break;
      default:
        break;
    }
  };

  const handleTickFocus = (index: number) => {
    focusOverrideIndexRef.current = index;
    const geometry = geometryRef.current;
    if (geometry) {
      showTooltip(index, geometry);
    }
    scheduleFrame();
  };

  const handleRailBlur = (event: ReactFocusEvent<HTMLElement>) => {
    const root = rootRef.current;
    if (root && event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) {
      return;
    }
    focusOverrideIndexRef.current = null;
    if (latestPointerClientYRef.current === null) {
      applyRest();
    }
  };

  const tabStop = clampNumber(rovingIndex, 0, Math.max(0, items.length - 1));

  return (
    <nav
      ref={rootRef}
      aria-label="Message navigation"
      aria-hidden={!visible}
      onKeyDown={handleKeyDown}
      onBlur={handleRailBlur}
      className={cn(
        "absolute inset-y-0 left-0 z-20 hidden flex-col justify-center sm:flex",
        DISCLOSURE_CONTENT_MOTION_CLASS,
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      style={{ width: RAIL_WIDTH_PX }}
    >
      {}
      <div
        ref={viewportRef}
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onScroll={handleScroll}
        onClick={handleClick}
        className={cn(
          "scroll-fade-y relative w-full overflow-y-auto overscroll-contain [contain:layout] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          visible ? "pointer-events-auto" : "pointer-events-none",
        )}
        style={{ maxHeight: `${RAIL_MAX_HEIGHT_RATIO * 100}%` }}
      >
        <div ref={trackRef} className="relative w-full" style={{ height: geometry?.contentHeight }}>
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                tickRefs.current[index] = el;
              }}
              type="button"
              tabIndex={visible && index === tabStop ? 0 : -1}
              aria-label={`Message ${item.ordinal}: ${item.preview.slice(0, 60)}`}
              aria-describedby={tooltipId}
              aria-current={index === anchorIndex ? "location" : undefined}
              onFocus={() => handleTickFocus(index)}
              className="absolute rounded-full transition-[width,opacity] duration-[90ms] ease-out outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-border)] motion-reduce:transition-none"
              style={{
                left: TICK_LEFT_PAD_PX,
                height: TICK_HEIGHT_PX,
                width: TICK_BASE_W,
                opacity:
                  index === anchorIndex
                    ? TICK_ANCHOR_OPACITY
                    : visibleIndexSet.has(index)
                      ? TICK_VISIBLE_OPACITY
                      : TICK_REST_OPACITY,
                backgroundColor: "var(--color-text-foreground)",
                willChange: "width, opacity",
              }}
            />
          ))}
        </div>
      </div>
      <div
        ref={tooltipRef}
        role="tooltip"
        id={tooltipId}
        className={cn(
          APP_TOOLTIP_SURFACE_CLASS_NAME,
          "pointer-events-none invisible absolute z-30 w-64 -translate-y-1/2 rounded-xl p-2",
        )}
        style={{ left: RAIL_WIDTH_PX + TOOLTIP_OFFSET_X_PX, top: 0 }}
      >
        {}
        <div
          ref={tooltipMessageRef}
          className="line-clamp-2 text-ui leading-snug font-medium text-foreground"
        />
        {}
        <div
          ref={tooltipResponseRef}
          className="mt-1 line-clamp-3 text-ui leading-snug text-muted-foreground"
        />
      </div>
    </nav>
  );
}
