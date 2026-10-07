import type { CuaElement } from "../../computer/cuaResults.ts";
import type { IndexedElement, SnapshotDiff } from "../../computer/windowSnapshots.ts";

const MAX_TREE_CHARS = 24_000;
const MAX_DIFF_LINES = 10;
// Text areas report a document's whole text as their label or value; the model gets an excerpt
// and the length, and reads more with computer_window_state's query when it needs it.
const MAX_TEXT_CHARS = 80;

const excerpt = (text: string) =>
  text.length > MAX_TEXT_CHARS
    ? `${JSON.stringify(text.slice(0, MAX_TEXT_CHARS))}… (${text.length} chars)`
    : JSON.stringify(text);

const valueText = (element: CuaElement) => {
  const { value } = element;
  if (value === undefined || value === null || value === "") return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === element.label) return "";
  return ` = ${excerpt(text)}`;
};

const elementLine = ({ index, element }: IndexedElement, indent: boolean) => {
  const label = element.label ? ` ${excerpt(element.label)}` : "";
  const states = `${element.enabled === false ? " (disabled)" : ""}${element.selected ? " (selected)" : ""}`;
  const prefix = indent ? "  ".repeat(element.depth ?? 0) : "";
  return `${prefix}[${index}] ${element.role}${label}${valueText(element)}${states}`;
};

// One line per element, `[index] role "label" = value`, indented by depth and capped. The menu
// bar collapses to its menu titles: menus are run by path with computer_menu.
export function renderElements(elements: ReadonlyArray<IndexedElement>): string {
  const lines: string[] = [];
  const menuBar = new Set<number>();
  let length = 0;
  for (const entry of elements) {
    const { element } = entry;
    const parent = element.parent_index;
    if (parent !== undefined && parent !== null && menuBar.has(parent)) {
      menuBar.add(element.element_index);
      continue;
    }
    let line = elementLine(entry, true);
    if (element.role === "AXMenuBar") {
      menuBar.add(element.element_index);
      const titles = elements
        .filter((item) => item.element.parent_index === element.element_index && item.element.label)
        .map((item) => item.element.label);
      line = `${"  ".repeat(element.depth ?? 0)}[${entry.index}] AXMenuBar: ${titles.join(", ")} (run items with computer_menu)`;
    }
    if (length + line.length > MAX_TREE_CHARS) {
      lines.push(`… more elements; narrow with query or max_depth.`);
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}

// Attached sheets (Save panels, alerts) named outside the tree so the model sees them first.
export const sheetLines = (elements: ReadonlyArray<IndexedElement>) =>
  elements
    .filter((entry) => entry.element.role === "AXSheet")
    .map((entry) => `Sheet open: [${entry.index}] ${excerpt(entry.element.label ?? "")}.`);

// Elements with neither label nor value (layout groups, rows, empty menus) say nothing on their
// own; they are counted but not listed.
const speaks = ({ element }: IndexedElement) =>
  Boolean(element.label) ||
  (element.value !== undefined && element.value !== null && element.value !== "");

// What an action changed in the window's tree: `~` new value or state first (usually the element
// acted on), then `+` new and `-` gone, capped, after one line counting all of them.
export function renderDiff(diff: SnapshotDiff): string | null {
  const total = diff.added.length + diff.changed.length + diff.removed.length;
  if (total === 0) return null;
  const lines = [
    ...diff.changed.filter(speaks).map((entry) => `~ ${elementLine(entry, false)}`),
    ...diff.added.filter(speaks).map((entry) => `+ ${elementLine(entry, false)}`),
    ...diff.removed.filter(speaks).map((entry) => `- ${elementLine(entry, false)}`),
  ];
  const shown = lines.slice(0, MAX_DIFF_LINES);
  const summary = `${diff.added.length} new, ${diff.changed.length} changed, ${diff.removed.length} gone${shown.length < total ? `; showing ${shown.length}` : ""}.`;
  return [summary, ...shown].join("\n");
}
