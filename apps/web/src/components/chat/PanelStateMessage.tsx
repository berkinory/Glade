// FILE: PanelStateMessage.tsx
// Purpose: Centered muted "empty / unavailable / hint" text shared by dock panes
//          (GitPanel, DiffPanel, right-dock placeholders) so the repeated
//          flex-center + muted-foreground block lives in one place.
// Layer: Chat/panel UI primitives
// Loading labels render the shared spinner; content-shaped skeletons remain separate.

import { type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Spinner } from "../ui/spinner";

// `comfortable` matches the larger pane placeholders (text-sm, p-6); `compact`
// matches dense in-panel hints (text-xs, dimmer). `fill` chooses between filling
// a fixed-height parent (`full`) or flexing within a column (`flex`).
export function PanelStateMessage(props: {
  children?: ReactNode;
  loadingLabel?: string;
  density?: "comfortable" | "compact";
  fill?: "full" | "flex";
  className?: string;
}) {
  const density = props.density ?? "comfortable";
  const fill = props.fill ?? "full";
  return (
    <div
      className={cn(
        "flex w-full items-center justify-center text-center",
        fill === "full" ? "h-full min-h-0" : "flex-1",
        density === "comfortable"
          ? "p-6 text-ui leading-snug text-muted-foreground"
          : "px-5 text-ui leading-snug text-muted-foreground/70",
        props.className,
      )}
    >
      {props.loadingLabel ? (
        <Spinner className="size-5" aria-label={props.loadingLabel} />
      ) : (
        props.children
      )}
    </div>
  );
}
