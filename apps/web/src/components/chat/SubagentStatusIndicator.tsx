import { Spinner } from "~/components/ui/spinner";
import { SquareFilledIcon } from "~/lib/icons";
import { subagentStatusDotClassName, type SubagentStatusKind } from "~/lib/subagentPresentation";
import { cn } from "~/lib/utils";

export function SubagentStatusIndicator({
  statusKind,
  statusLabel,
  onStop,
}: {
  statusKind: SubagentStatusKind | null;
  statusLabel: string | undefined;
  onStop?: (() => void) | undefined;
}) {
  return (
    <span className="relative flex size-5 shrink-0 items-center justify-center">
      <span
        role="img"
        aria-label={statusLabel ?? "Status unavailable"}
        title={statusLabel}
        className={cn(
          "flex items-center justify-center transition-opacity",
          onStop && "group-hover/subagent-row:opacity-0 group-focus-within/subagent-row:opacity-0",
        )}
      >
        {statusKind === "running" ? (
          <Spinner variant="subagent" className="size-4" aria-hidden />
        ) : (
          <span className={cn("size-1.5 rounded-full", subagentStatusDotClassName(statusKind))} />
        )}
      </span>
      {onStop ? (
        <button
          type="button"
          aria-label="Stop subagent"
          title="Stop subagent"
          className="absolute inset-0 flex items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-[var(--color-background-button-secondary-hover)] group-hover/subagent-row:opacity-100 group-focus-within/subagent-row:opacity-100 focus-visible:opacity-100"
          onClick={onStop}
        >
          <SquareFilledIcon className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
