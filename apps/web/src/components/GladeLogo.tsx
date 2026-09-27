// FILE: GladeLogo.tsx
// Purpose: Render the Glade mark as an inline SVG that follows theme foreground color.
// Layer: Shared app branding primitive

import type { SVGProps } from "react";
import { GLADE_MARK_QUADRANT, GLADE_MARK_ROTATIONS, GLADE_MARK_VIEWBOX } from "~/assets/gladeMark";
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
      {GLADE_MARK_ROTATIONS.map((rotation) => (
        <path
          key={rotation}
          d={GLADE_MARK_QUADRANT}
          transform={`rotate(${rotation} 512 512)`}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
