import { BrowserFailure } from "../browserFailure";

// What a screenshot showed: `rect` in viewport CSS pixels and the size of the image sent to the
// model, so a point the model reads off the image maps back to the viewport.
export interface ScreenshotFrame {
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly imageWidth: number;
  readonly imageHeight: number;
}

// Without a screenshot the point is already in viewport CSS pixels.
export function viewportPoint(
  frame: ScreenshotFrame | null,
  x: number,
  y: number,
  viewport: { readonly width: number; readonly height: number },
): { x: number; y: number } {
  if (frame && (x > frame.imageWidth || y > frame.imageHeight)) {
    throw new BrowserFailure(
      "invalid_input",
      `(${x}, ${y}) is outside the last screenshot (${frame.imageWidth}x${frame.imageHeight}).`,
    );
  }
  const point = frame
    ? {
        x: frame.rect.x + (x * frame.rect.width) / frame.imageWidth,
        y: frame.rect.y + (y * frame.rect.height) / frame.imageHeight,
      }
    : { x, y };
  if (point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height) {
    throw new BrowserFailure(
      "invalid_input",
      `(${x}, ${y}) is outside the viewport (${viewport.width}x${viewport.height} CSS px); scroll and take a new browser_screenshot.`,
    );
  }
  return point;
}
