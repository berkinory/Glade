interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const AUTO_DIRECTION_TAGS = new Set([
  "p",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "dt",
  "dd",
  "td",
  "th",
]);
const LTR_TAGS = new Set(["pre", "code", "table"]);

function directionFor(node: HastNode): "auto" | "ltr" | null {
  if (!node.tagName) return null;
  if (AUTO_DIRECTION_TAGS.has(node.tagName)) return "auto";
  if (LTR_TAGS.has(node.tagName)) return "ltr";
  const className = node.properties?.className;
  return Array.isArray(className) && className.includes("katex") ? "ltr" : null;
}

function applyDirection(node: HastNode): void {
  if (node.type === "element") {
    const direction = directionFor(node);
    if (direction && node.properties?.dir === undefined) {
      node.properties = { ...node.properties, dir: direction };
    }
  }
  for (const child of node.children ?? []) applyDirection(child);
}

// Each prose block takes its direction from its own first strong character, so right-to-left
// replies read correctly, while code, tables and math stay left-to-right inside them.
export function rehypeBlockDirection() {
  return (tree: HastNode) => applyDirection(tree);
}
