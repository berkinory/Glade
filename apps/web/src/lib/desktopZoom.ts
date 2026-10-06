import { normalizeDesktopZoomFactor } from "@glade/shared/platform/desktopChrome";

// The bridge read is a synchronous IPC round trip and bounds sync calls this every frame during
// bursts. Every zoom change, including native menu roles that emit no event, moves
// devicePixelRatio, so the cached factor is reread only when the ratio changes or main pushes one.
let cachedZoom: { readonly devicePixelRatio: number; readonly zoomFactor: number } | null = null;

export function readDesktopZoomFactor(): number {
  const bridge = window.desktopBridge;
  if (!bridge?.getZoomFactor) return 1;
  const { devicePixelRatio } = window;
  if (cachedZoom?.devicePixelRatio === devicePixelRatio) return cachedZoom.zoomFactor;
  const zoomFactor = normalizeDesktopZoomFactor(bridge.getZoomFactor());
  cachedZoom = { devicePixelRatio, zoomFactor };
  return zoomFactor;
}

export function subscribeDesktopZoomFactor(listener: (zoomFactor: number) => void): () => void {
  const bridge = window.desktopBridge;
  const unsubscribe = bridge?.onZoomFactorChange?.((zoomFactor) => {
    cachedZoom = null;
    listener(normalizeDesktopZoomFactor(zoomFactor));
  });
  return () => {
    unsubscribe?.();
  };
}
