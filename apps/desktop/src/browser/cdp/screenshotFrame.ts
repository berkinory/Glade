import { BrowserFailure } from "../browserFailure";

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// What the last full-viewport screenshot showed: `rect` in viewport CSS pixels and the size of the
// image sent to the model, so a point the model reads off the image maps back to the viewport.
// Zooms never replace it.
export interface ScreenshotFrame {
  readonly rect: Rect;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

interface Viewport {
  readonly width: number;
  readonly height: number;
}

function toViewport(frame: ScreenshotFrame | null, x: number, y: number) {
  if (frame && (x > frame.imageWidth || y > frame.imageHeight)) {
    throw new BrowserFailure(
      "invalid_input",
      `(${x}, ${y}) is outside the last screenshot (${frame.imageWidth}x${frame.imageHeight}).`,
    );
  }
  return frame
    ? {
        x: frame.rect.x + (x * frame.rect.width) / frame.imageWidth,
        y: frame.rect.y + (y * frame.rect.height) / frame.imageHeight,
      }
    : { x, y };
}

// Without a screenshot the point is already in viewport CSS pixels.
export function viewportPoint(
  frame: ScreenshotFrame | null,
  x: number,
  y: number,
  viewport: Viewport,
): { x: number; y: number } {
  const point = toViewport(frame, x, y);
  if (point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height) {
    throw new BrowserFailure(
      "invalid_input",
      `(${x}, ${y}) is outside the viewport (${viewport.width}x${viewport.height} CSS px); scroll and take a new browser_screenshot.`,
    );
  }
  return point;
}

// [x0, y0, x1, y1] in the same pixels as viewportPoint, clipped to the viewport.
export function viewportRegion(
  frame: ScreenshotFrame | null,
  region: readonly [number, number, number, number],
  viewport: Viewport,
): Rect {
  const [x0, y0, x1, y1] = region;
  if (x1 <= x0 || y1 <= y0) {
    throw new BrowserFailure(
      "invalid_input",
      "region is [x0, y0, x1, y1] with x1 > x0 and y1 > y0.",
    );
  }
  const start = toViewport(frame, x0, y0);
  const end = toViewport(frame, x1, y1);
  const left = Math.max(0, start.x);
  const top = Math.max(0, start.y);
  const right = Math.min(viewport.width, end.x);
  const bottom = Math.min(viewport.height, end.y);
  if (right - left < 1 || bottom - top < 1) {
    throw new BrowserFailure("invalid_input", "The region is outside the viewport.");
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
