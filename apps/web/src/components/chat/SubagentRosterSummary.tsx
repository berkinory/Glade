import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { cn } from "~/lib/utils";
import { SubagentAvatar } from "./SubagentAvatar";

const MAX_AVATARS = 5;

export function SubagentRosterSummary({
  threadIds,
  runningCount,
  doneCount,
  onExpand,
  className,
}: {
  threadIds: ReadonlyArray<ThreadId>;
  runningCount: number;
  doneCount: number;
  onExpand: () => void;
  className?: string;
}) {
  const hidden = threadIds.length - MAX_AVATARS;
  return (
    <button
      type="button"
      aria-label="Show subagent list"
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md text-left text-ui hover:bg-[var(--color-background-button-secondary-hover)]",
        className,
      )}
      onClick={onExpand}
    >
      <span className="flex shrink-0 items-center gap-1">
        {threadIds.slice(0, MAX_AVATARS).map((threadId) => (
          <SubagentAvatar key={threadId} threadId={threadId} />
        ))}
        {hidden > 0 ? <span className="text-ui-sm text-muted-foreground">+{hidden}</span> : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/85">
        {runningCount > 0 ? `${runningCount} running` : null}
      </span>
      {doneCount > 0 ? (
        <span className="shrink-0 text-muted-foreground">{doneCount} done</span>
      ) : null}
    </button>
  );
}
