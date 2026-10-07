import type { BrowserViewPlacement } from "@glade/contracts/browser/browserView";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useEffect } from "react";
import { visibleOverlayElements } from "~/lib/keyboardOverlay";

// Long enough to cover the slowest panel and sidebar slide.
const FOLLOW_TRANSITION_MS = 450;
const LAYOUT_TRANSITION = /width|height|left|right|top|bottom|inset|translate|transform|margin/u;

const intersects = (a: DOMRect, b: DOMRect) =>
  a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;

// Native views paint above every HTML layer, so any Glade UI that has to show over the panel takes
// the view off: a modal anywhere, a menu or popover crossing it, or a resize drag in progress.
function isCovered(rect: DOMRect): boolean {
  if (document.querySelector("[data-panel-resize-overlay]")) return true;
  return visibleOverlayElements().some(
    (overlay) =>
      overlay.getAttribute("aria-modal") === "true" ||
      overlay.getAttribute("role") === "alertdialog" ||
      intersects(overlay.getBoundingClientRect(), rect),
  );
}

// Menus, dialogs and the resize overlay mount in portals beside the app root.
function watchPortals(onChange: () => void): () => void {
  const portals = new MutationObserver(onChange);
  const observePortals = () => {
    portals.disconnect();
    for (const child of document.body.children) {
      if (child.id === "root") continue;
      portals.observe(child, { subtree: true, childList: true, attributes: true });
    }
  };
  const body = new MutationObserver(() => {
    observePortals();
    onChange();
  });
  body.observe(document.body, { childList: true });
  observePortals();
  return () => {
    body.disconnect();
    portals.disconnect();
  };
}

// Keeps the thread's active tab view over `element` while it is laid out and uncovered.
export function useBrowserViewPlacement(
  threadId: ThreadId,
  tabId: string | null,
  element: HTMLElement | null,
): void {
  useEffect(() => {
    const bridge = window.desktopBridge?.browser;
    if (!bridge) return;
    let placedKey = "";
    let coverDirty = true;
    let covered = false;
    let lastRectKey = "";
    const place = (tab: BrowserViewPlacement["tab"]) => {
      // The desktop scales by page zoom, which changes devicePixelRatio but not the CSS rect.
      const key = `${JSON.stringify(tab)}@${window.devicePixelRatio}`;
      if (key === placedKey) return;
      placedKey = key;
      bridge.placeView({ threadId, tab });
    };
    const sync = () => {
      if (!element || !tabId) return place(null);
      const rect = element.getBoundingClientRect();
      const rectKey = `${rect.x},${rect.y},${rect.width},${rect.height}`;
      if (coverDirty || rectKey !== lastRectKey) covered = isCovered(rect);
      coverDirty = false;
      lastRectKey = rectKey;
      const { x, y, width, height } = rect;
      place(width < 1 || height < 1 || covered ? null : { tabId, bounds: { x, y, width, height } });
    };

    let frame = 0;
    let followUntil = 0;
    const tick = () => {
      frame = 0;
      sync();
      if (performance.now() < followUntil) frame = requestAnimationFrame(tick);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(tick);
    };
    const follow = (event: TransitionEvent) => {
      if (!LAYOUT_TRANSITION.test(event.propertyName)) return;
      followUntil = performance.now() + FOLLOW_TRANSITION_MS;
      schedule();
    };
    const overlaysChanged = () => {
      coverDirty = true;
      schedule();
    };

    sync();
    const resizeObserver = new ResizeObserver(schedule);
    if (element) resizeObserver.observe(element);
    const stopWatchingPortals = watchPortals(overlaysChanged);
    window.addEventListener("resize", schedule);
    document.addEventListener("transitionrun", follow, true);
    document.addEventListener("transitionend", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      stopWatchingPortals();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("transitionrun", follow, true);
      document.removeEventListener("transitionend", schedule, true);
    };
  }, [threadId, tabId, element]);

  // Only leaving the thread takes the view off here; a tab switch re-places it without a gap.
  useEffect(
    () => () => window.desktopBridge?.browser?.placeView({ threadId, tab: null }),
    [threadId],
  );
}
