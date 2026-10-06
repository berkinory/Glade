import { useCallback, useEffect, useRef } from "react";

const OUT_OF_VIEW_THRESHOLD_PX = -100_000;

const OVERLAP_EPSILON_PX = 1;

const MAX_CONTAINER_ANCESTOR_DEPTH = 8;

function resolvePositionedContainer(row: HTMLElement): HTMLElement | null {
  let candidate = row.parentElement;
  for (let depth = 0; candidate && depth < MAX_CONTAINER_ANCESTOR_DEPTH; depth += 1) {
    if (candidate.style.position === "absolute" && candidate.style.top !== "") {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

export function useTimelineRowOverlapGuard(): (element: HTMLElement | null) => (() => void) | void {
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedRowsRef = useRef(new Set<HTMLElement>());
  // Last top this guard read or wrote per container, so position observers can
  // skip the guard's own corrections and style changes that do not move a row.
  const knownTopsRef = useRef(new WeakMap<HTMLElement, number>());
  const positionCheckQueuedRef = useRef(false);

  const closeOverlaps = useCallback((entries?: readonly ResizeObserverEntry[]) => {
    const containerTops = new Map<HTMLElement, number>();
    for (const row of observedRowsRef.current) {
      if (!row.isConnected) {
        continue;
      }
      const container = resolvePositionedContainer(row);
      if (!container || containerTops.has(container)) {
        continue;
      }
      const top = Number.parseFloat(container.style.top);
      knownTopsRef.current.set(container, top);
      if (!Number.isFinite(top) || top < OUT_OF_VIEW_THRESHOLD_PX) {
        continue;
      }
      containerTops.set(container, top);
    }
    if (containerTops.size < 2) {
      return;
    }

    if (entries !== undefined) {
      let maxTop = Number.NEGATIVE_INFINITY;
      let maxTopCount = 0;
      for (const top of containerTops.values()) {
        if (top > maxTop) {
          maxTop = top;
          maxTopCount = 1;
        } else if (top === maxTop) {
          maxTopCount += 1;
        }
      }
      if (maxTopCount === 1) {
        let onlyBottomMostResized = true;
        for (const entry of entries) {
          const target = entry.target;
          if (!(target instanceof HTMLElement) || !target.isConnected) {
            continue;
          }
          const container = resolvePositionedContainer(target);

          if (!container) {
            continue;
          }
          const top = containerTops.get(container);
          if (top === undefined) {
            continue;
          }
          if (top !== maxTop) {
            onlyBottomMostResized = false;
            break;
          }
        }
        if (onlyBottomMostResized) {
          return;
        }
      }
    }

    const placed: { container: HTMLElement; top: number; height: number }[] = [];
    for (const [container, top] of containerTops) {
      const height = container.getBoundingClientRect().height;
      if (height <= 0) {
        continue;
      }
      placed.push({ container, top, height });
    }
    placed.sort((left, right) => left.top - right.top);

    for (let index = 1; index < placed.length; index += 1) {
      const previous = placed[index - 1]!;
      const current = placed[index]!;
      const minTop = previous.top + previous.height;
      if (current.top < minTop - OVERLAP_EPSILON_PX) {
        current.top = minTop;
        knownTopsRef.current.set(current.container, minTop);
        current.container.style.top = `${minTop}px`;
      }
    }
  }, []);

  useEffect(() => {
    const observedRows = observedRowsRef.current;
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      observedRows.clear();
    };
  }, []);

  return useCallback(
    (element: HTMLElement | null) => {
      if (!element) {
        return;
      }

      observerRef.current ??= new ResizeObserver(closeOverlaps);
      const observer = observerRef.current;
      observer.observe(element, { box: "border-box" });
      observedRowsRef.current.add(element);

      // The list can commit a stale container top after a resize correction
      // without any row changing size. Mutation callbacks run before paint, and
      // one queued pass covers every container moved in the same batch.
      const container = resolvePositionedContainer(element);
      const positionObserver = container
        ? new MutationObserver(() => {
            if (
              !container.isConnected ||
              positionCheckQueuedRef.current ||
              Number.parseFloat(container.style.top) === knownTopsRef.current.get(container)
            ) {
              return;
            }
            positionCheckQueuedRef.current = true;
            queueMicrotask(() => {
              positionCheckQueuedRef.current = false;
              closeOverlaps();
            });
          })
        : null;
      if (container && positionObserver) {
        positionObserver.observe(container, { attributes: true, attributeFilter: ["style"] });
      }
      return () => {
        positionObserver?.disconnect();
        observer.unobserve(element);
        observedRowsRef.current.delete(element);
      };
    },
    [closeOverlaps],
  );
}
