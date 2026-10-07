import type { CdpSession } from "../cdpSession";
import type { RefTable, RefTarget } from "../refs";
import { PageLayout } from "./pageLayout";

export interface SnapshotNode {
  readonly role: string;
  readonly name: string;
  readonly value: string | undefined;
  readonly states: readonly string[];
  readonly ref: string | undefined;
  readonly interactive: boolean;
  // For text: the element that renders it, which browser_find can hand out as a ref when no
  // listed element contains the text.
  readonly owner?: RefTarget;
  children: SnapshotNode[];
}

export interface CollectedTree {
  readonly roots: SnapshotNode[];
  // Interactive elements left out because they are scrolled away from the viewport.
  readonly above: number;
  readonly below: number;
  readonly viewport: {
    readonly y: number;
    readonly height: number;
    readonly contentHeight: number;
  } | null;
}

interface AxValue {
  readonly value?: unknown;
}
interface AxNode {
  readonly nodeId: string;
  readonly parentId?: string;
  readonly ignored?: boolean;
  readonly role?: AxValue;
  readonly name?: AxValue;
  readonly value?: AxValue;
  readonly properties?: ReadonlyArray<{ readonly name: string; readonly value: AxValue }>;
  readonly childIds?: readonly string[];
  readonly backendDOMNodeId?: number;
  readonly frameId?: string;
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "switch",
  "slider",
  "spinbutton",
  "treeitem",
  "DisclosureTriangle",
  "Date",
  "DateTime",
  "InputTime",
  "ColorWell",
]);
// Structural wrappers whose children are promoted to keep the tree short.
const FLATTENED_ROLES = new Set([
  "none",
  "generic",
  "InlineTextBox",
  "LineBreak",
  "ListMarker",
  "RootWebArea",
  "WebArea",
]);
// Never promoted to "clickable": documents receive delegated listeners, and a label's click
// already belongs to its control.
const NOT_CLICKABLE_ROLES = new Set(["RootWebArea", "WebArea", "LabelText"]);
// Styled checkboxes and radios are often invisible inputs under a visible label; the input is
// still what the model should act on.
const KEPT_WHEN_INVISIBLE = new Set(["checkbox", "radio", "switch"]);
// Date and time inputs are set as a whole; their segment spinbuttons only add lines.
const WHOLE_VALUE_ROLES = new Set(["Date", "DateTime", "InputTime"]);
const MAX_FRAMES = 24;
const MAX_FRAME_DEPTH = 3;

function states(node: AxNode): string[] {
  const out: string[] = [];
  for (const { name, value } of node.properties ?? []) {
    const v = value.value;
    if ((name === "checked" || name === "pressed") && (v === "true" || v === true)) out.push(name);
    else if ((name === "checked" || name === "pressed") && v === "mixed") out.push(`${name}=mixed`);
    else if (
      (name === "selected" || name === "disabled" || name === "required" || name === "focused") &&
      v === true
    ) {
      out.push(name);
    } else if (name === "expanded") out.push(v === true ? "expanded" : "collapsed");
    else if (name === "level" && typeof v === "number") out.push(`level=${v}`);
  }
  return out;
}

const hasInteractive = (nodes: readonly SnapshotNode[]): boolean =>
  nodes.some((node) => node.interactive || hasInteractive(node.children));

const textOf = (nodes: readonly SnapshotNode[]): string =>
  nodes
    .map((node) => (node.role === "text" ? node.name : textOf(node.children)))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();

interface CollectContext {
  readonly cdp: CdpSession;
  readonly refs: RefTable;
  // Extra CSS pixels kept above and below the viewport; null keeps the whole page.
  readonly margin: number | null;
  readonly layouts: Map<string, Promise<PageLayout | null>>;
  framesLeft: number;
  above: number;
  below: number;
}

// One capture per CDP session covers its same-process frames too. Without layout the tree is
// still usable, just unfiltered.
function layoutFor(context: CollectContext, sessionId: string | undefined) {
  const key = sessionId ?? "";
  let layout = context.layouts.get(key);
  if (!layout) {
    layout = PageLayout.capture(context.cdp, sessionId).catch(() => null);
    context.layouts.set(key, layout);
  }
  return layout;
}

