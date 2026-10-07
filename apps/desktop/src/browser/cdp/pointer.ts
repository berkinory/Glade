import type { BrowserTarget } from "@glade/contracts/browser/browserTools";
import { BrowserFailure } from "../browserFailure";
import type { CdpSession } from "./cdpSession";
import { rethrowStaleNode, type RefTable, type RefTarget } from "./refs";
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

// Scrolls the ref into view and returns its border box in its own frame's viewport and the offset
// of that frame in the main frame's viewport, both in CSS pixels.
async function locate(cdp: CdpSession, refs: RefTable, ref: string) {
  const target = refs.resolve(ref);
  const node = { backendNodeId: target.backendNodeId };
  try {
    await cdp.send("DOM.scrollIntoViewIfNeeded", node, target.sessionId);
    const offset = await frameOffset(cdp, target.sessionId);
    const { model } = await cdp.send<BoxModel>("DOM.getBoxModel", node, target.sessionId);
    const xs = [0, 2, 4, 6].map((index) => model.border[index]!);
    const ys = [1, 3, 5, 7].map((index) => model.border[index]!);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const box = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    if (box.width < 1 || box.height < 1) throw new Error("Could not compute box model.");
    return { target, box, offset };
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
  const { box, offset } = await locate(cdp, refs, ref);
  return { ...box, x: box.x + offset.x, y: box.y + offset.y };
}

// `<tag#id.class> "text"` for a hit-tested node, which may be a text node.
const DESCRIBE_NODE = `(node) => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el) return "another element";
  const id = el.id ? "#" + el.id : "";
  const classes = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
  const text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  return "<" + el.localName + id + classes + ">" + (text ? " " + JSON.stringify(text) : "");
}`;

// Null when the hit node is the target, inside it (shadow trees included) or inside one of its
// labels; otherwise a short description of what is on top.
const HIT_BELONGS = `function (hit) {
  const within = (node, root) => { for (let n = node; n; n = n.parentNode || n.host) if (n === root) return true; return false; };
  if (within(hit, this)) return null;
  for (const label of this.labels || []) if (within(hit, label)) return null;
  return (${DESCRIBE_NODE})(hit);
}`;

// Points inside the box to try, center first: a sticky header or a badge can cover part of it.
const PROBES = [
  [0.5, 0.5],
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
] as const;

// What a real click at (x, y) would hit, in the target's own frame. Null means the target gets it
// or the location cannot be tested (outside the viewport), which is left to the click itself.
async function coveringElement(
  cdp: CdpSession,
  target: RefTarget,
  x: number,
  y: number,
): Promise<string | null> {
  const hit = await cdp
    .send<{ backendNodeId: number }>(
      "DOM.getNodeForLocation",
      { x: Math.round(x), y: Math.round(y), includeUserAgentShadowDOM: false },
      target.sessionId,
    )
    .catch(() => null);
  if (!hit || hit.backendNodeId === target.backendNodeId) return null;
  const objectId = await resolveObject(cdp, hit.backendNodeId, target.sessionId).catch(() => null);
  if (!objectId) return null;
  // A node in another frame of the same renderer cannot be compared in JavaScript; it is not
  // part of the target either way.
  return callOn<string | null>(cdp, target, HIT_BELONGS, [{ objectId }]).catch(
    () => "an element in another frame",
  );
}

// The main-frame viewport point to click, after checking that the element itself receives it.
export async function clickPoint(cdp: CdpSession, refs: RefTable, ref: string) {
  const { target, box, offset } = await locate(cdp, refs, ref);
  let cover: string | null = null;
  for (const [fx, fy] of PROBES) {
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    const covering = await coveringElement(cdp, target, x, y);
    if (covering === null) return { x: x + offset.x, y: y + offset.y };
    cover ??= covering;
  }
  throw new BrowserFailure(
    "covered",
    `${refs.describe(ref)} is covered by ${cover}. Dismiss or use the covering element first, or take a new browser_snapshot.`,
  );
}

export const mouse = (cdp: CdpSession, event: Record<string, unknown>) =>
  cdp.send("Input.dispatchMouseEvent", event);

export interface PointerTarget {
  readonly x: number;
  readonly y: number;
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
  const hit = await cdp
    .send<{ backendNodeId: number }>("DOM.getNodeForLocation", {
      x: Math.round(point.x),
      y: Math.round(point.y),
      includeUserAgentShadowDOM: false,
    })
    .catch(() => null);
  const what = hit
    ? await callOn<string>(
        cdp,
        { backendNodeId: hit.backendNodeId, sessionId: undefined },
        `function () { return (${DESCRIBE_NODE})(this); }`,
      ).catch(() => "the page")
    : "the page";
  return { ...point, label: `${what} at (${input.x}, ${input.y})`, ref: undefined };
}
