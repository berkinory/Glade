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
        "pointer-events-none col-start-1 row-start-1 inline-flex items-center justify-end",
        "opacity-0 transition-opacity group-hover/thread-row:pointer-events-auto group-hover/thread-row:opacity-100 group-focus-within/thread-row:pointer-events-auto group-focus-within/thread-row:opacity-100",
      )}
    >
      {children}
    </div>
  );
}
