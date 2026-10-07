export interface SnapshotNode {
  readonly role: string;
  readonly name: string;
  readonly value: string | undefined;
  readonly states: readonly string[];
  readonly ref: string | undefined;
  children: SnapshotNode[];
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

const MAX_LABEL_CHARS = 120;

function quote(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  const clipped = flat.length > MAX_LABEL_CHARS ? `${flat.slice(0, MAX_LABEL_CHARS - 1)}…` : flat;
  return JSON.stringify(clipped);
}

// One line per node: `- role "name" [ref=eN] value="…" state…`. Text nodes carry no ref.
function formatSnapshotLine(node: SnapshotNode, depth: number): string {
  const parts = [`${"  ".repeat(depth)}- ${node.role}`];
  if (node.name) parts.push(quote(node.name));
  if (node.ref) parts.push(`[ref=${node.ref}]`);
  if (node.value) parts.push(`value=${quote(node.value)}`);
  parts.push(...node.states);
  return parts.join(" ");
}

function isInteractive(node: SnapshotNode): boolean {
  return INTERACTIVE_ROLES.has(node.role);
}

export interface RenderOptions {
  readonly filter: "interactive" | "all";
  readonly depth: number | undefined;
  readonly maxChars: number;
}

// Renders whole lines only and stops before the cap, so every ref the model sees is complete;
// the tail says how much was left out and how to narrow the next call.
export function renderSnapshot(roots: readonly SnapshotNode[], options: RenderOptions): string {
  const lines: string[] = [];
  let chars = 0;
  let omitted = 0;
  const visit = (node: SnapshotNode, depth: number) => {
    const included = options.filter === "all" || isInteractive(node);
    const childDepth = included ? depth + 1 : depth;
    if (included) {
      const line = formatSnapshotLine(node, depth);
      if (omitted > 0 || chars + line.length + 1 > options.maxChars) omitted += 1;
      else {
        lines.push(line);
        chars += line.length + 1;
      }
    }
    if (options.depth !== undefined && childDepth >= options.depth) return;
    for (const child of node.children) visit(child, childDepth);
  };
  for (const root of roots) visit(root, 0);
  if (lines.length === 0 && omitted === 0) {
    return options.filter === "interactive"
      ? "(no interactive elements; try filter: all)"
      : "(empty page)";
  }
  if (omitted > 0) {
    lines.push(`… ${omitted} more lines omitted. Narrow with depth or ref, or use browser_find.`);
  }
  return lines.join("\n");
}

export interface SnapshotMatch {
  readonly node: SnapshotNode;
  readonly context: SnapshotNode | undefined;
}

export function renderMatches(matches: readonly SnapshotMatch[], total: number): string {
  if (matches.length === 0) return "No elements matched.";
  const lines = matches.map(({ node, context }) => {
    const line = formatSnapshotLine(node, 0);
    return context
      ? `${line}  (in ${context.role}${context.name ? ` ${quote(context.name)}` : ""})`
      : line;
  });
  if (total > matches.length)
    lines.push(`… ${total - matches.length} more matches; refine the query.`);
  return lines.join("\n");
}
