import { useLayoutEffect, type RefObject } from "react";

export function syncAnimationsToTimelineOrigin(element: Element | null): void {
  if (!element || typeof element.getAnimations !== "function") {
    return;
  }
  for (const animation of element.getAnimations()) {
    try {
      animation.startTime = 0;
    } catch {}
  }
}

export function useTimelineSynchronizedAnimations(ref: RefObject<Element | null>): void {
  useLayoutEffect(() => {
    syncAnimationsToTimelineOrigin(ref.current);
  }, [ref]);
}
