import type { BrowserScreenshotInput } from "@glade/contracts/browser/browserTools";
import type { WebContents } from "electron";
import { BrowserFailure, withTimeout } from "../browserFailure";
import { elementBounds } from "./actions";
import type { CdpSession } from "./cdpSession";
import type { RefTable } from "./refs";

const MAX_EDGE_PX = 1280;
const JPEG_QUALITY = 70;
const CAPTURE_TIMEOUT_MS = 8_000;
const FALLBACK_TIMEOUT_MS = 3_000;

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

// Screenshots are for seeing, not for coordinates: they are downscaled to a fixed longest edge and
// clipped in viewport CSS pixels.
export async function captureScreenshot(
  cdp: CdpSession,
  refs: RefTable,
  webContents: WebContents,
  input: typeof BrowserScreenshotInput.Type,
): Promise<CapturedImage> {
  // Bounds first: scrolling the element into view changes the page offset read below.
  const elementRect = input.ref ? await elementBounds(cdp, refs, input.ref) : undefined;
  const metrics = await cdp.send<LayoutMetrics>("Page.getLayoutMetrics");
  const rect = elementRect ??
    input.region ?? {
      x: 0,
      y: 0,
      width: metrics.cssLayoutViewport.clientWidth,
      height: metrics.cssLayoutViewport.clientHeight,
    };
  if (rect.width < 1 || rect.height < 1) {
    throw new BrowserFailure("not_visible", "The screenshot area is empty.");
  }
  const deviceScale =
    metrics.layoutViewport.clientWidth / metrics.cssLayoutViewport.clientWidth || 1;
  const scale = Math.min(
    input.scale ?? 1,
    MAX_EDGE_PX / (Math.max(rect.width, rect.height) * deviceScale),
  );
  const width = Math.round(rect.width * scale * deviceScale);
  const height = Math.round(rect.height * scale * deviceScale);
  try {
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
  } catch (error) {
    // Chromium can stop compositing a view that is not on screen; the window-level capture is the
    // only other path and is bounded the same way.
    const image = await withTimeout(
      webContents.capturePage({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }),
      FALLBACK_TIMEOUT_MS,
      "Screenshot fallback",
    ).catch(() => {
      throw error;
    });
    if (image.isEmpty()) throw error;
    const resized = image.resize({ width, height, quality: "good" });
    return { data: resized.toJPEG(JPEG_QUALITY).toString("base64"), width, height };
  }
}
