import type { BrowserSnapshotInput } from "@glade/contracts/browser/browserTools";
import { BrowserFailure } from "../../browserFailure";
import type { CdpSession } from "../cdpSession";
import type { PageRead } from "../buffers";
import type { RefTable } from "../refs";
import { collectTree, type CollectedTree, type SnapshotNode } from "./collectTree";
import { renderSnapshot } from "./snapshotFormat";

const SNAPSHOT_MAX_CHARS = 24_000;
// How far past the viewport a snapshot of visible elements reaches, in CSS pixels.
const SCOPE_MARGIN = 800;

function findByRef(nodes: readonly SnapshotNode[], ref: string): SnapshotNode | undefined {
  for (const node of nodes) {
    if (node.ref === ref) return node;
    const found = findByRef(node.children, ref);
    if (found) return found;
  }
  return undefined;
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
  return `Viewport only; not shown: ${parts.join(", ")}. Scroll, use browser_find, or pass filter: "all".`;
}

// filter: none lists visible elements, "interactive" visible controls, "all" the whole page.
export async function takeSnapshot(
  cdp: CdpSession,
  refs: RefTable,
  input: typeof BrowserSnapshotInput.Type,
): Promise<PageRead> {
  // A ref subtree is something the model asked for by name; it is never cut to the viewport.
  const whole = input.filter === "all" || input.ref !== undefined;
  const tree = await collectTree(cdp, refs, whole ? null : SCOPE_MARGIN);
  const node = input.ref ? findByRef(tree.roots, input.ref) : undefined;
  if (input.ref && !node) {
    throw new BrowserFailure(
      "stale_ref",
      `Ref ${input.ref} is not on the page any more. Re-read the page with browser_snapshot or browser_find.`,
    );
  }
  const controlsOnly = input.filter === "interactive";
  const lines = renderSnapshot(node ? [node] : tree.roots, {
    controlsOnly,
    text: input.text === true,
    depth: input.depth,
    maxChars: SNAPSHOT_MAX_CHARS,
    isNew: (ref) => refs.isNew(ref),
  });
  if (!input.ref) refs.markSnapshot();
  const notes = [];
  if (lines.length === 0) {
    notes.push(
      controlsOnly
        ? "No controls here; leave out filter or pass text: true to see the rest."
        : "Nothing is rendered here.",
    );
  }
  const scope = node ? null : scopeNote(tree);
  if (scope) notes.push(scope);
  return { content: lines.join("\n"), note: notes.join(" ") };
}
