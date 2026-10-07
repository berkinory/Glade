import type { CuaElement } from "../../computer/cuaResults.ts";
import type { IndexedElement, SnapshotDiff } from "../../computer/windowSnapshots.ts";

const MAX_TREE_CHARS = 24_000;
const MAX_DIFF_LINES = 15;

const valueText = (element: CuaElement) => {
  const { value } = element;
  if (value === undefined || value === null || value === "") return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === element.label) return "";
  return ` = ${JSON.stringify(text.length > 120 ? `${text.slice(0, 120)}…` : text)}`;
};

const elementLine = ({ index, element }: IndexedElement, indent: boolean) => {
  const label = element.label ? ` ${JSON.stringify(element.label)}` : "";
  const states = `${element.enabled === false ? " (disabled)" : ""}${element.selected ? " (selected)" : ""}`;
  const prefix = indent ? "  ".repeat(element.depth ?? 0) : "";
  return `${prefix}[${index}] ${element.role}${label}${valueText(element)}${states}`;
};

// One line per element, `[index] role "label" = value`, indented by depth and capped.
export function renderElements(elements: ReadonlyArray<IndexedElement>): string {
  const lines: string[] = [];
  let length = 0;
  for (const entry of elements) {
    const line = elementLine(entry, true);
    if (length + line.length > MAX_TREE_CHARS) {
      lines.push(
        `… ${elements.length - lines.length} more elements; narrow with query or max_depth.`,
      );
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}

const section = (sign: string, entries: ReadonlyArray<IndexedElement>, budget: number) => {
  const shown = entries.slice(0, budget).map((entry) => `${sign} ${elementLine(entry, false)}`);
  return entries.length > budget ? [...shown, `${sign} … ${entries.length - budget} more`] : shown;
};

// What an action changed in the window's tree: `+` new, `~` new value or state, `-` gone.
export function renderDiff(diff: SnapshotDiff): string | null {
  const total = diff.added.length + diff.changed.length + diff.removed.length;
  if (total === 0) return null;
  const share = (count: number) =>
    Math.max(1, Math.round((MAX_DIFF_LINES * count) / Math.max(total, MAX_DIFF_LINES)));
  return [
    ...section("+", diff.added, share(diff.added.length)),
    ...section("~", diff.changed, share(diff.changed.length)),
    ...section("-", diff.removed, share(diff.removed.length)),
  ].join("\n");
}
