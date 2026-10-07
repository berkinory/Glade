import {
  BrowserPickRequest,
  BrowserTabTarget,
  BrowserViewPlacement,
} from "@glade/contracts/browser/browserView";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { BrowserWindow, ipcMain, type WebContents } from "electron";
import { Option, Schema } from "effect";
import { pickElement } from "../../browser/cdp/pickElement";
import { captureViewport } from "../../browser/cdp/screenshot";
import { clearSiteData } from "../../browser/siteData";
import type { DesktopHost } from "../../hostRpc/startDesktopHost";
import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";

const decodePlacement = Schema.decodeUnknownOption(BrowserViewPlacement);
const decodePickRequest = Schema.decodeUnknownOption(BrowserPickRequest);
const decodeTabTarget = Schema.decodeUnknownOption(BrowserTabTarget);
const decodeThreadId = Schema.decodeUnknownOption(ThreadId);

// Only what must stay in step with the native views or hands page pixels to the composer crosses
// here: placement, element picking, captures, DevTools, site data and the content blocker
// setting. Tab state and navigation go through the backend so they have one owner.
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
    const request = decodePickRequest(raw, { onExcessProperty: "error" });
    if (!host || Option.isNone(request)) return null;
    const { threadId, tabId, theme } = request.value;
    picks.get(threadId)?.abort();
    const controller = new AbortController();
    picks.set(threadId, controller);
    try {
      return await pickElement(host.tabs.resolve(threadId, tabId), theme, controller.signal);
    } finally {
      if (picks.get(threadId) === controller) picks.delete(threadId);
    }
  });

  // The tab a panel action targets; only the thread's own tabs resolve.
  const targetTab = (raw: unknown) => {
    const host = desktopHost();
    if (!host) throw new Error("Glade's browser is unavailable.");
    const target = decodeTabTarget(raw, { onExcessProperty: "error" });
    if (Option.isNone(target)) throw new Error("Invalid browser tab.");
    return host.tabs.resolve(target.value.threadId, target.value.tabId);
  };

  // Downscaled to the agent screenshot's size cap, so the image always fits an attachment.
  ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.browserCapture);
  ipcMain.handle(DESKTOP_IPC_CHANNELS.browserCapture, async (_event, raw: unknown) => {
    const tab = targetTab(raw);
    const { data } = await tab.run(() => captureViewport(tab.cdp, tab.webContents, undefined), {
      byUser: true,
    });
    return { data, mimeType: "image/jpeg" as const };
  });

  ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.browserFreezeFrame);
  ipcMain.handle(DESKTOP_IPC_CHANNELS.browserFreezeFrame, async (_event, raw: unknown) => {
    const image = await targetTab(raw).webContents.capturePage();
    return image.isEmpty() ? null : `data:image/jpeg;base64,${image.toJPEG(85).toString("base64")}`;
  });

  ipcMain.removeAllListeners(DESKTOP_IPC_CHANNELS.browserToggleDevTools);
  ipcMain.on(DESKTOP_IPC_CHANNELS.browserToggleDevTools, (_event, raw: unknown) => {
    const { webContents } = targetTab(raw);
    if (webContents.isDevToolsOpened()) webContents.closeDevTools();
    else webContents.openDevTools({ mode: "detach" });
  });

  ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.browserClearSiteData);
  ipcMain.handle(DESKTOP_IPC_CHANNELS.browserClearSiteData, (_event, raw: unknown) =>
    clearSiteData(targetTab(raw).webContents),
  );

  ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.browserContentBlockerGet);
  ipcMain.handle(DESKTOP_IPC_CHANNELS.browserContentBlockerGet, () => {
    const host = desktopHost();
    if (!host) throw new Error("Glade's browser is unavailable.");
    return host.blocker.enabled();
  });
  ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.browserContentBlockerSet);
  ipcMain.handle(DESKTOP_IPC_CHANNELS.browserContentBlockerSet, (_event, enabled: unknown) => {
    const host = desktopHost();
    if (!host) throw new Error("Glade's browser is unavailable.");
    if (typeof enabled !== "boolean") throw new Error("Expected a boolean blocker setting.");
    return host.blocker.setEnabled(enabled);
  });

  ipcMain.removeAllListeners(DESKTOP_IPC_CHANNELS.browserCancelPick);
  ipcMain.on(DESKTOP_IPC_CHANNELS.browserCancelPick, (_event, raw: unknown) => {
    const threadId = decodeThreadId(raw);
    if (Option.isSome(threadId)) picks.get(threadId.value)?.abort();
  });
}
