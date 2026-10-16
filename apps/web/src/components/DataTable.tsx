import { useState } from "react";
import { ArrowUpDownIcon, ChevronDownIcon, ChevronUpIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  formatTableCell,
  isNumericColumn,
  nextTableSort,
  sortedRowOrder,
  type TableCell,
  type TableSort,
} from "./DataTable.logic";

const TEXT_CLASSES = {
  chat: { header: "text-chat-meta", body: undefined },
  ui: { header: "text-ui-xs", body: "text-ui-sm" },
} as const;

export function DataTable(props: {
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<TableCell>>;
  readonly caption?: string | undefined;
  readonly text: keyof typeof TEXT_CLASSES;
  readonly rowLimit?: number | undefined;
  readonly className?: string | undefined;
}) {
  const [sort, setSort] = useState<TableSort | null>(null);
  const numeric = props.columns.map((_, column) => isNumericColumn(props.rows, column));
  const order = sortedRowOrder(props.rows, sort);
  const visibleOrder = props.rowLimit === undefined ? order : order.slice(0, props.rowLimit);
  const hiddenRowCount = order.length - visibleOrder.length;
  const text = TEXT_CLASSES[props.text];
  return (
    <div className={cn("min-w-0 overflow-auto", props.className)}>
      <table className={cn("min-w-full border-collapse", text.body)}>
        {props.caption ? (
          <caption className="px-3 pt-2 pb-1 text-start font-medium">{props.caption}</caption>
        ) : null}
        <thead className="sticky top-0 bg-background">
          <tr>
            {props.columns.map((column, index) => {
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
                      "group/sort flex w-full items-center gap-1 px-3 py-1.5 whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                      text.header,
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
          {visibleOrder.map((rowIndex) => (
            <tr key={rowIndex} className="border-b border-border last:border-b-0">
              {props.columns.map((_, index) => {
                const cell = props.rows[rowIndex]![index];
                return (
                  <td
                    key={index}
                    className={cn(
                      "px-3 py-1.5 align-top",
                      numeric[index]
                        ? "text-end whitespace-nowrap tabular-nums"
                        : "max-w-[32rem] text-start break-words",
                    )}
                  >
                    {cell === undefined ? null : formatTableCell(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {hiddenRowCount > 0 ? (
        <p className="px-3 py-2 text-ui-xs text-muted-foreground">
          Showing the first {visibleOrder.length.toLocaleString()} of{" "}
          {order.length.toLocaleString()} rows.
        </p>
      ) : null}
    </div>
  );
}
