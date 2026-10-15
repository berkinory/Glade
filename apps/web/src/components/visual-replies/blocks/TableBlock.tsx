import { useState } from "react";
import { ArrowUpDownIcon, ChevronDownIcon, ChevronUpIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  formatTableCell,
  isNumericColumn,
  nextTableSort,
  sortedRowOrder,
  type TableSort,
} from "./TableBlock.logic";
import type { VisualBlockOf } from "./visualBlockTypes";

export function TableBlock({ block }: { readonly block: VisualBlockOf<"table"> }) {
  const [sort, setSort] = useState<TableSort | null>(null);
  const numeric = block.columns.map((_, column) => isNumericColumn(block.rows, column));
  return (
    <div className="max-h-[32rem] min-w-0 overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse">
        {block.title ? (
          <caption className="px-3 pt-2 pb-1 text-start font-medium">{block.title}</caption>
        ) : null}
        <thead className="sticky top-0 bg-background">
          <tr>
            {block.columns.map((column, index) => {
              const direction = sort?.column === index ? sort.direction : undefined;
              const SortIcon =
                direction === "ascending"
                  ? ChevronUpIcon
                  : direction === "descending"
                    ? ChevronDownIcon
                    : ArrowUpDownIcon;
              return (
                <th
                  key={`${column}:${index}`}
                  scope="col"
                  aria-sort={direction ?? "none"}
                  className="border-b border-border p-0 font-medium"
                >
                  <button
                    type="button"
                    onClick={() => setSort(nextTableSort(sort, index))}
                    className={cn(
                      "group/sort flex w-full items-center gap-1 px-3 py-1.5 text-chat-meta text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                      numeric[index] ? "justify-end text-end" : "text-start",
                    )}
                  >
                    {column}
                    <SortIcon
                      aria-hidden="true"
                      className={cn(
                        "size-3 shrink-0",
                        direction ? "opacity-100" : "opacity-0 group-hover/sort:opacity-60",
                      )}
                    />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRowOrder(block.rows, sort).map((rowIndex) => (
            <tr key={rowIndex} className="border-b border-border last:border-b-0">
              {block.rows[rowIndex]!.map((cell, index) => (
                <td
                  key={index}
                  className={cn(
                    "px-3 py-1.5 align-top",
                    numeric[index] ? "text-end tabular-nums" : "text-start break-words",
                  )}
                >
                  {formatTableCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
