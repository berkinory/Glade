import type { BrowserWindow, WebContentsView } from "electron";

export interface BrowserViewParking {
  // Keeps a view the panel does not show where it still renders.
  readonly park: (view: WebContentsView) => void;
  // Takes it back before the panel shows it or the tab goes away.
  readonly unpark: (view: WebContentsView) => void;
}

const NO_PARKING: BrowserViewParking = { park: () => undefined, unpark: () => undefined };

// On Linux Chromium composites a view only inside a shown window: a detached tab runs no animation
// frames, its mouse moves wait out the 5 s input-ack timeout and its screenshots never return.
// There every tab the panel does not show sits under the main window's own page, which covers it
// and keeps rendering it while the window is minimized. macOS renders detached views.
export function createBrowserViewParking(
  platform: NodeJS.Platform,
  window: () => BrowserWindow | null,
): BrowserViewParking {
  if (platform !== "linux") return NO_PARKING;
  const parked = new Map<WebContentsView, BrowserWindow>();
  const unpark = (view: WebContentsView) => {
    const host = parked.get(view);
    if (!host) return;
    parked.delete(view);
    if (!host.isDestroyed()) host.contentView.removeChildView(view);
  };
  return {
    park: (view) => {
      unpark(view);
      const host = window();
      if (!host || host.isDestroyed() || view.webContents.isDestroyed()) return;
      const focused = view.webContents.isFocused();
      host.contentView.addChildView(view, 0);
      parked.set(view, host);
      // Keys typed in Glade must not go to a page nobody sees.
      if (focused) host.webContents.focus();
    },
    unpark,
  };
}
