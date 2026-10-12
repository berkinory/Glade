import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { DISCLOSURE_CLEANUP_BUFFER_MS, DISCLOSURE_TRANSITION_MS } from "./disclosureMotion";

// Animates clamped text opening to its full height and back. `none` cannot be transitioned, so
// opening runs to the measured height and then drops the limit; closing starts from the measured
// height and runs to the clamp on the next frame. Only a toggle animates: a mount or a font size
// change applies the limit directly.
export function useClampHeightMotion(
  ref: RefObject<HTMLElement | null>,
  expanded: boolean,
  collapsedHeightPx: number,
): string {
  const collapsedMaxHeight = `${collapsedHeightPx}px`;
  const [maxHeight, setMaxHeight] = useState(expanded ? "none" : collapsedMaxHeight);
  const previousExpandedRef = useRef(expanded);

  useLayoutEffect(() => {
    const toggled = previousExpandedRef.current !== expanded;
    previousExpandedRef.current = expanded;
    const element = ref.current;
    if (!toggled || !element) {
      setMaxHeight(expanded ? "none" : collapsedMaxHeight);
      return;
    }
    setMaxHeight(`${element.scrollHeight}px`);
    if (expanded) {
      const timeout = window.setTimeout(
        () => setMaxHeight("none"),
        DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS,
      );
      return () => window.clearTimeout(timeout);
    }
    const frame = window.requestAnimationFrame(() => setMaxHeight(collapsedMaxHeight));
    return () => window.cancelAnimationFrame(frame);
  }, [ref, expanded, collapsedMaxHeight]);

  return maxHeight;
}
