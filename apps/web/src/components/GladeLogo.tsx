import type { SVGProps } from "react";
import { GLADE_MARK_PATH, GLADE_MARK_VIEWBOX } from "~/assets/gladeMark";
import { cn } from "~/lib/utils";

export function GladeLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  const ariaLabel = props["aria-label"];

  return (
    <svg
      viewBox={GLADE_MARK_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaLabel ? undefined : true}
      {...props}
      className={cn("shrink-0 text-foreground", className)}
    >
      <path d={GLADE_MARK_PATH} fill="currentColor" />
    </svg>
  );
}
