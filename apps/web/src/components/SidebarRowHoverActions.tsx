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
        "hidden items-center justify-end",
        "group-hover/thread-row:inline-flex group-focus-within/thread-row:inline-flex",
      )}
    >
      {children}
    </div>
  );
}
