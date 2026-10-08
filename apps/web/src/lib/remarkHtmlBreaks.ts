import type { Parent, Root, RootContent } from "mdast";

const BREAK_TAG_PATTERN = /^<br(?: ?\/)?>$/i;

const BLOCK_CONTAINER_TYPES = new Set(["root", "blockquote", "listItem"]);

function replaceBreakTags(node: Parent): void {
  const dropsBreaks = BLOCK_CONTAINER_TYPES.has(node.type);
  node.children = node.children.flatMap((child): RootContent[] => {
    if (child.type === "html" && BREAK_TAG_PATTERN.test(child.value.trim())) {
      // A `<br>` on its own line only spaces blocks apart; inline (table cells,
      // paragraphs) it is a hard line break.
      return dropsBreaks
        ? []
        : [{ type: "break", ...(child.position && { position: child.position }) }];
    }
    if ("children" in child) replaceBreakTags(child);
    return [child];
  }) as Parent["children"];
}

// Raw HTML is never rendered, so models' `<br>` tags would show up literally.
// Only the exact break tag becomes Markdown; code spans and fences are separate
// node types and stay untouched.
export function remarkHtmlBreaks() {
  return (tree: Root) => replaceBreakTags(tree);
}
