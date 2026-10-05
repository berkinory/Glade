import { Spinner } from "~/components/ui/spinner";
import { SquareFilledIcon } from "~/lib/icons";
import {
  subagentStatusDotClassName,
  subagentStatusTextToneClassName,
  type SubagentStatusKind,
} from "~/lib/subagentPresentation";
import { cn } from "~/lib/utils";

export function SubagentStatusIndicator({
  statusKind,
  statusLabel,
  onStop,
  variant = "icon",
}: {
  statusKind: SubagentStatusKind | null;
  statusLabel: string | undefined;
  onStop?: (() => void) | undefined;
  variant?: "icon" | "text";
}) {
  return (
    <span
      className={cn(
        "relative flex h-5 min-w-5 shrink-0 items-center justify-end",
        variant === "text" && "text-ui-sm",
      )}
    >
      <span
        role="img"
        aria-label={statusLabel ?? "Status unavailable"}
        title={statusLabel}
        className={cn(
          "flex min-w-5 items-center justify-center transition-opacity",
          variant === "text" && subagentStatusTextToneClassName(statusKind),
          onStop && "group-hover/subagent-row:opacity-0 group-focus-within/subagent-row:opacity-0",
        )}
      >
        {variant === "text" ? (
          statusLabel
        ) : statusKind === "running" ? (
          <Spinner variant="subagent" className="size-3" aria-hidden />
        ) : (
          <span className={cn("size-1.5 rounded-full", subagentStatusDotClassName(statusKind))} />
        )}
      </span>
      {onStop ? (
        <button
          type="button"
          aria-label="Stop subagent"
          title="Stop subagent"
          className="pointer-events-none absolute right-0 flex size-5 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-[var(--color-background-button-secondary-hover)] group-hover/subagent-row:pointer-events-auto group-hover/subagent-row:opacity-100 group-focus-within/subagent-row:pointer-events-auto group-focus-within/subagent-row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          onClick={onStop}
        >
          <SquareFilledIcon className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
