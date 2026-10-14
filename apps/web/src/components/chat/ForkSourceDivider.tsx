import { WorkflowCircle04Icon } from "~/lib/icons";
import { ConversationDivider } from "./ConversationDivider";
import { type ThreadId } from "@glade/contracts/core/baseSchemas";
import { memo, type MouseEvent } from "react";
export interface ForkSourceReference {
  readonly sourceThreadId: ThreadId;
  readonly sourceTitle: string;
}
function shouldUseClientNavigation(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
export const ForkSourceDivider = memo(function ForkSourceDivider({
  source,
  onOpenSourceThread,
}: {
  readonly source: ForkSourceReference;
  readonly onOpenSourceThread: (threadId: ThreadId) => void;
}) {
  const sourceHref = `/${encodeURIComponent(source.sourceThreadId)}`;
  return (
    <ConversationDivider kind="fork">
      <a
        href={sourceHref}
        aria-label={`Open source chat ${source.sourceTitle}`}
        title={source.sourceTitle}
        className="inline-flex min-w-0 shrink items-center gap-2 rounded-sm text-ui font-normal text-[var(--color-text-accent)] transition-opacity duration-(--ui-motion-default-duration) hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-border-focus)]/60"
        onClick={(event) => {
          if (!shouldUseClientNavigation(event)) {
            return;
          }
          event.preventDefault();
          onOpenSourceThread(source.sourceThreadId);
        }}
      >
        <WorkflowCircle04Icon className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
        <span className="truncate">Continued from chat</span>
      </a>
    </ConversationDivider>
  );
});