async function collectDocument(
  context: CollectContext,
  sessionId: string | undefined,
  frameId: string | undefined,
  frameDepth: number,
): Promise<SnapshotNode[]> {
  const [{ nodes }, layout] = await Promise.all([
    context.cdp.send<{ nodes: AxNode[] }>(
      "Accessibility.getFullAXTree",
      frameId ? { frameId } : {},
      sessionId,
    ),
    layoutFor(context, sessionId),
  ]);
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const root = nodes.find((node) => node.parentId === undefined) ?? nodes[0];
  const documentFrameId = root?.frameId ?? frameId;
  const frames: Array<{ holder: SnapshotNode; backendNodeId: number }> = [];

  // `ownerId` is the nearest ancestor DOM node, ignored or flattened ones included.
  const convert = (node: AxNode, ownerId: number | undefined): SnapshotNode[] => {
    const children = (node.childIds ?? []).flatMap((id) => {
      const child = byId.get(id);
      return child ? convert(child, node.backendDOMNodeId ?? ownerId) : [];
    });
    if (node.ignored) return children;
    const role = String(node.role?.value ?? "");
    const backendNodeId = node.backendDOMNodeId;
    const placement =
      layout && backendNodeId !== undefined
        ? layout.placement(backendNodeId, context.margin)
        : "visible";
    const name = String(node.name?.value ?? "");
    if (role === "StaticText") {
      return name.trim() && placement === "visible"
        ? [
            {
              role: "text",
              name,
              value: undefined,
              states: [],
              ref: undefined,
              interactive: false,
              ...(ownerId === undefined
                ? {}
                : { owner: { backendNodeId: ownerId, sessionId, frameId: documentFrameId } }),
              children: [],
            },
          ]
        : [];
    }
    if (role === "InlineTextBox") return [];
    const clickable =
      !INTERACTIVE_ROLES.has(role) &&
      !NOT_CLICKABLE_ROLES.has(role) &&
      backendNodeId !== undefined &&
      layout?.looksClickable(backendNodeId) === true &&
      !hasInteractive(children);
    const interactive = INTERACTIVE_ROLES.has(role) || clickable;
    if (FLATTENED_ROLES.has(role) && !clickable) return children;
    // Assigned before scope filtering, so an element scrolled into view later keeps its ref and
    // is not reported as new.
    const ref =
      backendNodeId === undefined
        ? undefined
        : context.refs.refFor(
            { backendNodeId, sessionId, frameId: documentFrameId },
            { role: clickable && FLATTENED_ROLES.has(role) ? "clickable" : role, name },
          );
    const shown =
      placement === "visible" || (placement === "hidden" && KEPT_WHEN_INVISIBLE.has(role));
    if (!shown) {
      if (interactive && placement === "above") context.above += 1;
      if (interactive && placement === "below") context.below += 1;
      return children;
    }
    const password = backendNodeId !== undefined && layout?.isPassword(backendNodeId) === true;
    const rawValue = node.value?.value;
    const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue) !== "";
    const nodeStates = states(node);
    // Password values never leave the page, not even masked.
    if (password && hasValue) nodeStates.push("filled");
    const value = !hasValue || password || String(rawValue) === name ? undefined : String(rawValue);
    const label = clickable && !name.trim() ? textOf(children) : name;
    const out: SnapshotNode = {
      role: clickable && FLATTENED_ROLES.has(role) ? "clickable" : role,
      name: label,
      value,
      states: clickable && !FLATTENED_ROLES.has(role) ? [...nodeStates, "clickable"] : nodeStates,
      ref,
      interactive,
      // Text that repeats the element's name or value adds tokens, not meaning; a password
      // field's text is its masked value.
      children: WHOLE_VALUE_ROLES.has(role)
        ? []
        : children.filter(
            (child) =>
              child.role !== "text" ||
              (!password && !label.includes(child.name.trim()) && child.name !== String(rawValue)),
          ),
    };
    if (role === "Iframe" && backendNodeId !== undefined) {
      frames.push({ holder: out, backendNodeId });
    }
    return [out];
  };

  const roots = root ? convert(root, undefined) : [];
  if (frameDepth >= MAX_FRAME_DEPTH) return roots;
  for (const frame of frames) {
    if (context.framesLeft <= 0) break;
    context.framesLeft -= 1;
    frame.holder.children = await collectFrame(
      context,
      sessionId,
      frame.backendNodeId,
      frameDepth,
    ).catch(() => []);
  }
  return roots;
}

// Out-of-process frames have their own auto-attached session; same-process frames are read
// through the parent session by frame id.
async function collectFrame(
  context: CollectContext,
  parentSessionId: string | undefined,
  backendNodeId: number,
  frameDepth: number,
): Promise<SnapshotNode[]> {
  const { node } = await context.cdp.send<{ node: { frameId?: string } }>(
    "DOM.describeNode",
    { backendNodeId },
    parentSessionId,
  );
  if (!node.frameId) return [];
  const childSession = context.cdp.sessionForFrame(node.frameId);
  return childSession
    ? collectDocument(context, childSession, undefined, frameDepth + 1)
    : collectDocument(context, parentSessionId, node.frameId, frameDepth + 1);
}

export async function collectTree(
  cdp: CdpSession,
  refs: RefTable,
  margin: number | null,
): Promise<CollectedTree> {
  const context: CollectContext = {
    cdp,
    refs,
    margin,
    layouts: new Map(),
    framesLeft: MAX_FRAMES,
    above: 0,
    below: 0,
  };
  const roots = await collectDocument(context, undefined, undefined, 0);
  const main = await context.layouts.get("");
  const viewport = main?.viewport
    ? { y: main.viewport.y, height: main.viewport.height, contentHeight: main.contentHeight }
    : null;
  return { roots, above: context.above, below: context.below, viewport };
}
