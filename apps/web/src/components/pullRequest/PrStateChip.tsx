import type { OrchestrationThreadPullRequest } from "@glade/contracts/orchestration/threadEntities";
import type { MouseEvent } from "react";

import { cn } from "~/lib/utils";
import {
  PR_STATE_PRESENTATION_ICONS,
  resolvePrStatePresentation,
} from "./pullRequestStatePresentation";
import { PR_FINE_TEXT_CLASS_NAME } from "./pullRequestText";

export function PrStateChip({
  pr,
  className,
  onOpen,
}: {
  pr: OrchestrationThreadPullRequest;
  className?: string;
  // Makes the chip a link-like target. It is a span (not a button/anchor) because hosts render it
  // inside their row button, where nested interactive elements are invalid.
  onOpen?: (event: MouseEvent<HTMLElement>) => void;
}) {
  const presentation = resolvePrStatePresentation(pr);
  const PrIcon = PR_STATE_PRESENTATION_ICONS[presentation.iconKind];
  return (
    <span
      title={`#${pr.number} ${presentation.label}: ${pr.title}`}
      onClick={onOpen}
      onAuxClick={onOpen}
      className={cn(
        PR_FINE_TEXT_CLASS_NAME,
        "flex shrink-0 items-center gap-0.5",
        presentation.colorClass,
        onOpen && "cursor-pointer hover:underline",
        className,
      )}
    >
      <PrIcon className="size-3 shrink-0" aria-hidden />#{pr.number}
    </span>
  );
}
