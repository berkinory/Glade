import type { CdpSession } from "./cdpSession";
import type { RefTarget } from "./refs";

// `<tag#id.class> "text"` for a hit-tested node, which may be a text node.
export const DESCRIBE_NODE = `(node) => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el) return "another element";
  const id = el.id ? "#" + el.id : "";
  const classes = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
  const text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  return "<" + el.localName + id + classes + ">" + (text ? " " + JSON.stringify(text) : "");
}`;

// How the element a click at a point would hit relates to the target (`this`):
// - "inside": the target, its descendant (shadow trees included), or a label's control;
// - "label": inside one of the target's labels, which forwards the click;
// - "wrapper": the hit and the target share a close ancestor (at most three levels above the
//   target, holding no other control) that, or one of its two parents, has a click handler, so the
//   click reaches the same handler;
// - "unrelated": anything else, such as a modal or a banner.
// `handler` is false when only a listener added with addEventListener could make it a wrapper,
// which the caller checks through CDP on the returned wrapper.
const RELATE = `function (hit, wantWrapper) {
  const up = (n) => n.parentNode || n.host;
  const within = (node, root) => { for (let n = node; n; n = up(n)) if (n === root) return true; return false; };
  const self = this.control && this instanceof HTMLLabelElement ? this.control : this;
  if (within(hit, this) || within(hit, self)) return { kind: "inside" };
  for (const label of self.labels || []) if (within(hit, label)) return { kind: "label" };
  const what = (${DESCRIBE_NODE})(hit);
  const control = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=option],[role=menuitem],[role=tab],[onclick]';
  const ownHandler = (el) => {
    if (el.onclick || el.hasAttribute("onclick")) return true;
    for (const key of Object.keys(el)) {
      const props = key.startsWith("__reactProps$") ? el[key] : null;
      if (props && (props.onClick || props.onMouseDown || props.onPointerDown || props.onMouseUp)) return true;
    }
    return !!(el._vei && (el._vei.onClick || el._vei.onMousedown || el._vei.onPointerdown));
  };
  let wrapper = null;
  let depth = 0;
  for (let n = self.parentElement; n && depth < 3; n = n.parentElement, depth += 1) {
    if (n === document.body || n === document.documentElement) break;
    if (within(hit, n)) { wrapper = n; break; }
  }
  if (!wrapper) return { kind: "unrelated", what };
  // The hit must not be a control of its own on the way up, and the wrapper must hold no other
  // control than the target.
  for (let n = hit.nodeType === 1 ? hit : hit.parentElement; n && n !== wrapper; n = n.parentElement) {
    if (n.matches(control)) return { kind: "unrelated", what };
  }
  const others = Array.from(wrapper.querySelectorAll(control)).filter((el) => el !== self && !within(el, self));
  if (others.length > 0) return { kind: "unrelated", what };
  for (let n = wrapper, level = 0; n && n !== document.body && level < 3; n = n.parentElement, level += 1) {
    if (ownHandler(n)) return { kind: "wrapper", what, handler: true };
  }
  if (wantWrapper) return wrapper;
  return { kind: "wrapper", what, handler: false };
}`;

export type HitRelation =
  | { readonly kind: "inside" }
  | { readonly kind: "label" }
  | { readonly kind: "wrapper"; readonly what: string }
  | { readonly kind: "unrelated"; readonly what: string };

const CLICK_EVENTS = new Set(["click", "mousedown", "mouseup", "pointerdown", "pointerup"]);

async function objectId(cdp: CdpSession, backendNodeId: number, sessionId?: string) {
  const { object } = await cdp.send<{ object: { objectId: string } }>(
    "DOM.resolveNode",
    { backendNodeId },
    sessionId,
  );
  return object.objectId;
}

