import type { BrowserWindow, WebContentsView } from "electron";

export interface BrowserViewParking {
  // Keeps a view the panel does not show where it still renders.
  readonly park: (view: WebContentsView) => void;
  // Takes it back before the panel shows it or the tab goes away.
  readonly unpark: (view: WebContentsView) => void;
}

const NO_PARKING: BrowserViewParking = { park: () => undefined, unpark: () => undefined };

interface Parked {
  readonly host: BrowserWindow;
  readonly slot: number;
}

// On Linux Chromium renders a view only while it is in a shown window and not fully covered: a
// detached tab runs no animation frames, its mouse moves wait out the 5 s input-ack timeout and its
// screenshots never return. A window's own page is always drawn below its child views, so nothing
// can cover a parked view there. Instead every tab the panel does not show keeps its size but sits
// up and to the left of the main window, with one pixel left inside it: column 0, rows 0 to its
// slot. Higher slots sit lower, so each view keeps row `slot` to itself and none is occluded. A
// minimized window keeps rendering them. macOS renders detached views and parks nothing.
export function createBrowserViewParking(
  platform: NodeJS.Platform,
  window: () => BrowserWindow | null,
): BrowserViewParking {
  if (platform !== "linux") return NO_PARKING;
  const parked = new Map<WebContentsView, Parked>();
  const unpark = (view: WebContentsView) => {
    const entry = parked.get(view);
    if (!entry) return;
    parked.delete(view);
    if (!entry.host.isDestroyed()) entry.host.contentView.removeChildView(view);
  };
  return {
    park: (view) => {
      unpark(view);
      const host = window();
      if (!host || host.isDestroyed() || view.webContents.isDestroyed()) return;
      const slots = [...parked.values()].filter((entry) => entry.host === host);
      let slot = 0;
      while (slots.some((entry) => entry.slot === slot)) slot += 1;
      const { width, height } = view.getBounds();
      const focused = view.webContents.isFocused();
      view.setBounds({ x: 1 - width, y: 1 - height + slot, width, height });
      host.contentView.addChildView(view, slots.filter((entry) => entry.slot > slot).length);
      parked.set(view, { host, slot });
      // Keys typed in Glade must not go to a page nobody sees.
      if (focused) host.webContents.focus();
    },
    unpark,
  };
}
