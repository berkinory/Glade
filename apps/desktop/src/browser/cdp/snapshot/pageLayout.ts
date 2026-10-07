import type { CdpSession } from "../cdpSession";

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface RareBoolean {
  readonly index: readonly number[];
}
interface CapturedDocument {
  readonly nodes: {
    readonly parentIndex: readonly number[];
    readonly nodeName: readonly number[];
    readonly backendNodeId: readonly number[];
    readonly attributes: ReadonlyArray<readonly number[]>;
    readonly isClickable?: RareBoolean;
  };
  readonly layout: {
    readonly nodeIndex: readonly number[];
    readonly styles: ReadonlyArray<readonly number[]>;
    readonly bounds: ReadonlyArray<readonly number[]>;
    readonly paintOrders?: readonly number[];
  };
  readonly scrollOffsetX?: number;
  readonly scrollOffsetY?: number;
  readonly contentWidth?: number;
}
interface Captured {
  readonly documents: readonly CapturedDocument[];
  readonly strings: readonly string[];
}

// layout.styles lists values in this order.
const STYLES = [
  "opacity",
  "visibility",
  "cursor",
  "background-color",
  "position",
  "pointer-events",
];
const OPACITY = 0;
const VISIBILITY = 1;
const CURSOR = 2;
const BACKGROUND = 3;
const POSITION = 4;
const POINTER_EVENTS = 5;
// Occluders are opaque enough to hide what is under them; a dimming backdrop counts.
const OCCLUDER_MIN_ALPHA = 0.3;
const OCCLUDER_MIN_OPACITY = 0.8;

export type Placement = "visible" | "hidden" | "occluded" | "above" | "below";

interface Element {
  readonly doc: number;
  readonly index: number;
  readonly layout: number;
}

interface Occluder {
  readonly doc: number;
  readonly index: number;
  readonly rect: Rect;
  readonly paintOrder: number;
  readonly fixed: boolean;
}

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

const intersect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
};

function alpha(color: string): number {
  const match = /rgba?\(([^)]*)\)/u.exec(color);
  if (!match) return 0;
  const parts = match[1]!.split(/[,/\s]+/u).filter(Boolean);
  return parts.length >= 4 ? Number(parts[3]) : 1;
}

// Layout, paint order and a few computed styles of every node one CDP session renders, from a
// single DOMSnapshot call. Same-process iframes are extra documents of the same capture.
// Coordinates are CSS pixels relative to each node's own document.
export class PageLayout {
  private readonly byBackendId = new Map<number, Element>();
  private readonly clickable: ReadonlyArray<ReadonlySet<number>>;
  private readonly opacityCache = new Map<string, number>();
  private occluders: Occluder[] | null = null;

  private constructor(
    private readonly captured: Captured,
    private readonly scale: number,
    // The main document's viewport in its own CSS pixels; only the root session has one.
    readonly viewport: Rect | null,
    // Content height of the main document, for the "below the viewport" note.
    readonly contentHeight: number,
  ) {
    this.clickable = captured.documents.map(
      (document) => new Set(document.nodes.isClickable?.index),
    );
    captured.documents.forEach((document, doc) => {
      const nodeToLayout = new Map<number, number>();
      document.layout.nodeIndex.forEach((index, layout) => nodeToLayout.set(index, layout));
      document.nodes.backendNodeId.forEach((backendNodeId, index) => {
        this.byBackendId.set(backendNodeId, { doc, index, layout: nodeToLayout.get(index) ?? -1 });
      });
    });
  }

