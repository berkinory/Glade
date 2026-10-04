import { isRecord } from "@glade/shared/transport/payloadValues";
import type { CSSProperties } from "react";

export type TerminalSplitDirection = "horizontal" | "vertical";
export type TerminalLayout =
  | string
  | { direction: TerminalSplitDirection; first: TerminalLayout; second: TerminalLayout };
interface TerminalTabGroup {
  id: string;
  layout: TerminalLayout;
  terminalIds: string[];
}

function terminalLayoutIds(layout: TerminalLayout): string[] {
  return typeof layout === "string"
    ? [layout]
    : [...terminalLayoutIds(layout.first), ...terminalLayoutIds(layout.second)];
}

export function sanitizeTerminalLayouts(
  value: unknown,
  terminalIds: readonly string[],
): Record<string, TerminalLayout> {
  const layouts: [string, TerminalLayout][] = [];
  const seen = new Set<string>();
  const read = (node: unknown, depth: number): TerminalLayout | null => {
    if (depth > 64) return null;
    if (typeof node === "string") {
      if (!terminalIds.includes(node) || seen.has(node)) return null;
      seen.add(node);
      return node;
    }
    if (!isRecord(node) || (node.direction !== "horizontal" && node.direction !== "vertical"))
      return null;
    const first = read(node.first, depth + 1),
      second = read(node.second, depth + 1);
    return first && second ? { direction: node.direction, first, second } : (first ?? second);
  };
  if (isRecord(value))
    for (const [id, node] of Object.entries(value)) {
      const layout = read(node, 0);
      if (layout) layouts.push([id, layout]);
    }
  return Object.fromEntries(layouts);
}

export function terminalTabGroups(state: {
  terminalIds: readonly string[];
  terminalLayouts?: Record<string, TerminalLayout>;
}): TerminalTabGroup[] {
  const grouped = new Set<string>();
  const groups = Object.entries(state.terminalLayouts ?? {}).map(([id, layout]) => {
    const terminalIds = terminalLayoutIds(layout);
    for (const terminalId of terminalIds) grouped.add(terminalId);
    return { id, layout, terminalIds };
  });
  return [
    ...groups,
    ...state.terminalIds
      .filter((id) => !grouped.has(id))
      .map((id) => ({ id, layout: id, terminalIds: [id] })),
  ].toSorted(
    (left, right) =>
      state.terminalIds.indexOf(left.terminalIds[0]!) -
      state.terminalIds.indexOf(right.terminalIds[0]!),
  );
}

export function splitTerminalLayout(
  layout: TerminalLayout,
  target: string,
  next: string,
  direction: TerminalSplitDirection,
): TerminalLayout {
  if (typeof layout === "string")
    return layout === target ? { direction, first: target, second: next } : layout;
  return {
    ...layout,
    first: splitTerminalLayout(layout.first, target, next, direction),
    second: splitTerminalLayout(layout.second, target, next, direction),
  };
}

export function terminalLayoutPositions(layout: TerminalLayout): Record<string, CSSProperties> {
  const positions: Record<string, CSSProperties> = {};
  const sizes = new Map<TerminalLayout, { columns: number; rows: number }>();
  const measure = (node: TerminalLayout): { columns: number; rows: number } => {
    const size =
      typeof node === "string"
        ? { columns: 1, rows: 1 }
        : (() => {
            const first = measure(node.first),
              second = measure(node.second);
            return node.direction === "vertical"
              ? { columns: first.columns + second.columns, rows: Math.max(first.rows, second.rows) }
              : {
                  columns: Math.max(first.columns, second.columns),
                  rows: first.rows + second.rows,
                };
          })();
    sizes.set(node, size);
    return size;
  };
  measure(layout);
  const place = (
    node: TerminalLayout,
    left: number,
    top: number,
    width: number,
    height: number,
  ) => {
    if (typeof node === "string") {
      positions[node] = {
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
      };
      return;
    }
    const columns = node.direction === "vertical";
    const axis = columns ? "columns" : "rows";
    // Repeated splits share space by their required grid size instead of shrinking exponentially.
    const ratio = sizes.get(node.first)![axis] / sizes.get(node)![axis];
    const firstWidth = columns ? width * ratio : width;
    const firstHeight = columns ? height : height * ratio;
    place(node.first, left, top, firstWidth, firstHeight);
    place(
      node.second,
      left + (columns ? firstWidth : 0),
      top + (columns ? 0 : firstHeight),
      columns ? width - firstWidth : width,
      columns ? height : height - firstHeight,
    );
  };
  place(layout, 0, 0, 100, 100);
  return positions;
}
