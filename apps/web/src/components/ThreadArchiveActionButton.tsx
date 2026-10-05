import { Archive04Icon } from "~/lib/icons";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { cn } from "~/lib/utils";
import { SIDEBAR_TRAILING_ICON_CLASS, sidebarGlyphClass } from "./sidebarGlyphs";
import { SidebarIconButton } from "./SidebarIconButton";
export function ThreadArchiveActionButton({
  threadId,
  toneClassName,
  compact,
  onArchive,
}: {
  threadId: ThreadId;
  toneClassName?: string;
  compact?: boolean;
  onArchive: () => void;
}) {
  const isCompact = compact === true;
  return (
    <SidebarIconButton
      icon={Archive04Icon}
      label="Archive thread"
      title="Archive thread"
      data-testid={`thread-archive-${threadId}`}
      size={isCompact ? "sm" : "md"}
      iconClassName={isCompact ? sidebarGlyphClass("compact") : SIDEBAR_TRAILING_ICON_CLASS}
      className={cn("hover:text-foreground/89", toneClassName)}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onArchive();
      }}
    />
  );
}
