import type { ReactNode } from "react";
import { SIDEBAR_TRAILING_ICON_FORCE_CLASS } from "./sidebarGlyphs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function SidebarMetaChipStack({
  chips,
}: {
  chips: Array<{ id: string; tooltip: string; icon: ReactNode }>;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {chips.map((chip) => (
        <Tooltip key={chip.id}>
          <TooltipTrigger
            render={
              <span
                aria-label={chip.tooltip}
                className={`inline-flex size-[15px] shrink-0 items-center justify-center ${SIDEBAR_TRAILING_ICON_FORCE_CLASS}`}
              >
                {chip.icon}
              </span>
            }
          />
          <TooltipPopup side="top">{chip.tooltip}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
