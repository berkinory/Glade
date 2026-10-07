import { BrowserPickTarget, BrowserViewPlacement } from "@glade/contracts/browser/browserView";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { BrowserWindow, ipcMain, type WebContents } from "electron";
import { Option, Schema } from "effect";
import { pickElement } from "../../browser/cdp/pickElement";
import type { DesktopHost } from "../../hostRpc/startDesktopHost";
import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";

const decodePlacement = Schema.decodeUnknownOption(BrowserViewPlacement);
const decodePickTarget = Schema.decodeUnknownOption(BrowserPickTarget);
const decodeThreadId = Schema.decodeUnknownOption(ThreadId);

// Only what must stay in step with the native view crosses here: placement and element picking.
// Tab state and navigation go through the backend so they have one owner.
export function registerBrowserViewIpc(desktopHost: () => DesktopHost | null): void {
  const picks = new Map<ThreadId, AbortController>();
  const watchedRenderers = new WeakSet<WebContents>();

  const watchRenderer = (renderer: WebContents, window: BrowserWindow, host: DesktopHost) => {
    if (watchedRenderers.has(renderer)) return;
    watchedRenderers.add(renderer);
    const hideAll = () => host.views.hideAllOn(window);
    renderer.on("did-navigate", hideAll);
    renderer.once("destroyed", hideAll);
  };

  ipcMain.removeAllListeners(DESKTOP_IPC_CHANNELS.browserPlaceView);
  ipcMain.on(DESKTOP_IPC_CHANNELS.browserPlaceView, (event, raw: unknown) => {
    const host = desktopHost();
    const placement = decodePlacement(raw);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!host || !window || Option.isNone(placement)) return;
    const { threadId, tab } = placement.value;
    watchRenderer(event.sender, window, host);
    if (!tab) {
      host.views.hide(threadId);
      return;
    }
    try {
      host.views.show(window, { threadId, ...tab, zoom: event.sender.getZoomFactor() });
    } catch {
      // The tab closed before this placement arrived; the next tab list places another one.
      host.views.hide(threadId);
    }
  });

  ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.browserPickElement);
  ipcMain.handle(DESKTOP_IPC_CHANNELS.browserPickElement, async (_event, raw: unknown) => {
    const host = desktopHost();
    const target = decodePickTarget(raw);
    if (!host || Option.isNone(target)) return null;
    const { threadId, tabId } = target.value;
    picks.get(threadId)?.abort();
    const controller = new AbortController();
    picks.set(threadId, controller);
    try {
      return await pickElement(host.tabs.resolve(threadId, tabId), controller.signal);
    } finally {
      if (picks.get(threadId) === controller) picks.delete(threadId);
    }
  });

  ipcMain.removeAllListeners(DESKTOP_IPC_CHANNELS.browserCancelPick);
  ipcMain.on(DESKTOP_IPC_CHANNELS.browserCancelPick, (_event, raw: unknown) => {
    const threadId = decodeThreadId(raw);
    if (Option.isSome(threadId)) picks.get(threadId.value)?.abort();
  });
}
