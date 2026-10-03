import type { ReactNode } from "react";

import { PanelStateMessage } from "./PanelStateMessage";

export function PanelEmptyState(props: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
  fill?: "full" | "flex";
}) {
  return (
    <PanelStateMessage fill={props.fill ?? "full"} className="overflow-auto">
      <div className="flex max-w-sm flex-col items-center gap-5">
        <div className="flex size-20 items-center justify-center rounded-2xl bg-muted/50">
          {props.icon}
        </div>
        <div className="space-y-2">
          <h2 className="text-ui-lg font-medium text-foreground">{props.title}</h2>
          <p className="text-ui leading-relaxed">{props.description}</p>
        </div>
        {props.children}
      </div>
    </PanelStateMessage>
  );
}
