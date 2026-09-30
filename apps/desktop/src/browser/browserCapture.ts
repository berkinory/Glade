import type { BrowserCaptureScreenshotResult, BrowserTabInput } from "@glade/contracts/ipc/ipc";
import { normalizeBrowserUrlInput as normalizeUrlInput } from "@glade/shared/browser/browserSession";
import { clipboard, nativeImage } from "electron";
import { type BrowserRuntime } from "./browserRuntimeTypes";
import { buildRuntimeKey, screenshotFileNameForUrl, SUSPENDED_TAB_STATUS } from "./browserTabState";

export function createBrowserCapture(
  hostRuntime: Pick<
    BrowserRuntime,
    | "services"
    | "live"
    | "tabs"
    | "ensureWorkspace"
    | "resolveTab"
    | "activateTab"
    | "resumeThread"
    | "ensureLiveRuntime"
    | "getVisibleBoundsForThread"
    | "attachActiveTab"
    | "loadTab"
    | "queueRuntimeStateSync"
    | "copyTabLink"
  >,
) {
  async function captureScreenshotPng(input: BrowserTabInput): Promise<{
    name: string;
    pngBytes: Buffer;
  }> {
    const state = hostRuntime.ensureWorkspace(input.threadId);
    const tab = hostRuntime.resolveTab(state, input.tabId);
    hostRuntime.activateTab(input.threadId, state, tab);

    hostRuntime.resumeThread(input.threadId);
    const wasSuspended = tab.status === SUSPENDED_TAB_STATUS;
    const runtime = hostRuntime.ensureLiveRuntime(input.threadId, tab.id);
    const webContents = runtime.webContents;
    const expectedUrl = normalizeUrlInput(tab.lastCommittedUrl ?? tab.url);
    const currentUrl = hostRuntime.services.sessionPolicy.resolveDisplayUrl(webContents.getURL());
    const bounds = hostRuntime.getVisibleBoundsForThread(input.threadId);
    if (bounds) {
      hostRuntime.attachActiveTab(input.threadId, bounds);
    }

    if (wasSuspended || currentUrl.length === 0 || currentUrl !== expectedUrl) {
      await hostRuntime.loadTab(input.threadId, tab.id, { runtime });
    } else {
      hostRuntime.queueRuntimeStateSync(input.threadId, tab.id);
    }

    const pngBytes = (await webContents.capturePage()).toPNG();
    if (pngBytes.byteLength === 0) {
      throw new Error("Couldn't capture a browser screenshot.");
    }

    return {
      name: screenshotFileNameForUrl(tab.lastCommittedUrl ?? tab.url),
      pngBytes,
    };
  }

  async function captureScreenshot(
    input: BrowserTabInput,
  ): Promise<BrowserCaptureScreenshotResult> {
    const { name, pngBytes } = await captureScreenshotPng(input);

    return {
      name,
      mimeType: "image/png",
      sizeBytes: pngBytes.byteLength,
      bytes: Uint8Array.from(pngBytes),
    };
  }

  async function capturePreview(input: BrowserTabInput): Promise<string | null> {
    const state = hostRuntime.tabs.states.get(input.threadId);
    const runtime = hostRuntime.live.runtimes.get(buildRuntimeKey(input.threadId, input.tabId));
    if (
      !hostRuntime.tabs.previewThreadIds.has(input.threadId) ||
      !state?.open ||
      state.activeTabId !== input.tabId ||
      !runtime ||
      runtime.webContents.isDestroyed()
    )
      return null;
    const image = await runtime.webContents
      .capturePage(undefined, { stayHidden: true, stayAwake: true })
      .catch(() => null);
    if (
      hostRuntime.live.runtimes.get(runtime.key) !== runtime ||
      !hostRuntime.tabs.previewThreadIds.has(input.threadId) ||
      state.activeTabId !== input.tabId ||
      !image ||
      image.isEmpty()
    )
      return null;
    const thumbnail = image.getSize().width > 640 ? image.resize({ width: 640 }) : image;
    return `data:image/jpeg;base64,${thumbnail.toJPEG(70).toString("base64")}`;
  }

  function copyLink(input: BrowserTabInput): void {
    hostRuntime.copyTabLink(input.threadId, input.tabId);
  }

  async function copyScreenshotToClipboard(input: BrowserTabInput): Promise<void> {
    const { pngBytes } = await captureScreenshotPng(input);
    const image = nativeImage.createFromBuffer(pngBytes);
    if (image.isEmpty()) {
      throw new Error("Couldn't copy a browser screenshot to the clipboard.");
    }
    clipboard.writeImage(image);
  }

  return { captureScreenshot, capturePreview, copyLink, copyScreenshotToClipboard };
}
