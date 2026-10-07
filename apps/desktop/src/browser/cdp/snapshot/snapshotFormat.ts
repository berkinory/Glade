import type { SnapshotNode } from "./collectTree";

const MAX_LABEL_CHARS = 100;
// A long <select> lists its first options; browser_select takes any label or value.
const MAX_OPTIONS = 5;

function quote(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  const clipped = flat.length > MAX_LABEL_CHARS ? `${flat.slice(0, MAX_LABEL_CHARS - 1)}…` : flat;
  return JSON.stringify(clipped);
}

// One line per node: `- role "name" [ref=eN] value="…" state…`; `+` instead of `-` marks an
// element that was not in the previous snapshot. Text nodes carry no ref.
function formatSnapshotLine(node: SnapshotNode, depth: number, isNew: boolean): string {
  const parts = [`${"  ".repeat(depth)}${isNew ? "+" : "-"} ${node.role}`];
  if (node.name) parts.push(quote(node.name));
  if (node.ref) parts.push(`[ref=${node.ref}]`);
  if (node.value) parts.push(`value=${quote(node.value)}`);
  parts.push(...node.states);
  return parts.join(" ");
}

export interface RenderOptions {
  readonly filter: "interactive" | "all";
  readonly depth: number | undefined;
  readonly maxChars: number;
  readonly isNew: (ref: string) => boolean;
}

// Renders whole lines only and stops before the cap, so every ref the model sees is complete;
// the tail says how much was left out and how to narrow the next call.
export function renderSnapshot(roots: readonly SnapshotNode[], options: RenderOptions): string[] {
  const lines: string[] = [];
  let chars = 0;
  let omitted = 0;
  const push = (line: string) => {
    if (omitted > 0 || chars + line.length + 1 > options.maxChars) omitted += 1;
    else {
      lines.push(line);
      chars += line.length + 1;
    }
  };
  const visit = (node: SnapshotNode, depth: number) => {
    const included = options.filter === "all" || node.interactive;
    const childDepth = included ? depth + 1 : depth;
    if (included) {
      push(formatSnapshotLine(node, depth, node.ref !== undefined && options.isNew(node.ref)));
    }
    if (options.depth !== undefined && childDepth >= options.depth) return;
    let optionCount = 0;
    for (const child of node.children) {
      if (child.role === "option" && ++optionCount > MAX_OPTIONS) continue;
      visit(child, childDepth);
    }
    if (optionCount > MAX_OPTIONS) {
      push(`${"  ".repeat(childDepth)}- … ${optionCount - MAX_OPTIONS} more options`);
    }
  };
  for (const root of roots) visit(root, 0);
  if (omitted > 0) {
    lines.push(`… ${omitted} more lines omitted. Narrow with depth or ref, or use browser_find.`);
  }
  return lines;
}

export interface SnapshotMatch {
  readonly node: SnapshotNode;
  readonly context: SnapshotNode | undefined;
}

export function renderMatches(matches: readonly SnapshotMatch[], total: number): string {
  if (matches.length === 0) return "No elements matched.";
  const lines = matches.map(({ node, context }) => {
    const line = formatSnapshotLine(node, 0, false);
    return context
      ? `${line}  (in ${context.role}${context.name ? ` ${quote(context.name)}` : ""})`
      : line;
  });
  if (total > matches.length)
    lines.push(`… ${total - matches.length} more matches; refine the query.`);
  return lines.join("\n");
}
