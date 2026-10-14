import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

// A closed list's one line: what it holds, how many are running and how many are done. Clicking it
// opens the list.
export function EnvironmentListSummary({
  leading,
  runningCount,
  doneCount,
  expandLabel,
  onExpand,
}: {
  leading?: ReactNode;
  runningCount: number;
  doneCount: number;
  expandLabel: string;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={expandLabel}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-ui",
        "hover:bg-[var(--color-background-button-secondary-hover)]",
      )}
      onClick={onExpand}
    >
      {leading ? <span className="flex shrink-0 items-center gap-1">{leading}</span> : null}
      <span className="min-w-0 flex-1 truncate text-foreground/85">
        {runningCount > 0 ? `${runningCount} running` : null}
      </span>
      {doneCount > 0 ? (
        <span className="shrink-0 text-muted-foreground">{doneCount} done</span>
      ) : null}
    </button>
  );
}
