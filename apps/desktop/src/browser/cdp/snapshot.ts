import type { BrowserFindInput, BrowserSnapshotInput } from "@glade/contracts/browser/browserTools";
import * as Vm from "node:vm";
import { BrowserFailure } from "../browserFailure";
import type { CdpSession } from "./cdpSession";
import type { RefTable } from "./refs";
import {
  renderMatches,
  renderSnapshot,
  type SnapshotMatch,
  type SnapshotNode,
} from "./snapshotFormat";

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
}

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
const MAX_FRAMES = 24;
const MAX_FRAME_DEPTH = 3;
const SNAPSHOT_MAX_CHARS = 24_000;
const FIND_MAX_MATCHES = 20;
const REGEX_TIMEOUT_MS = 250;

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

interface CollectContext {
  readonly cdp: CdpSession;
  readonly refs: RefTable;
  framesLeft: number;
}

async function collectDocument(
  context: CollectContext,
  sessionId: string | undefined,
  frameId: string | undefined,
  frameDepth: number,
): Promise<SnapshotNode[]> {
  const { nodes } = await context.cdp.send<{ nodes: AxNode[] }>(
    "Accessibility.getFullAXTree",
    frameId ? { frameId } : {},
    sessionId,
  );
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const frames: Array<{ holder: SnapshotNode; backendNodeId: number }> = [];
  const convert = (node: AxNode): SnapshotNode[] => {
    const children = (node.childIds ?? []).flatMap((id) => {
      const child = byId.get(id);
      return child ? convert(child) : [];
    });
    const role = String(node.role?.value ?? "");
    if (node.ignored || FLATTENED_ROLES.has(role)) return children;
    const name = String(node.name?.value ?? "");
    if (role === "StaticText") {
      return name.trim()
        ? [{ role: "text", name, value: undefined, states: [], ref: undefined, children: [] }]
        : [];
    }
    const rawValue = node.value?.value;
    const value =
      rawValue === undefined || rawValue === null || String(rawValue) === name
        ? undefined
        : String(rawValue);
    const out: SnapshotNode = {
      role,
      name,
      value,
      states: states(node),
      ref:
        node.backendDOMNodeId === undefined
          ? undefined
          : context.refs.refFor({ backendNodeId: node.backendDOMNodeId, sessionId }),
      // Text that only repeats the element's own accessible name adds tokens, not meaning.
      children: children.filter(
        (child) => child.role !== "text" || !name.includes(child.name.trim()),
      ),
    };
    if (role === "Iframe" && node.backendDOMNodeId !== undefined) {
      frames.push({ holder: out, backendNodeId: node.backendDOMNodeId });
    }
    return [out];
  };
  const root = nodes.find((node) => node.parentId === undefined) ?? nodes[0];
  const roots = root ? convert(root) : [];
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

function collectTree(cdp: CdpSession, refs: RefTable): Promise<SnapshotNode[]> {
  return collectDocument({ cdp, refs, framesLeft: MAX_FRAMES }, undefined, undefined, 0);
}

function findByRef(nodes: readonly SnapshotNode[], ref: string): SnapshotNode | undefined {
  for (const node of nodes) {
    if (node.ref === ref) return node;
    const found = findByRef(node.children, ref);
    if (found) return found;
  }
  return undefined;
}

export async function takeSnapshot(
  cdp: CdpSession,
  refs: RefTable,
  input: typeof BrowserSnapshotInput.Type,
): Promise<string> {
  const tree = await collectTree(cdp, refs);
  const node = input.ref ? findByRef(tree, input.ref) : undefined;
  if (input.ref && !node) {
    throw new BrowserFailure(
      "stale_ref",
      `Ref ${input.ref} is not on the page any more. Take a new browser_snapshot.`,
    );
  }
  return renderSnapshot(node ? [node] : tree, {
    filter: input.filter ?? "interactive",
    depth: input.depth,
    maxChars: SNAPSHOT_MAX_CHARS,
  });
}

function matcher(query: string, regex: boolean): (texts: readonly string[]) => boolean[] {
  if (!regex) {
    const needle = query.toLowerCase();
    return (texts) => texts.map((text) => text.toLowerCase().includes(needle));
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(query, "imu");
  } catch (error) {
    throw new BrowserFailure("invalid_input", `Invalid regex: ${(error as Error).message}`);
  }
  // A model-supplied pattern could backtrack forever; the vm timeout interrupts it so it cannot
  // stall the desktop main process.
  return (texts) => {
    try {
      return Vm.runInNewContext(
        "texts.map((text) => pattern.test(text))",
        { texts, pattern },
        {
          timeout: REGEX_TIMEOUT_MS,
        },
      ) as boolean[];
    } catch {
      throw new BrowserFailure("invalid_input", "The regex took too long; use a simpler pattern.");
    }
  };
}

export async function findElements(
  cdp: CdpSession,
  refs: RefTable,
  input: typeof BrowserFindInput.Type,
): Promise<string> {
  const tree = await collectTree(cdp, refs);
  const candidates: Array<{ text: string; node: SnapshotNode; ancestors: SnapshotNode[] }> = [];
  const walk = (node: SnapshotNode, ancestors: SnapshotNode[]) => {
    // Role, name and value on separate lines so ^ and $ anchor to each field.
    candidates.push({ text: `${node.role}\n${node.name}\n${node.value ?? ""}`, node, ancestors });
    for (const child of node.children) walk(child, [...ancestors, node]);
  };
  for (const root of tree) walk(root, []);
  const hits = matcher(input.query, input.regex === true)(candidates.map((entry) => entry.text));
  const seen = new Set<string>();
  const matches: SnapshotMatch[] = [];
  candidates.forEach((entry, index) => {
    if (!hits[index]) return;
    // Text has no ref; the nearest element that does is what the model can act on.
    const chain = [...entry.ancestors, entry.node];
    const targetIndex = chain.findLastIndex((node) => node.ref !== undefined);
    const target = chain[targetIndex];
    if (!target?.ref || seen.has(target.ref)) return;
    seen.add(target.ref);
    const context = chain.slice(0, targetIndex).findLast((node) => node.name.length > 0);
    matches.push({ node: target, context });
  });
  return renderMatches(matches.slice(0, FIND_MAX_MATCHES), matches.length);
}
