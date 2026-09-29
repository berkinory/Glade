import { type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Spinner } from "../ui/spinner";

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
