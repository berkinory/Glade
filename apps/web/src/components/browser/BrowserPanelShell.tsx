import type { ReactNode } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
} from "../chat/chatHeaderControls";

export type BrowserPanelMode = "inline" | "sheet" | "sidebar" | "floating";

function getBrowserPanelHeaderRowClassName(mode: BrowserPanelMode) {
  const shouldUseDragRegion = isElectron && mode !== "sheet" && mode !== "floating";

  return cn(
    "flex w-full min-w-0 items-center gap-1.5 px-1.5",
    CHAT_SURFACE_HEADER_HEIGHT_CLASS,
    shouldUseDragRegion && cn("drag-region", CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME),
  );
}

export function BrowserPanelShell(props: {
  mode: BrowserPanelMode;
  header?: ReactNode;
  children: ReactNode;
}) {
  const shouldUseDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "floating";
  const hasHeader = props.header !== null && props.header !== undefined;

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col",
        props.mode === "floating" ? "bg-transparent" : "bg-[var(--app-content-surface)]",
        props.mode === "inline"
          ? "w-[42vw] min-w-[360px] max-w-[560px] shrink-0 border-l border-border"
          : "w-full",
      )}
    >
      {hasHeader ? (
        shouldUseDragRegion ? (
          <div className={getBrowserPanelHeaderRowClassName(props.mode)}>{props.header}</div>
        ) : (
          <div className={CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME}>
            <div className={getBrowserPanelHeaderRowClassName(props.mode)}>{props.header}</div>
          </div>
        )
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{props.children}</div>
    </div>
  );
}
