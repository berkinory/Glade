export const CHAT_SURFACE_HEADER_HEIGHT_PX = 46;

export const MAC_TRAFFIC_LIGHT_INSET_X_PX = 16;

export const MAC_TRAFFIC_LIGHT_DOT_RADIUS_PX = 7;

export function getMacTrafficLightPosition(): { x: number; y: number } {
  return {
    x: MAC_TRAFFIC_LIGHT_INSET_X_PX,
    y: Math.round(CHAT_SURFACE_HEADER_HEIGHT_PX / 2 - MAC_TRAFFIC_LIGHT_DOT_RADIUS_PX),
  };
}

export const MAC_DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CSS_PX = 90;

export const DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CSS_VAR =
  "--desktop-top-bar-traffic-light-gutter";

// Coerce an untrusted zoom factor (missing bridge, stale IPC payload) to a usable multiplier. Every
// zoom-aware conversion in this file funnels through here so a bogus value degrades to "no zoom"
// instead of collapsing geometry to 0 or NaN.
export function normalizeDesktopZoomFactor(zoomFactor: unknown): number {
  return typeof zoomFactor === "number" && Number.isFinite(zoomFactor) && zoomFactor > 0
    ? zoomFactor
    : 1;
}

export function resolveMacDesktopTopBarTrafficLightGutterCssPx(zoomFactor: number): number {
  return Math.round(
    MAC_DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CSS_PX / normalizeDesktopZoomFactor(zoomFactor),
  );
}

export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Convert a renderer rectangle (`getBoundingClientRect()`, i.e. layout CSS pixels) into the
// window-relative DIPs that Electron's native view APIs expect. `webContents` zoom scales the
// renderer's CSS pixel against the window's DIP grid: at zoom z, one CSS px covers z DIPs, so a
// slot measured as `w` CSS px physically spans `w * z` DIPs. Native views
// (`WebContentsView.setBounds`, `BrowserWindow` bounds) are never zoomed, so handing them raw CSS
// numbers makes them miss their DOM slot by exactly `1 / z` — the native browser view overflows the
// panel when the shell is zoomed out and under-fills it when zoomed in.
export function resolveDesktopDipRectFromCssRect(
  rect: DesktopRect,
  zoomFactor: number,
): DesktopRect {
  const safeZoom = normalizeDesktopZoomFactor(zoomFactor);
  if (safeZoom === 1) {
    return rect;
  }
  return {
    x: rect.x * safeZoom,
    y: rect.y * safeZoom,
    width: rect.width * safeZoom,
    height: rect.height * safeZoom,
  };
}
