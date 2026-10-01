import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export function SidebarSectionToolbar({
  placement: placementProp,
  revealOnHover: revealOnHoverProp,
  className,
  children,
}: {
  placement?: "inline" | "overlay";

  revealOnHover?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const placement = placementProp ?? "inline";
  const revealOnHover = revealOnHoverProp ?? false;
  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        placement === "inline" ? "-mr-1" : "absolute top-1 right-1.5",
        revealOnHover &&
          "pointer-events-none opacity-100 transition-opacity md:opacity-0 md:group-hover/project-header:pointer-events-auto md:group-hover/project-header:opacity-100 md:group-has-[:focus-visible]/project-header:pointer-events-auto md:group-has-[:focus-visible]/project-header:opacity-100 md:has-[[data-state=open]]:pointer-events-auto md:has-[[data-state=open]]:opacity-100",
        className,
      )}
    >
      {children}
    </div>
  );
}
