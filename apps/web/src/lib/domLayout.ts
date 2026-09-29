export function findNearestMeasurableAncestor(element: HTMLElement): HTMLElement | null {
  let candidate = element.parentElement;
  while (candidate !== null) {
    const display = window.getComputedStyle(candidate).display;
    if (display !== "contents" && display !== "inline") {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}
