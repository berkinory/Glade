import type { BrowserViewPlacement } from "@glade/contracts/browser/browserView";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useEffect, useState } from "react";
import { visibleOverlayElements } from "~/lib/keyboardOverlay";

// Long enough to cover the slowest panel and sidebar slide.
const FOLLOW_TRANSITION_MS = 450;
const LAYOUT_TRANSITION = /width|height|left|right|top|bottom|inset|translate|transform|margin/u;

// How long a cover waits for the page's frozen frame before taking the view off without one.
const FREEZE_WAIT_MS = 150;
// The frozen frame stays under the view a moment after it returns, so no blank frame shows.
const UNFREEZE_DELAY_MS = 100;

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

// Keeps the thread's active tab view over `element` while it is laid out and uncovered. While Glade
// UI covers it, returns the page's frozen frame for the caller to show in its place.
export function useBrowserViewPlacement(
  threadId: ThreadId,
  tabId: string | null,
  element: HTMLElement | null,
): string | null {
  const [frozenFrame, setFrozenFrame] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.desktopBridge?.browser;
    if (!bridge) return;
    let placedKey = "";
    let viewShown = false;
    let coverDirty = true;
    let covered = false;
    let lastRectKey = "";
    // Bumped whenever a pending freeze must be dropped.
    let freezeGeneration = 0;
    let freezeState: "none" | "pending" | "ready" = "none";
    let unfreezeTimer: ReturnType<typeof setTimeout> | undefined;
    const place = (tab: BrowserViewPlacement["tab"]) => {
      // The desktop scales by page zoom, which changes devicePixelRatio but not the CSS rect.
      const key = `${JSON.stringify(tab)}@${window.devicePixelRatio}`;
      viewShown = tab !== null;
      if (key === placedKey) return;
      placedKey = key;
      bridge.placeView({ threadId, tab });
    };
    const unfreeze = () => {
      freezeGeneration += 1;
      if (freezeState === "none") return;
      freezeState = "none";
      clearTimeout(unfreezeTimer);
      unfreezeTimer = setTimeout(() => setFrozenFrame(null), UNFREEZE_DELAY_MS);
    };
    // Keeps the view up until its frozen frame is painted underneath, then takes it off.
    const freeze = (activeTabId: string) => {
      freezeState = "pending";
      const generation = ++freezeGeneration;
      clearTimeout(unfreezeTimer);
      const timeout = new Promise<null>((resolve) => setTimeout(resolve, FREEZE_WAIT_MS, null));
      void Promise.race([bridge.freezeFrame({ threadId, tabId: activeTabId }), timeout])
        .catch(() => null)
        .then((frame) => {
          if (generation !== freezeGeneration) return;
          if (frame) setFrozenFrame(frame);
          // Two frames: React commits the image, then the compositor paints it.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (generation !== freezeGeneration) return;
              freezeState = "ready";
              sync();
            }),
          );
        });
    };
    const sync = () => {
      if (!element || !tabId) {
        unfreeze();
        return place(null);
      }
      const rect = element.getBoundingClientRect();
      const rectKey = `${rect.x},${rect.y},${rect.width},${rect.height}`;
      if (coverDirty || rectKey !== lastRectKey) covered = isCovered(rect);
      coverDirty = false;
      lastRectKey = rectKey;
      const { x, y, width, height } = rect;
      if (width < 1 || height < 1) {
        unfreeze();
        return place(null);
      }
      if (!covered) {
        unfreeze();
        return place({ tabId, bounds: { x, y, width, height } });
      }
      if (freezeState === "ready" || (!viewShown && freezeState === "none")) return place(null);
      if (freezeState === "none") freeze(tabId);
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
      freezeGeneration += 1;
      clearTimeout(unfreezeTimer);
      setFrozenFrame(null);
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

  return frozenFrame;
}
