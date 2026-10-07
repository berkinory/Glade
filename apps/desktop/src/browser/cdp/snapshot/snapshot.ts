import type { BrowserFindInput, BrowserSnapshotInput } from "@glade/contracts/browser/browserTools";
import * as Vm from "node:vm";
import { BrowserFailure } from "../../browserFailure";
import type { CdpSession } from "../cdpSession";
import type { PageRead } from "../buffers";
import type { RefTable } from "../refs";
import { collectTree, type CollectedTree, type SnapshotNode } from "./collectTree";
import { renderMatches, renderSnapshot, type SnapshotMatch } from "./snapshotFormat";

const SNAPSHOT_MAX_CHARS = 24_000;
const FIND_MAX_MATCHES = 20;
const REGEX_TIMEOUT_MS = 250;
// How far past the viewport the default snapshot reaches, in CSS pixels.
const SCOPE_MARGIN = 800;
// A find match inside one of these carries the whole row's or item's text.
const ROW_ROLES = new Set(["row", "listitem", "article", "treeitem", "option"]);

function findByRef(nodes: readonly SnapshotNode[], ref: string): SnapshotNode | undefined {
  for (const node of nodes) {
    if (node.ref === ref) return node;
    const found = findByRef(node.children, ref);
    if (found) return found;
  }
  return undefined;
}

// What a row or item shows: text, and names of elements whose text was folded into their name
// (table cells, links).
const shownText = (nodes: readonly SnapshotNode[]): string =>
  nodes
    .map((node) =>
      node.role === "text"
        ? node.name
        : [node.name, shownText(node.children)].filter(Boolean).join(" "),
    )
    .filter(Boolean)
    .join(" · ")
    .replace(/\s+/gu, " ")
    .trim();

// Why nothing matched may be content that has not loaded yet; say where the page stands.
function noMatchNote(tree: CollectedTree, loading: boolean): string {
  if (loading) return "No elements matched. The page is still loading; search again in a moment.";
  if (!tree.viewport) return "No elements matched.";
  const { y, height, contentHeight } = tree.viewport;
  const below = Math.round(((contentHeight - y - height) / height) * 10) / 10;
  return below >= 0.5
    ? `No elements matched in the loaded page. It continues ${below} screens below the viewport; content that loads as you scroll appears after browser_scroll.`
    : "No elements matched. The viewport is at the end of the page; scroll once if it loads more there.";
}

function scopeNote(tree: CollectedTree): string | null {
  if (!tree.viewport || (tree.above === 0 && tree.below === 0)) return null;
  const { y, height, contentHeight } = tree.viewport;
  const screens = (pixels: number) => Math.max(0, Math.round((pixels / height) * 10) / 10);
  const parts = [];
  if (tree.above > 0) parts.push(`${tree.above} elements above (${screens(y)} screens)`);
  if (tree.below > 0) {
    parts.push(`${tree.below} elements below (${screens(contentHeight - y - height)} screens)`);
  }
  return `Viewport only; not shown: ${parts.join(", ")}. Scroll, use browser_find, or pass scope: "page".`;
}

export async function takeSnapshot(
  cdp: CdpSession,
  refs: RefTable,
  input: typeof BrowserSnapshotInput.Type,
): Promise<PageRead> {
  // A ref subtree is something the model asked for by name; it is never cut to the viewport.
  const whole = input.scope === "page" || input.ref !== undefined;
  const tree = await collectTree(cdp, refs, whole ? null : SCOPE_MARGIN);
  const node = input.ref ? findByRef(tree.roots, input.ref) : undefined;
  if (input.ref && !node) {
    throw new BrowserFailure(
      "stale_ref",
      `Ref ${input.ref} is not on the page any more. Take a new browser_snapshot.`,
    );
  }
  const filter = input.filter ?? "interactive";
  const lines = renderSnapshot(node ? [node] : tree.roots, {
    filter,
    depth: input.depth,
    maxChars: SNAPSHOT_MAX_CHARS,
    isNew: (ref) => refs.isNew(ref),
  });
  if (!input.ref) refs.markSnapshot();
  const notes = [];
  if (lines.length === 0) {
    notes.push(
      filter === "interactive"
        ? "No interactive elements here; try filter: all."
        : "Nothing is rendered here.",
    );
  }
  const scope = node ? null : scopeNote(tree);
  if (scope) notes.push(scope);
  return { content: lines.join("\n"), note: notes.join(" ") };
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
  loading: boolean,
): Promise<string> {
  const collected = await collectTree(cdp, refs, null);
  const tree = collected.roots;
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
    // Text has no ref; the nearest element that does is what the model can act on. Text in
    // no listed control (a hover menu's plain trigger) gets a ref for its own element instead.
    const chain = [...entry.ancestors, entry.node];
    const targetIndex = chain.findLastIndex((node) => node.ref !== undefined);
    const listed = chain[targetIndex];
    let target = listed;
    const owner = listed?.interactive ? undefined : entry.node.owner;
    if (owner && refs.refFor(owner) !== listed?.ref) {
      target = { ...entry.node, ref: refs.refFor(owner, { role: "text", name: entry.node.name }) };
    }
    if (!target?.ref || seen.has(target.ref)) return;
    seen.add(target.ref);
    const context = chain.slice(0, targetIndex).findLast((node) => node.name.length > 0);
    // Matched text inside an element is what the model searched for; show it.
    const text = entry.node.role === "text" && target.role !== "text" ? entry.node.name : undefined;
    const container = chain.findLast((node) => ROW_ROLES.has(node.role) && node !== target);
    const rowText = container ? shownText(container.children) || container.name : "";
    const row =
      rowText && rowText !== target.name ? { role: container!.role, text: rowText } : undefined;
    matches.push({ node: target, context, text, row });
  });
  if (matches.length === 0) return noMatchNote(collected, loading);
  return renderMatches(matches.slice(0, FIND_MAX_MATCHES), matches.length);
}
