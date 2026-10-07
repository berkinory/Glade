import type { BrowserZoomInput } from "@glade/contracts/browser/browserTools";
import type { WebContents } from "electron";
import { BrowserFailure, withTimeout } from "../browserFailure";
import { elementBounds } from "./pointer";
import type { CdpSession } from "./cdpSession";
import type { RefTable } from "./refs";
import { viewportRegion, type ScreenshotFrame } from "./screenshotFrame";

const MAX_EDGE_PX = 1280;
const JPEG_QUALITY = 70;
const CAPTURE_TIMEOUT_MS = 8_000;
const COMPOSITOR_TIMEOUT_MS = 3_000;
// A zoom on a small region renders it larger than on screen, for detail.
const MAX_ZOOM_SCALE = 2;

interface LayoutMetrics {
  readonly cssLayoutViewport: { clientWidth: number; clientHeight: number };
  readonly cssVisualViewport: { pageX: number; pageY: number };
  readonly layoutViewport: { clientWidth: number };
}

export interface CapturedImage {
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Downscaled to a fixed longest edge and clipped in viewport CSS pixels.
async function capture(
  cdp: CdpSession,
  webContents: WebContents,
  metrics: LayoutMetrics,
  rect: Rect,
  maxScale: number,
): Promise<CapturedImage> {
  if (rect.width < 1 || rect.height < 1) {
    throw new BrowserFailure("not_visible", "The screenshot area is empty.");
  }
  const deviceScale =
    metrics.layoutViewport.clientWidth / metrics.cssLayoutViewport.clientWidth || 1;
  const scale = Math.min(maxScale, MAX_EDGE_PX / (Math.max(rect.width, rect.height) * deviceScale));
  const width = Math.round(rect.width * scale * deviceScale);
  const height = Math.round(rect.height * scale * deviceScale);
  // The compositor copy comes first: Page.captureScreenshot with a scaled clip re-lays the live
  // page out at that scale for a moment, which the user sees as the page shrinking in the panel.
  // It also renders a frame on demand for a view that is not on screen.
  const captureCompositor = async (): Promise<CapturedImage | null> => {
    const image = await withTimeout(
      webContents.capturePage({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }),
      COMPOSITOR_TIMEOUT_MS,
      "Screenshot",
    ).catch(() => null);
    if (!image || image.isEmpty()) return null;
    const resized = image.resize({ width, height, quality: "good" });
    return { data: resized.toJPEG(JPEG_QUALITY).toString("base64"), width, height };
  };
  const image = await captureCompositor();
  if (image) return image;
  const { data } = await withTimeout(
    cdp.send<{ data: string }>("Page.captureScreenshot", {
      format: "jpeg",
      quality: JPEG_QUALITY,
      clip: {
        x: rect.x + metrics.cssVisualViewport.pageX,
        y: rect.y + metrics.cssVisualViewport.pageY,
        width: rect.width,
        height: rect.height,
        scale,
      },
    }),
    CAPTURE_TIMEOUT_MS,
    "Screenshot",
  );
  return { data, width, height };
}

// The whole viewport; `frame` maps points on the image back to the viewport.
export async function captureViewport(
  cdp: CdpSession,
  webContents: WebContents,
  scale: number | undefined,
): Promise<CapturedImage & { readonly frame: ScreenshotFrame }> {
  const metrics = await cdp.send<LayoutMetrics>("Page.getLayoutMetrics");
  const rect = {
    x: 0,
    y: 0,
    width: metrics.cssLayoutViewport.clientWidth,
    height: metrics.cssLayoutViewport.clientHeight,
  };
  const image = await capture(cdp, webContents, metrics, rect, scale ?? 1);
  return { ...image, frame: { rect, imageWidth: image.width, imageHeight: image.height } };
}

// A region in the last screenshot's pixels, or a ref's box. The caller keeps the old frame.
export async function captureZoom(
  cdp: CdpSession,
  refs: RefTable,
  webContents: WebContents,
  frame: ScreenshotFrame | null,
  input: typeof BrowserZoomInput.Type,
): Promise<CapturedImage> {
  if ((input.region === undefined) === (input.ref === undefined)) {
    throw new BrowserFailure("invalid_input", "Pass either region or ref.");
  }
  // Bounds first: scrolling the element into view changes the page offset read below.
  const elementRect = input.ref ? await elementBounds(cdp, refs, input.ref) : undefined;
  const metrics = await cdp.send<LayoutMetrics>("Page.getLayoutMetrics");
  const rect =
    elementRect ??
    viewportRegion(frame, input.region!, {
      width: metrics.cssLayoutViewport.clientWidth,
      height: metrics.cssLayoutViewport.clientHeight,
    });
  return capture(cdp, webContents, metrics, rect, MAX_ZOOM_SCALE);
}
