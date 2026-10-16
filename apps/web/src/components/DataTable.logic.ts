import { formatVisualNumber } from "./visual-replies/blocks/visualNumber";

export type TableCell = string | number;
type SortDirection = "ascending" | "descending";
export interface TableSort {
  readonly column: number;
  readonly direction: SortDirection;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const NUMERIC_TEXT_PATTERN = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

// File-backed tables hold raw text, so numeric-looking strings count as numbers for alignment and
// sorting while still rendering exactly as written.
function cellNumber(cell: TableCell): number | null {
  if (typeof cell === "number") return cell;
  const trimmed = cell.trim();
  return NUMERIC_TEXT_PATTERN.test(trimmed) ? Number(trimmed) : null;
}

function isBlankCell(cell: TableCell | undefined): boolean {
  return cell === undefined || (typeof cell === "string" && cell.trim() === "");
}

export function isNumericColumn(rows: ReadonlyArray<ReadonlyArray<TableCell>>, column: number) {
  let sawNumber = false;
  for (const row of rows) {
    const cell = row[column];
    if (isBlankCell(cell)) continue;
    if (cellNumber(cell!) === null) return false;
    sawNumber = true;
  }
  return sawNumber;
}

export function formatTableCell(cell: TableCell): string {
  return typeof cell === "number" ? formatVisualNumber(cell) : cell;
}

// Numbers sort before text, and blanks sort last, so a mostly numeric column stays ordered by value.
function compareCells(left: TableCell | undefined, right: TableCell | undefined): number {
  const leftBlank = isBlankCell(left);
  const rightBlank = isBlankCell(right);
  if (leftBlank || rightBlank) return Number(leftBlank) - Number(rightBlank);
  const leftNumber = cellNumber(left!);
  const rightNumber = cellNumber(right!);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return collator.compare(String(left), String(right));
}

export function sortedRowOrder(
  rows: ReadonlyArray<ReadonlyArray<TableCell>>,
  sort: TableSort | null,
): readonly number[] {
  const order = rows.map((_, index) => index);
  if (!sort) return order;
  const sign = sort.direction === "ascending" ? 1 : -1;
  return order.toSorted(
    (left, right) => sign * compareCells(rows[left]![sort.column], rows[right]![sort.column]),
  );
}

// Header clicks cycle a column through ascending, descending and the original order.
export function nextTableSort(current: TableSort | null, column: number): TableSort | null {
  if (current?.column !== column) return { column, direction: "ascending" };
  return current.direction === "ascending" ? { column, direction: "descending" } : null;
}
