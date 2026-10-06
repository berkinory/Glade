import { PlusIcon, TerminalIcon, GlobeIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { PanelTabBar, type PanelTab } from "./PanelTabBar";

export function WorkspaceGroupTabBar(props: {
  tabs: readonly PanelTab[];
  activeId: string | null;
  focused: boolean;
  split: boolean;
  onSelect: (id: string) => void;
  onAddTerminal: () => void;
  onAddBrowser: () => void;
}) {
  return (
    <PanelTabBar
      label="Workspace tabs"
      pinnedTabId="chat"
      className={cn(
        "h-auto flex-1 border-0 bg-transparent p-0",
        props.split && props.focused && "shadow-[inset_0_-1px_0_var(--color-primary)]",
      )}
      tabs={props.tabs}
      activeId={props.activeId}
      onSelect={props.onSelect}
      actions={
        <Menu modal={false}>
          <MenuTrigger
            render={<Button variant="chrome" size="icon-xs" aria-label="Open workspace tab" />}
          >
            <PlusIcon className="size-3.5" />
          </MenuTrigger>
          <ComposerPickerMenuPopup align="end" side="bottom" className="w-44 min-w-44">
            <MenuItem onClick={props.onAddTerminal}>
              <TerminalIcon className="size-3.5" />
              Terminal
            </MenuItem>
            <MenuItem onClick={props.onAddBrowser}>
              <GlobeIcon className="size-3.5" />
              Browser
            </MenuItem>
          </ComposerPickerMenuPopup>
        </Menu>
      }
    />
  );
}
