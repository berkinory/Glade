export const NATIVE_SURFACE_OCCLUSION_SYNC_EVENT = "glade:native-surface-occlusion-sync";
export const NATIVE_SURFACE_MENU_OVERLAY_SELECTOR = "[data-slot='menu-positioner']";

export function notifyNativeSurfaceOcclusionChange(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(NATIVE_SURFACE_OCCLUSION_SYNC_EVENT));
}

export function observeNativeSurfaceOverlay(element: HTMLElement | null): (() => void) | undefined {
  if (!element) return;
  const resizeObserver = new ResizeObserver(notifyNativeSurfaceOcclusionChange);
  const mutationObserver = new MutationObserver(notifyNativeSurfaceOcclusionChange);
  resizeObserver.observe(element);
  // Positioners can move or become hidden without resizing, including collision adjustments and
  // keep-mounted menus. Their style changes must resync too.
  mutationObserver.observe(element, { attributes: true });
  notifyNativeSurfaceOcclusionChange();
  return () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    notifyNativeSurfaceOcclusionChange();
  };
}