  static async capture(cdp: CdpSession, sessionId: string | undefined): Promise<PageLayout> {
    const [captured, metrics] = await Promise.all([
      cdp.send<Captured>(
        "DOMSnapshot.captureSnapshot",
        { computedStyles: STYLES, includePaintOrder: true, includeDOMRects: false },
        sessionId,
      ),
      cdp.send<{
        cssLayoutViewport: {
          pageX: number;
          pageY: number;
          clientWidth: number;
          clientHeight: number;
        };
        cssContentSize: { width: number; height: number };
      }>("Page.getLayoutMetrics", {}, sessionId),
    ]);
    const main = captured.documents[0];
    // Snapshot bounds are device pixels; the metrics are CSS pixels of the same document.
    const scale =
      main?.contentWidth && metrics.cssContentSize.width
        ? main.contentWidth / metrics.cssContentSize.width
        : 1;
    const viewport = metrics.cssLayoutViewport;
    return new PageLayout(
      captured,
      scale,
      sessionId === undefined
        ? {
            x: viewport.pageX,
            y: viewport.pageY,
            width: viewport.clientWidth,
            height: viewport.clientHeight,
          }
        : null,
      metrics.cssContentSize.height,
    );
  }

  has(backendNodeId: number): boolean {
    const element = this.byBackendId.get(backendNodeId);
    return element !== undefined && element.layout >= 0;
  }

  rect(backendNodeId: number): Rect | null {
    const element = this.byBackendId.get(backendNodeId);
    if (!element || element.layout < 0) return null;
    return this.rectOf(element.doc, element.layout);
  }

  isPassword(backendNodeId: number): boolean {
    const element = this.byBackendId.get(backendNodeId);
    return element ? this.attribute(element, "type")?.toLowerCase() === "password" : false;
  }

  // Signals a pointer user would read as "this does something", for elements the accessibility
  // tree lists as plain containers: a click listener, an own pointer cursor (not one inherited
  // from a clickable parent) or an explicit tab stop.
  looksClickable(backendNodeId: number): boolean {
    const element = this.byBackendId.get(backendNodeId);
    if (!element || element.layout < 0) return false;
    const rect = this.rectOf(element.doc, element.layout);
    if (rect.width < 1 || rect.height < 1) return false;
    if (this.clickable[element.doc]!.has(element.index)) return true;
    const tabIndex = Number(this.attribute(element, "tabindex"));
    if (Number.isInteger(tabIndex) && tabIndex >= 0) return true;
    if (this.style(element.doc, element.layout, CURSOR) !== "pointer") return false;
    const parent = this.parentWithLayout(element);
    return !parent || this.style(parent.doc, parent.layout, CURSOR) !== "pointer";
  }

  // Where a node stands for the model. Visibility applies everywhere; scope (above/below) and
  // occlusion only to the main document, whose viewport is known.
  placement(backendNodeId: number, margin: number | null): Placement {
    const element = this.byBackendId.get(backendNodeId);
    if (!element || element.layout < 0) return "visible";
    const { doc, layout } = element;
    if (["hidden", "collapse"].includes(this.style(doc, layout, VISIBILITY))) return "hidden";
    if (this.opacity(element) === 0) return "hidden";
    const rect = this.rectOf(doc, layout);
    // The classic off-screen hiding trick: pushed past the document's top or left edge.
    if (rect.x + rect.width <= 0 || rect.y + rect.height <= 0) return "hidden";
    if (doc !== 0 || !this.viewport) return "visible";
    const onScreen = intersect(rect, this.viewport);
    if (onScreen && this.coveredWithin(element, onScreen)) return "occluded";
    if (!onScreen && this.underFullScreenCover(element)) return "occluded";
    if (margin === null) return "visible";
    if (rect.y + rect.height < this.viewport.y - margin) return "above";
    if (rect.y > this.viewport.y + this.viewport.height + margin) return "below";
    return "visible";
  }

  private coveredWithin(element: Element, visible: Rect): boolean {
    const paintOrder = this.paintOrder(element.doc, element.layout);
    return this.occluderList().some(
      (occluder) =>
        occluder.paintOrder > paintOrder &&
        contains(occluder.rect, visible) &&
        !this.related(element, occluder),
    );
  }

  // A fixed layer covering the whole viewport (a modal backdrop) also hides content that is
  // scrolled out of view, since scrolling does not move it.
  private underFullScreenCover(element: Element): boolean {
    const paintOrder = this.paintOrder(element.doc, element.layout);
    return this.occluderList().some(
      (occluder) =>
        occluder.fixed &&
        occluder.paintOrder > paintOrder &&
        contains(occluder.rect, this.viewport!) &&
        !this.related(element, occluder),
    );
  }

