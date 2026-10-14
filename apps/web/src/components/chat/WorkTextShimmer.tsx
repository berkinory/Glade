import { useEffect, useRef, type ComponentProps } from "react";

import { cn } from "~/lib/utils";

// Chromium services a running CSS animation every frame even with stepped timing, so a sweep that
// changes 12.5 times a second restyled the page 60 times a second. One shared timer moves every
// visible sweep only when its step changes.
const SHIMMER_STEPS = 30;
const SHIMMER_PERIOD_MS = 2400;
const SHIMMER_STEP_MS = SHIMMER_PERIOD_MS / SHIMMER_STEPS;

const shimmerElements = new Set<HTMLElement>();
let shimmerTimer: number | undefined;

function paintShimmerStep() {
  const step = Math.floor((performance.now() % SHIMMER_PERIOD_MS) / SHIMMER_STEP_MS);
  const position = `${100 - (step * 100) / SHIMMER_STEPS}% 0`;
  for (const element of shimmerElements) {
    element.style.backgroundPosition = position;
  }
}

function startShimmer(element: HTMLElement): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => {};
  }
  shimmerElements.add(element);
  paintShimmerStep();
  shimmerTimer ??= window.setInterval(paintShimmerStep, SHIMMER_STEP_MS);
  return () => {
    shimmerElements.delete(element);
    element.style.removeProperty("background-position");
    if (shimmerElements.size === 0 && shimmerTimer !== undefined) {
      window.clearInterval(shimmerTimer);
      shimmerTimer = undefined;
    }
  };
}

export function WorkTextShimmer({
  active,
  className,
  ...props
}: ComponentProps<"span"> & { active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    return startShimmer(element);
  }, [active]);
  return <span {...props} ref={ref} className={cn(active && "work-text-shimmer", className)} />;
}
