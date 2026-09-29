import { useCallback, useRef, useState } from "react";

const COMPOSER_OVERLAY_TUCK_PX = 20;

export function composerTranscriptBottomInsetPx(overlayHeightPx: number): number {
  return Math.max(0, Math.round(overlayHeightPx) - COMPOSER_OVERLAY_TUCK_PX);
}

const COMPOSER_OVERLAY_BOTTOM_CLEARANCE_PX = 52;

function composerOverlayBottomClearancePx(surfaceBottomPx: number, footerTopPx: number): number {
  return Math.max(
    COMPOSER_OVERLAY_BOTTOM_CLEARANCE_PX,
    Math.ceil(Math.max(0, surfaceBottomPx - footerTopPx)),
  );
}

const COMPOSER_OVERLAY_MASK_FADE_PX = 40;

export function composerOverlayScrollMaskImage(
  bottomInsetPx: number,
  bottomClearancePx = COMPOSER_OVERLAY_BOTTOM_CLEARANCE_PX,
): string | null {
  if (bottomInsetPx <= 0) return null;
  const overlayHeightPx = Math.max(0, Math.round(bottomInsetPx) + COMPOSER_OVERLAY_TUCK_PX);

  const fadeEndPx = Math.min(
    overlayHeightPx,
    Math.max(COMPOSER_OVERLAY_BOTTOM_CLEARANCE_PX, Math.round(bottomClearancePx)),
  );
  const fadeStartPx = Math.min(overlayHeightPx, fadeEndPx + COMPOSER_OVERLAY_MASK_FADE_PX);
  return `linear-gradient(to bottom, #000 calc(100% - ${fadeStartPx}px), transparent calc(100% - ${fadeEndPx}px))`;
}

const COMPOSER_OVERLAY_AFFORDANCE_GAP_PX = 8;

export function composerOverlayAffordanceBottomPx(bottomInsetPx: number): number {
  return bottomInsetPx + COMPOSER_OVERLAY_TUCK_PX + COMPOSER_OVERLAY_AFFORDANCE_GAP_PX;
}

export function useComposerOverlayHeight(): {
  overlayRef: (node: HTMLElement | null) => void;
  overlayHeightPx: number;
  overlayBottomClearancePx: number;
} {
  const [measurement, setMeasurement] = useState({
    overlayHeightPx: 0,
    overlayBottomClearancePx: COMPOSER_OVERLAY_BOTTOM_CLEARANCE_PX,
  });
  const observerRef = useRef<ResizeObserver | null>(null);
  const overlayRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) {
      setMeasurement({
        overlayHeightPx: 0,
        overlayBottomClearancePx: COMPOSER_OVERLAY_BOTTOM_CLEARANCE_PX,
      });
      return;
    }
    const commit = (height: number) => {
      const footer = node.querySelector<HTMLElement>("[data-chat-composer-footer]");
      const surface = footer?.closest<HTMLElement>(".chat-composer-surface");
      const overlayBottomClearancePx =
        footer && surface
          ? composerOverlayBottomClearancePx(
              surface.getBoundingClientRect().bottom,
              footer.getBoundingClientRect().top,
            )
          : COMPOSER_OVERLAY_BOTTOM_CLEARANCE_PX;
      const next = {
        overlayHeightPx: Math.round(height),
        overlayBottomClearancePx,
      };
      setMeasurement((current) =>
        current.overlayHeightPx === next.overlayHeightPx &&
        current.overlayBottomClearancePx === next.overlayBottomClearancePx
          ? current
          : next,
      );
    };
    commit(node.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        commit(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
      }
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  return { overlayRef, ...measurement };
}
