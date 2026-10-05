import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export function SidebarRowHoverActions({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={`thread-hover-actions-${threadId}`}
      className={cn(
        "pointer-events-none absolute top-1/2 right-0 inline-flex -translate-y-1/2 items-center justify-end",
        "opacity-0 transition-opacity group-hover/thread-row:pointer-events-auto group-hover/thread-row:opacity-100 group-focus-within/thread-row:pointer-events-auto group-focus-within/thread-row:opacity-100",
      )}
    >
      {children}
    </div>
  );
}
