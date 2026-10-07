import type { BrowserTarget } from "@glade/contracts/browser/browserTools";
import { BrowserFailure } from "../browserFailure";
import type { CdpSession } from "./cdpSession";
import { rethrowStaleNode, type RefTable, type RefTarget } from "./refs";
import { DESCRIBE_NODE, hitRelation, nodeAtPoint } from "./hitTest";
import { viewportPoint, type ScreenshotFrame } from "./screenshotFrame";

type Quad = readonly number[];
interface BoxModel {
  readonly model: { readonly content: Quad; readonly border: Quad };
}
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export async function callOn<T>(
  cdp: CdpSession,
  target: RefTarget,
  fn: string,
  args: ReadonlyArray<{ readonly value: unknown } | { readonly objectId: string }> = [],
): Promise<T> {
  const objectId = await resolveObject(cdp, target.backendNodeId, target.sessionId);
  const { result, exceptionDetails } = await cdp.send<{
    result: { value?: T };
    exceptionDetails?: { text: string };
  }>(
    "Runtime.callFunctionOn",
    { objectId, functionDeclaration: fn, arguments: args, returnByValue: true },
    target.sessionId,
  );
  if (exceptionDetails) throw new BrowserFailure("invalid_input", exceptionDetails.text);
  return result.value as T;
}

async function resolveObject(cdp: CdpSession, backendNodeId: number, sessionId?: string) {
  const { object } = await cdp.send<{ object: { objectId: string } }>(
    "DOM.resolveNode",
    { backendNodeId },
    sessionId,
  );
  return object.objectId;
}

// Box models of nodes in an out-of-process iframe are relative to that frame; input goes to the
// root session, so add each owning iframe's content origin up to the main frame.
async function frameOffset(cdp: CdpSession, sessionId: string | undefined) {
  let x = 0;
  let y = 0;
  for (let current = sessionId; current !== undefined; ) {
    const child = cdp.childTarget(current);
    if (!child) break;
    const owner = await cdp.send<{ backendNodeId: number }>(
      "DOM.getFrameOwner",
      { frameId: child.targetId },
      child.parentSessionId,
    );
    await cdp.send(
      "DOM.scrollIntoViewIfNeeded",
      { backendNodeId: owner.backendNodeId },
      child.parentSessionId,
    );
    const box = await cdp.send<BoxModel>(
      "DOM.getBoxModel",
      { backendNodeId: owner.backendNodeId },
      child.parentSessionId,
    );
    x += box.model.content[0]!;
    y += box.model.content[1]!;
    current = child.parentSessionId;
  }
  return { x, y };
}

// Scrolls the target into view (unless the caller already placed it) and returns its border box
// in its own frame's viewport and the offset of that frame in the main frame's viewport, both in
// CSS pixels.
async function locate(cdp: CdpSession, target: RefTarget, ref: string, scroll = true) {
  const node = { backendNodeId: target.backendNodeId };
  try {
    if (scroll) await cdp.send("DOM.scrollIntoViewIfNeeded", node, target.sessionId);
    const offset = await frameOffset(cdp, target.sessionId);
    const { model } = await cdp.send<BoxModel>("DOM.getBoxModel", node, target.sessionId);
    const xs = [0, 2, 4, 6].map((index) => model.border[index]!);
    const ys = [1, 3, 5, 7].map((index) => model.border[index]!);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const box = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    if (box.width < 1 || box.height < 1) throw new Error("Could not compute box model.");
    return { box, offset };
  } catch (error) {
    if (error instanceof Error && /Could not compute box model/iu.test(error.message)) {
      throw new BrowserFailure(
        "not_visible",
        `Ref ${ref} has no visible box; it may be hidden or collapsed.`,
      );
    }
    return rethrowStaleNode(ref)(error);
  }
}

// The border box in main-frame viewport CSS pixels, after scrolling the ref into view.
export async function elementBounds(cdp: CdpSession, refs: RefTable, ref: string): Promise<Box> {
  const { box, offset } = await locate(cdp, refs.resolve(ref), ref);
  return { ...box, x: box.x + offset.x, y: box.y + offset.y };
}

// Page-side predicate: whether an element scrolls its own content.
export const SCROLLS = `(el) => {
  const style = getComputedStyle(el);
  return (["auto", "scroll", "overlay"].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 1)
    || (["auto", "scroll", "overlay"].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1);
}`;

// Scrolls an element its scroll container clips into that container's view, then returns it. A
// virtualized list re-renders rows from its scroll handler and may replace the element; the
// element with the same tag and text now at the spot it was scrolled to stands in for it, and
// null means none is there.
const REVEAL = `async function () {
  const scrolls = ${SCROLLS};
  const clipped = (scroller) => {
    const box = this.getBoundingClientRect();
    const outer = scroller.getBoundingClientRect();
    const top = outer.top + scroller.clientTop;
    const left = outer.left + scroller.clientLeft;
    return box.top < top - 1 || box.left < left - 1
      || box.bottom > top + scroller.clientHeight + 1 || box.right > left + scroller.clientWidth + 1;
  };
  let hidden = false;
  for (let el = this.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (scrolls(el) && clipped(el)) { hidden = true; break; }
  }
  if (!hidden) return this;
  const text = this.textContent;
  this.scrollIntoView({ block: "nearest", inline: "nearest" });
  const box = this.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  // Scroll handlers run with the next frame; a hidden tab may not render one, hence the timer.
  await new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); setTimeout(resolve, 150); });
  if (this.isConnected) return this;
  for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
    if (el.localName === this.localName && el.textContent === text) return el;
  }
  return null;
}`;

