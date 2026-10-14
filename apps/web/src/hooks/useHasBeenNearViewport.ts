import { type RefObject, startTransition, useLayoutEffect, useState } from "react";

// Latches true once the element comes within `marginPx` of the visible part of the window and of
// every scroll container around it.
export function useHasBeenNearViewport(ref: RefObject<Element | null>, marginPx: number): boolean {
  const [near, setNear] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (near || !element) return;
    // The observer reports after the first paint; checking now keeps content that is already on
    // screen from painting its placeholder for a frame.
    const rect = element.getBoundingClientRect();
    const rendered = rect.width > 0 || rect.height > 0;
    if (rendered && rect.bottom >= -marginPx && rect.top <= window.innerHeight + marginPx) {
      setNear(true);
      return;
    }
    const margin = `${marginPx}px 0px`;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        startTransition(() => setNear(true));
      },
      { rootMargin: margin, scrollMargin: margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [marginPx, near, ref]);
  return near;
}
