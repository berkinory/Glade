import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";

export type { PDFDocumentProxy, PDFPageProxy, PageViewport };

type PdfjsModule = typeof import("pdfjs-dist");

let modulePromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!modulePromise) {
    modulePromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs as unknown as PdfjsModule;
    });
  }
  return modulePromise;
}

export async function loadPdfDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data });
  return task.promise;
}

export interface RenderedTextLayer {
  promise: Promise<void>;
  cancel: () => void;
}

export async function renderPageTextLayer(options: {
  page: PDFPageProxy;
  viewport: PageViewport;
  container: HTMLElement;
}): Promise<RenderedTextLayer> {
  const pdfjs = await loadPdfjs();
  const textLayer = new pdfjs.TextLayer({
    textContentSource: options.page.streamTextContent({ includeMarkedContent: true }),
    container: options.container,
    viewport: options.viewport,
  });
  return { promise: textLayer.render(), cancel: () => textLayer.cancel() };
}
