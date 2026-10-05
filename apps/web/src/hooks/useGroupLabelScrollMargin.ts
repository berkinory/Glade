import { useCallback } from "react";

export function useGroupLabelScrollMargin() {
  return useCallback((label: HTMLElement | null) => {
    const group = label?.closest<HTMLElement>('[role="group"]');
    if (!label || !group) return;

    // Keep the label visible when keyboard navigation scrolls to its first option.
    const updateHeight = () => {
      group.style.setProperty("--group-label-height", `${label.getBoundingClientRect().height}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(label);
    return () => {
      observer.disconnect();
      group.style.removeProperty("--group-label-height");
    };
  }, []);
}
