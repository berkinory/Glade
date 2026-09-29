import type { HTMLAttributes } from "react";

import { cn } from "~/lib/utils";
import { PR_META_TEXT_CLASS_NAME } from "./pullRequestText";

export type PullRequestWarningNoteShape = "note" | "callout" | "banner";

const SHAPE_CLASS_NAME: Record<PullRequestWarningNoteShape, string> = {
  note: "rounded-md px-2 py-1.5",

  callout: "rounded-lg px-3 py-2",

  banner: "rounded-none border-x-0 border-t-0 px-3 py-2",
};

export function PullRequestWarningNote({
  children,
  className,
  shape: shapeProp,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { shape?: PullRequestWarningNoteShape }) {
  const shape = shapeProp ?? "note";
  return (
    <p
      {...props}
      className={cn(
        PR_META_TEXT_CLASS_NAME,

        "border border-warning/32 bg-warning/4 text-card-foreground",
        SHAPE_CLASS_NAME[shape],
        className,
      )}
    >
      {children}
    </p>
  );
}
