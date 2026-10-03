import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useComposerDraftStore } from "~/composerDraftStore";
import { hasUnsentComposerDraft } from "~/composerDraftDomain";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";
import { sidebarHoverRevealHideClassName } from "../sidebarRowStyles";

export function SidebarDraftIndicator({
  threadId,
  isActive,
  activity = false,
}: {
  threadId: ThreadId;
  isActive: boolean;
  activity?: boolean;
}) {
  const hasDraft = useComposerDraftStore((state) =>
    hasUnsentComposerDraft(state.draftsByThreadId[threadId]),
  );
  if (!hasDraft || isActive) return null;

  return (
    <span
      aria-label="Unsent draft"
      data-sidebar-draft-indicator
      title="Unsent draft"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground",
        activity && "absolute top-1 right-1",
        sidebarHoverRevealHideClassName(activity ? "activity-row" : "thread-row"),
      )}
    >
      <CentralIcon name="pencil" className="size-3" />
    </span>
  );
}
