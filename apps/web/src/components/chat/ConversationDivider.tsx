import type { ReactNode } from "react";

export function ConversationDivider({
  children,
  kind,
}: {
  children: ReactNode;
  kind: "fork" | "handoff";
}) {
  return (
    <div
      data-fork-source-divider={kind === "fork" ? "true" : undefined}
      data-handoff-source-divider={kind === "handoff" ? "true" : undefined}
      className="flex w-full items-center gap-4 py-4 font-system-ui"
    >
      <span aria-hidden className="h-px min-w-0 flex-1 bg-[color:var(--color-border-light)]" />
      {children}
      <span aria-hidden className="h-px min-w-0 flex-1 bg-[color:var(--color-border-light)]" />
    </div>
  );
}
