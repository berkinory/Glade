import { useEffect, useRef, useState } from "react";

import {
  clampPdfScale,
  nextZoomScale,
  type PdfPageIntrinsicSize,
  type PdfViewportSize,
  type PdfZoomMode,
  previousZoomScale,
  resolvePdfScale,
} from "./pdfZoom";

export interface PdfZoomController {
  zoomMode: PdfZoomMode;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetScale: (scale: number) => void;
  onFitWidth: () => void;
  onFitPage: () => void;
}

export function usePdfZoomController(input: {
  firstPageSize: PdfPageIntrinsicSize | null;
  containerSize: PdfViewportSize | null;

  currentPage: number;
  scrollToPage: (pageNumber: number, behavior: ScrollBehavior) => void;
}): PdfZoomController {
  const { firstPageSize, containerSize, currentPage, scrollToPage } = input;
  const [zoomMode, setZoomMode] = useState<PdfZoomMode>({ type: "fit-width" });

  const restorePageRef = useRef<number | null>(null);

  const scale = resolvePdfScale(zoomMode, firstPageSize, containerSize);

  useEffect(() => {
    if (restorePageRef.current != null) {
      scrollToPage(restorePageRef.current, "auto");
      restorePageRef.current = null;
    }
  }, [scale, scrollToPage]);

  const anchorBeforeZoom = () => {
    restorePageRef.current = currentPage;
  };

  const onZoomIn = () => {
    anchorBeforeZoom();
    setZoomMode({ type: "custom", scale: nextZoomScale(scale) });
  };

  const onZoomOut = () => {
    anchorBeforeZoom();
    setZoomMode({ type: "custom", scale: previousZoomScale(scale) });
  };

  const onSetScale = (nextScale: number) => {
    anchorBeforeZoom();
    setZoomMode({ type: "custom", scale: clampPdfScale(nextScale) });
  };

  const onFitWidth = () => {
    anchorBeforeZoom();
    setZoomMode({ type: "fit-width" });
  };

  const onFitPage = () => {
    anchorBeforeZoom();
    setZoomMode({ type: "fit-page" });
  };

  return { zoomMode, scale, onZoomIn, onZoomOut, onSetScale, onFitWidth, onFitPage };
}
