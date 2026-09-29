import { Skeleton } from "../ui/skeleton";
import { cn } from "~/lib/utils";
import { fileRowIndentStyle } from "./fileRowStyles";

const ROW_WIDTHS = ["w-9/12", "w-6/12", "w-7/12"];

export function ExplorerLoadingRows(props: { depth: number; label?: string }) {
  return (
    <div
      className="space-y-1.5 py-1.5 pr-2"
      style={fileRowIndentStyle(props.depth)}
      role="status"
      aria-label={props.label ?? "Loading directory..."}
    >
      {ROW_WIDTHS.map((width) => (
        <div key={width} className="flex h-5 items-center gap-1.5">
          <Skeleton className="size-3.5 shrink-0 rounded-sm" />
          <Skeleton className={cn("h-3 rounded-full", width)} />
        </div>
      ))}
    </div>
  );
}
