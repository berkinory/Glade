import { normalizeDesktopZoomFactor } from "@glade/shared/desktopChrome";

export function readDesktopZoomFactor(): number {
  const bridge = window.desktopBridge;
  if (!bridge?.getZoomFactor) return 1;
  return normalizeDesktopZoomFactor(bridge.getZoomFactor());
}

export function subscribeDesktopZoomFactor(listener: (zoomFactor: number) => void): () => void {
  const bridge = window.desktopBridge;
  const unsubscribe = bridge?.onZoomFactorChange?.((zoomFactor) => {
    listener(normalizeDesktopZoomFactor(zoomFactor));
  });
  return () => {
    unsubscribe?.();
  };
}
