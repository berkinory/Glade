import { formatVisualNumber } from "./visualNumber";

export type TableCell = string | number;
type SortDirection = "ascending" | "descending";
export interface TableSort {
  readonly column: number;
  readonly direction: SortDirection;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function isNumericColumn(rows: ReadonlyArray<ReadonlyArray<TableCell>>, column: number) {
  return rows.every((row) => typeof row[column] === "number");
}

export function formatTableCell(cell: TableCell): string {
  return typeof cell === "number" ? formatVisualNumber(cell) : cell;
}

// Numbers sort before text so a mostly numeric column stays ordered by value.
function compareCells(left: TableCell, right: TableCell): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "number") return -1;
  if (typeof right === "number") return 1;
  return collator.compare(left, right);
}

export function sortedRowOrder(
  rows: ReadonlyArray<ReadonlyArray<TableCell>>,
  sort: TableSort | null,
): readonly number[] {
  const order = rows.map((_, index) => index);
  if (!sort) return order;
  const sign = sort.direction === "ascending" ? 1 : -1;
  return order.toSorted(
    (left, right) => sign * compareCells(rows[left]![sort.column]!, rows[right]![sort.column]!),
  );
}

// Header clicks cycle a column through ascending, descending and the agent's original order.
export function nextTableSort(current: TableSort | null, column: number): TableSort | null {
  if (current?.column !== column) return { column, direction: "ascending" };
  return current.direction === "ascending" ? { column, direction: "descending" } : null;
}
