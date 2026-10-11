import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export function DiffStat({
  insertions,
  deletions,
  separator,
  colored,
  className,
}: {
  insertions: number;
  deletions: number;
  /** Rendered between the two counts — e.g. a "/" in dense file rows. */
  separator?: ReactNode;
  /** Off renders both counts in the surrounding text color. */
  colored?: boolean;
  className?: string;
}) {
  const tinted = colored ?? true;
  return (
    <span
      className={cn("inline-flex items-center gap-1 tabular-nums", className)}
      data-slot="diff-stat"
    >
      <span className={tinted ? "text-success" : undefined}>+{insertions.toLocaleString()}</span>
      {separator}
      <span className={tinted ? "text-destructive" : undefined}>−{deletions.toLocaleString()}</span>
    </span>
  );
}