// A wrapper whose handler was added with addEventListener is only visible to CDP.
async function wrapperListens(
  cdp: CdpSession,
  target: RefTarget,
  targetObject: string,
  hitObject: string,
): Promise<boolean> {
  const { result } = await cdp.send<{ result: { objectId?: string } }>(
    "Runtime.callFunctionOn",
    {
      objectId: targetObject,
      functionDeclaration: RELATE,
      arguments: [{ objectId: hitObject }, { value: true }],
    },
    target.sessionId,
  );
  for (let current = result.objectId, depth = 0; current && depth < 3; depth += 1) {
    const { listeners } = await cdp.send<{ listeners: ReadonlyArray<{ type: string }> }>(
      "DOMDebugger.getEventListeners",
      { objectId: current },
      target.sessionId,
    );
    if (listeners.some((listener) => CLICK_EVENTS.has(listener.type))) return true;
    const parent = await cdp.send<{ result: { objectId?: string; subtype?: string } }>(
      "Runtime.callFunctionOn",
      {
        objectId: current,
        functionDeclaration:
          "function () { const p = this.parentElement; return p && p !== document.body ? p : null; }",
      },
      target.sessionId,
    );
    current = parent.result.subtype === "null" ? undefined : parent.result.objectId;
  }
  return false;
}

// The node a click at viewport point (x, y) of the session's main frame would hit.
// DOM.getNodeForLocation takes document coordinates (verified on Chromium 150), so a
// viewport point is shifted by the frame's scroll position first.
export async function nodeAtPoint(
  cdp: CdpSession,
  sessionId: string | undefined,
  x: number,
  y: number,
): Promise<number | null> {
  const metrics = await cdp
    .send<{ cssLayoutViewport: { pageX: number; pageY: number } }>(
      "Page.getLayoutMetrics",
      {},
      sessionId,
    )
    .catch(() => null);
  const scrollX = metrics?.cssLayoutViewport.pageX ?? 0;
  const scrollY = metrics?.cssLayoutViewport.pageY ?? 0;
  const hit = await cdp
    .send<{ backendNodeId: number }>(
      "DOM.getNodeForLocation",
      {
        x: Math.round(x + scrollX),
        y: Math.round(y + scrollY),
        includeUserAgentShadowDOM: false,
      },
      sessionId,
    )
    .catch(() => null);
  return hit?.backendNodeId ?? null;
}

// What a real click at (x, y), in the target's own frame, would hit and how that relates to the
// target. Null means the target gets it or the location cannot be tested (outside the viewport),
// which is left to the click itself.
export async function hitRelation(
  cdp: CdpSession,
  target: RefTarget,
  x: number,
  y: number,
): Promise<HitRelation | null> {
  const hitId = await nodeAtPoint(cdp, target.sessionId, x, y);
  const hit = hitId === null ? null : { backendNodeId: hitId };
  if (!hit || hit.backendNodeId === target.backendNodeId) return null;
  const hitObject = await objectId(cdp, hit.backendNodeId, target.sessionId).catch(() => null);
  if (!hitObject) return null;
  try {
    const targetObject = await objectId(cdp, target.backendNodeId, target.sessionId);
    const { result } = await cdp.send<{
      result: { value?: { kind: string; what?: string; handler?: boolean } };
    }>(
      "Runtime.callFunctionOn",
      {
        objectId: targetObject,
        functionDeclaration: RELATE,
        arguments: [{ objectId: hitObject }, { value: false }],
        returnByValue: true,
      },
      target.sessionId,
    );
    const relation = result.value;
    if (!relation) return { kind: "unrelated", what: "another element" };
    if (relation.kind === "inside") return { kind: "inside" };
    if (relation.kind === "label") return { kind: "label" };
    const what = relation.what ?? "another element";
    if (relation.kind === "wrapper" && !relation.handler) {
      const listens = await wrapperListens(cdp, target, targetObject, hitObject).catch(() => false);
      return { kind: listens ? "wrapper" : "unrelated", what };
    }
    return { kind: relation.kind === "wrapper" ? "wrapper" : "unrelated", what };
  } catch {
    // A node in another frame of the same renderer cannot be compared in JavaScript; it is not
    // part of the target either way.
    return { kind: "unrelated", what: "an element in another frame" };
  }
}
