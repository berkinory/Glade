import type { BrowserViewRect } from "@glade/contracts/browser/browserView";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { BrowserWindow, WebContentsView } from "electron";
import type { BrowserTabs } from "./browserTabs";

interface Shown {
  readonly view: WebContentsView;
  readonly window: BrowserWindow;
}

// Shows at most one tab view per thread on a Glade window. Native views paint above the page, so
// the renderer hides a thread's view whenever its own UI must show in that area.
export class BrowserViewSurface {
  private readonly shown = new Map<ThreadId, Shown>();

  constructor(private readonly tabs: BrowserTabs) {}

  show(
    window: BrowserWindow,
    placement: { threadId: ThreadId; tabId: string; bounds: BrowserViewRect; zoom: number },
  ): void {
    const { view } = this.tabs.resolve(placement.threadId, placement.tabId);
    const current = this.shown.get(placement.threadId);
    if (current && (current.view !== view || current.window !== window)) {
      this.hide(placement.threadId);
    }
    if (!this.shown.has(placement.threadId)) {
      window.contentView.addChildView(view);
      this.shown.set(placement.threadId, { view, window });
    }
    const { bounds, zoom } = placement;
    view.setBounds({
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.round(bounds.width * zoom),
      height: Math.round(bounds.height * zoom),
    });
  }

  hide(threadId: ThreadId): void {
    const current = this.shown.get(threadId);
    if (!current) return;
    this.shown.delete(threadId);
    if (!current.window.isDestroyed()) current.window.contentView.removeChildView(current.view);
  }

  // A reloaded renderer forgets which views it placed; nothing it shows may stay covered.
  hideAllOn(window: BrowserWindow): void {
    for (const [threadId, shown] of this.shown) {
      if (shown.window === window) this.hide(threadId);
    }
  }
}