  private occluderList(): Occluder[] {
    if (this.occluders) return this.occluders;
    const occluders: Occluder[] = [];
    const document = this.captured.documents[0];
    if (document && this.viewport) {
      document.layout.nodeIndex.forEach((index, layout) => {
        if (alpha(this.style(0, layout, BACKGROUND)) < OCCLUDER_MIN_ALPHA) return;
        if (this.style(0, layout, VISIBILITY) === "hidden") return;
        if (this.style(0, layout, POINTER_EVENTS) === "none") return;
        if (this.opacity({ doc: 0, index, layout }) < OCCLUDER_MIN_OPACITY) return;
        const rect = this.rectOf(0, layout);
        if (!intersect(rect, this.viewport!)) return;
        occluders.push({
          doc: 0,
          index,
          rect,
          paintOrder: this.paintOrder(0, layout),
          fixed: this.style(0, layout, POSITION) === "fixed",
        });
      });
    }
    this.occluders = occluders;
    return occluders;
  }

  // An element's own descendants or ancestors paint over it without hiding it.
  private related(element: Element, occluder: Occluder): boolean {
    if (element.doc !== occluder.doc) return false;
    const parents = this.captured.documents[element.doc]!.nodes.parentIndex;
    for (let index = element.index; index >= 0; index = parents[index]!) {
      if (index === occluder.index) return true;
    }
    for (let index = occluder.index; index >= 0; index = parents[index]!) {
      if (index === element.index) return true;
    }
    return false;
  }

  // Computed opacity is per element; what renders is the product along the ancestors.
  private opacity(element: Element): number {
    const key = `${element.doc}:${element.index}`;
    const cached = this.opacityCache.get(key);
    if (cached !== undefined) return cached;
    // The document node has layout but no computed style.
    const style = element.layout >= 0 ? this.style(element.doc, element.layout, OPACITY) : "";
    const own = style === "" ? 1 : Number(style);
    const parentIndex = this.captured.documents[element.doc]!.nodes.parentIndex[element.index]!;
    const parent =
      parentIndex >= 0
        ? this.opacity({
            doc: element.doc,
            index: parentIndex,
            layout: this.layoutOf(element.doc, parentIndex),
          })
        : 1;
    const value = (Number.isFinite(own) ? own : 1) * parent;
    this.opacityCache.set(key, value);
    return value;
  }

  private layoutOf(doc: number, index: number): number {
    const backendNodeId = this.captured.documents[doc]!.nodes.backendNodeId[index]!;
    return this.byBackendId.get(backendNodeId)?.layout ?? -1;
  }

  private parentWithLayout(element: Element): Element | null {
    const parents = this.captured.documents[element.doc]!.nodes.parentIndex;
    for (let index = parents[element.index]!; index >= 0; index = parents[index]!) {
      const layout = this.layoutOf(element.doc, index);
      if (layout >= 0) return { doc: element.doc, index, layout };
    }
    return null;
  }

  private attribute(element: Element, name: string): string | undefined {
    const strings = this.captured.strings;
    const attributes = this.captured.documents[element.doc]!.nodes.attributes[element.index] ?? [];
    for (let i = 0; i + 1 < attributes.length; i += 2) {
      if (strings[attributes[i]!] === name) return strings[attributes[i + 1]!];
    }
    return undefined;
  }

  private style(doc: number, layout: number, style: number): string {
    const index = this.captured.documents[doc]!.layout.styles[layout]?.[style];
    return index === undefined ? "" : (this.captured.strings[index] ?? "");
  }

  private paintOrder(doc: number, layout: number): number {
    return this.captured.documents[doc]!.layout.paintOrders?.[layout] ?? 0;
  }

  private rectOf(doc: number, layout: number): Rect {
    const [x = 0, y = 0, width = 0, height = 0] =
      this.captured.documents[doc]!.layout.bounds[layout] ?? [];
    return {
      x: x / this.scale,
      y: y / this.scale,
      width: width / this.scale,
      height: height / this.scale,
    };
  }
}
