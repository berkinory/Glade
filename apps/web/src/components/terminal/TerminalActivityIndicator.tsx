import { Spinner } from "~/components/ui/spinner";
import type { TerminalVisualState } from "@glade/shared/threads/terminalThreads";

import { cn } from "~/lib/utils";

interface TerminalActivityIndicatorProps {
  className?: string;
  state?: Exclude<TerminalVisualState, "idle">;
}

export default function TerminalActivityIndicator({
  className,
  state: stateProp,
}: TerminalActivityIndicatorProps) {
  const state = stateProp ?? "running";
  if (state === "attention" || state === "review") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-1.5 shrink-0 rounded-full",
          state === "attention"
            ? "bg-amber-500 dark:bg-amber-300/90"
            : "bg-emerald-500 dark:bg-emerald-300/90",
          className,
        )}
      />
    );
  }

  return <Spinner variant="terminal" aria-hidden="true" className={cn("size-3", className)} />;
}
