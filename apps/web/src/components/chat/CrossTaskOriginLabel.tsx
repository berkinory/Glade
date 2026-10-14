import { type ProviderKind, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { memo, type ReactNode } from "react";

import { BotIcon } from "~/lib/icons";
import { GladeLogo } from "../GladeLogo";
import { cn } from "~/lib/utils";

export interface CrossTaskOrigin {
  readonly sourceThreadId: ThreadId;
  readonly sourceProvider: ProviderKind | null;
  // A provider's own subagent was briefed by its parent agent, not sent over by Glade.
  readonly subagentParentTitle: string | null;
}

function OriginContent({ origin }: { origin: CrossTaskOrigin }): ReactNode {
  if (origin.subagentParentTitle !== null) {
    return (
      <>
        <BotIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        <span className="truncate">Brief from {origin.subagentParentTitle}</span>
      </>
    );
  }
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/70">
        <GladeLogo className="h-4 w-auto" aria-label="Glade" />
      </span>
      <span className="truncate">Sent by Glade from another chat</span>
    </>
  );
}

export const CrossTaskOriginLabel = memo(function CrossTaskOriginLabel({
  origin,
  onOpenSourceThread,
}: {
  readonly origin: CrossTaskOrigin;
  readonly onOpenSourceThread?: (threadId: ThreadId) => void;
}) {
  const className = cn(
    "inline-flex max-w-full items-center gap-2 self-end rounded-md py-1",
    "font-system-ui text-ui font-normal text-muted-foreground/72",
    onOpenSourceThread &&
      "cursor-pointer transition-colors duration-(--ui-motion-default-duration) hover:text-foreground/82 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  );

  if (onOpenSourceThread) {
    return (
      <button
        type="button"
        className={className}
        data-cross-task-origin="true"
        aria-label="Open source chat"
        onClick={() => onOpenSourceThread(origin.sourceThreadId)}
      >
        <OriginContent origin={origin} />
      </button>
    );
  }

  return (
    <div className={className} data-cross-task-origin="true">
      <OriginContent origin={origin} />
    </div>
  );
});
