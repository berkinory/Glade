import { Fragment } from "react";
import { createClientPointMenuAnchor } from "~/lib/clientPointMenuAnchor";
import { cn } from "~/lib/utils";
import { ComposerPickerMenuPopup } from "../chat/ComposerPickerMenuPopup";
import {
  SIDEBAR_CONTEXT_MENU_ICON_CLASS_NAME,
  SIDEBAR_CONTEXT_MENU_ITEM_CLASS_NAME,
  SIDEBAR_CONTEXT_MENU_PANEL_CLASS_NAME,
} from "../sidebarContextMenuStyles";
import { Menu, MenuGroup, MenuItem, MenuSeparator } from "../ui/menu";
import { closeContextMenu, type ContextMenuItem, useOpenContextMenu } from "./contextMenuStore";
import { useEditContextMenu } from "./useEditContextMenu";

function hasSeparatorBefore(items: readonly ContextMenuItem[], index: number): boolean {
  const item = items[index]!;
  if (index === 0) return false;
  return (
    item.separatorBefore === true || (item.destructive === true && !items[index - 1]!.destructive)
  );
}

export function ContextMenuHost() {
  useEditContextMenu();
  const menu = useOpenContextMenu();
  if (!menu) return null;

  return (
    <Menu
      key={menu.key}
      open
      onOpenChange={(open, details) => {
        // Item presses resolve through the item's own click handler.
        if (!open && details.reason !== "item-press") closeContextMenu(null);
      }}
    >
      <ComposerPickerMenuPopup
        anchor={createClientPointMenuAnchor(menu.position)}
        align="start"
        side="bottom"
        sideOffset={0}
        className={SIDEBAR_CONTEXT_MENU_PANEL_CLASS_NAME}
      >
        <MenuGroup>
          {menu.items.map((item, index) => {
            const Icon = item.icon;
            return (
              <Fragment key={item.id}>
                {hasSeparatorBefore(menu.items, index) ? <MenuSeparator /> : null}
                {/* Disabled items ignore the pointer, so the wrapper carries the hover title. */}
                <div title={item.title}>
                  <MenuItem
                    className={item.destructive ? undefined : SIDEBAR_CONTEXT_MENU_ITEM_CLASS_NAME}
                    variant={item.destructive ? "destructive" : "default"}
                    disabled={item.disabled === true}
                    onClick={() => closeContextMenu(item.id)}
                  >
                    <span
                      className={cn(
                        SIDEBAR_CONTEXT_MENU_ICON_CLASS_NAME,
                        item.destructive && "text-current",
                      )}
                    >
                      <Icon aria-hidden="true" />
                    </span>
                    <span className="min-w-0 truncate">{item.label}</span>
                  </MenuItem>
                </div>
              </Fragment>
            );
          })}
        </MenuGroup>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