// The element a function called on `target` returns (awaited), in the same frame, or null.
export async function elementTarget(
  cdp: CdpSession,
  target: RefTarget,
  fn: string,
  args: ReadonlyArray<{ readonly value: unknown }> = [],
): Promise<RefTarget | null> {
  const objectId = await resolveObject(cdp, target.backendNodeId, target.sessionId);
  const { result } = await cdp.send<{ result: { objectId?: string; subtype?: string } }>(
    "Runtime.callFunctionOn",
    { objectId, functionDeclaration: fn, arguments: args, awaitPromise: true },
    target.sessionId,
  );
  if (!result.objectId || result.subtype !== "node") return null;
  const { node } = await cdp.send<{ node: { backendNodeId: number } }>(
    "DOM.describeNode",
    { objectId: result.objectId },
    target.sessionId,
  );
  return {
    backendNodeId: node.backendNodeId,
    sessionId: target.sessionId,
    frameId: target.frameId,
  };
}

// Points inside the box to try, center first: a sticky header or a badge can cover part of it.
const PROBES = [
  [0.5, 0.5],
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
] as const;

// Where a sticky header or footer covers the element after the default scroll, aligning it to the
// other edge of the viewport usually frees it.
const ALIGNMENTS = ["end", "start"] as const;
const ALIGN = `function (block) { this.scrollIntoView({ block, inline: "nearest" }); }`;
const LABEL_CONTROL = `function () { return this instanceof HTMLLabelElement ? this.control : null; }`;

export interface ClickPoint {
  readonly x: number;
  readonly y: number;
  // Set when the click lands on a related element rather than the target itself.
  readonly via?: string;
}

type Probe = ClickPoint | { readonly cover: string };

async function probe(
  cdp: CdpSession,
  target: RefTarget,
  ref: string,
  scroll: boolean,
): Promise<Probe> {
  const { box, offset } = await locate(cdp, target, ref, scroll);
  let related: ClickPoint | null = null;
  let cover: string | null = null;
  for (const [fx, fy] of PROBES) {
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    const relation = await hitRelation(cdp, target, x, y);
    const point = { x: x + offset.x, y: y + offset.y };
    if (relation === null || relation.kind === "inside" || relation.kind === "label") return point;
    if (relation.kind === "wrapper") {
      related ??= { ...point, via: `${relation.what}, which shares its click handler` };
    } else cover ??= relation.what;
  }
  return related ?? { cover: cover ?? "another element" };
}

// The main-frame viewport point to click. The element itself, its descendants and its labels may
// receive it; failing that, a wrapper that shares its click handler, the control of a label, or
// the element after aligning it to the other viewport edges. An unrelated element on top (a modal,
// a banner) fails with covered instead of being clicked.
export async function clickPoint(
  cdp: CdpSession,
  refs: RefTable,
  ref: string,
): Promise<ClickPoint> {
  const target = await elementTarget(cdp, refs.resolve(ref), REVEAL).catch(rethrowStaleNode(ref));
  if (!target) {
    throw new BrowserFailure(
      "stale_ref",
      `${refs.describe(ref)} was replaced when its list scrolled to show it. It is in view now; run browser_find again for its new ref.`,
    );
  }
  const first = await probe(cdp, target, ref, true);
  if (!("cover" in first)) return first;
  const control = await elementTarget(cdp, target, LABEL_CONTROL).catch(() => null);
  if (control) {
    const viaControl = await probe(cdp, control, ref, true).catch(() => null);
    if (viaControl && !("cover" in viaControl)) {
      return {
        ...viaControl,
        via: viaControl.via ?? "its form control, since the label is covered",
      };
    }
  }
  for (const block of ALIGNMENTS) {
    await callOn(cdp, target, ALIGN, [{ value: block }]).catch(rethrowStaleNode(ref));
    const aligned = await probe(cdp, target, ref, false);
    if (!("cover" in aligned)) return aligned;
  }
  throw new BrowserFailure(
    "covered",
    `${refs.describe(ref)} is covered by ${first.cover}. Dismiss or use the covering element first, or take a new browser_snapshot.`,
  );
}

export const mouse = (cdp: CdpSession, event: Record<string, unknown>) =>
  cdp.send("Input.dispatchMouseEvent", event);

export interface PointerTarget extends ClickPoint {
  // `button "Save" (e12)` for a ref, `<canvas#game> at (310, 140)` for a point.
  readonly label: string;
  readonly ref: string | undefined;
}

// A point means whatever is there, overlays included, so it is not hit-tested against anything;
// the label names what it hits.
export async function resolveTarget(
  cdp: CdpSession,
  refs: RefTable,
  screenshot: ScreenshotFrame | null,
  input: typeof BrowserTarget.Type,
): Promise<PointerTarget> {
  const hasPoint = input.x !== undefined || input.y !== undefined;
  if (input.ref !== undefined && !hasPoint) {
    const point = await clickPoint(cdp, refs, input.ref);
    return { ...point, label: refs.describe(input.ref), ref: input.ref };
  }
  if (input.ref !== undefined || input.x === undefined || input.y === undefined) {
    throw new BrowserFailure("invalid_input", "Pass either ref, or both x and y.");
  }
  const { cssLayoutViewport: viewport } = await cdp.send<{
    cssLayoutViewport: { clientWidth: number; clientHeight: number };
  }>("Page.getLayoutMetrics");
  const point = viewportPoint(screenshot, input.x, input.y, {
    width: viewport.clientWidth,
    height: viewport.clientHeight,
  });
  const hit = await nodeAtPoint(cdp, undefined, point.x, point.y);
  const what =
    hit !== null
      ? await callOn<string>(
          cdp,
          { backendNodeId: hit, sessionId: undefined },
          `function () { return (${DESCRIBE_NODE})(this); }`,
        ).catch(() => "the page")
      : "the page";
  return { ...point, label: `${what} at (${input.x}, ${input.y})`, ref: undefined };
}
