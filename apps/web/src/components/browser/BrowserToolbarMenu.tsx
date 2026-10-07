import type { ReactNode } from "react";
import { ComposerPickerMenuPopup } from "../chat/ComposerPickerMenuPopup";
import { Button } from "../ui/button";
import { Menu, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// An icon in the browser toolbar that opens a menu, with the tooltip of the panel's other buttons.
export function BrowserToolbarMenu(props: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={props.label}
                  disabled={props.disabled}
                  className="[&_svg]:mx-0 data-popup-open:bg-[var(--color-background-button-secondary)] data-popup-open:text-[var(--color-text-foreground)]"
                />
              }
            />
          }
        >
          {props.icon}
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          <p>{props.label}</p>
        </TooltipPopup>
      </Tooltip>
      <ComposerPickerMenuPopup align="end" side="bottom" className="w-64 min-w-64">
        {props.children}
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
