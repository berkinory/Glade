import { cn } from "~/lib/utils";
import type { ThreadStatusPill } from "./Sidebar.logic.statusTypes";
import { Spinner } from "~/components/ui/spinner";

export const SIDEBAR_STATUS_DOT_CLASS_NAME =
  "size-[7px] shrink-0 rounded-full bg-[var(--color-text-accent)]";

function SidebarUnreadCompletionGlyph({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Unread completion"
      className={cn(SIDEBAR_STATUS_DOT_CLASS_NAME, className)}
    />
  );
}

export function SidebarStatusTrailingGlyph({ status }: { status: ThreadStatusPill }) {
  if (status.label === "Completed") {
    return <SidebarUnreadCompletionGlyph />;
  }
  if (status.pulse) {
    return (
      <span role="img" aria-label={status.label} className="inline-flex shrink-0">
        <Spinner variant="working" className="size-3 text-muted-foreground/70" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={status.label}
      className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)}
    />
  );
}
