import {
  PlusIcon,
  ComputerTerminal01Icon,
  SquareSplitVerticalIcon,
  SquareSplitHorizontalIcon,
} from "~/lib/icons";
import { isMacNavigatorPlatform } from "~/lib/utils";
import type { TerminalSplitDirection } from "~/terminalLayout";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { PanelTabBar, type PanelTab } from "./PanelTabBar";
function TerminalSplitButton(props: {
  direction: TerminalSplitDirection;
  onSplit: (direction: TerminalSplitDirection) => void;
}) {
  const sideBySide = props.direction === "vertical";
  const Icon = sideBySide ? SquareSplitHorizontalIcon : SquareSplitVerticalIcon;
  const label = sideBySide ? "Split terminal vertically" : "Split terminal horizontally";
  const shortcut = isMacNavigatorPlatform()
    ? sideBySide
      ? "⌘D"
      : "⌘⇧D"
    : sideBySide
      ? "Ctrl+D"
      : "Ctrl+Shift+D";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="chrome"
            size="icon-xs"
            aria-label={label}
            onClick={() => props.onSplit(props.direction)}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {label} ({shortcut})
      </TooltipPopup>
    </Tooltip>
  );
}
export function WorkspaceTabBar(props: {
  tabs: readonly PanelTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAddTerminal: () => void;
  onSplitTerminal?: ((direction: TerminalSplitDirection) => void) | undefined;
}) {
  return (
    <PanelTabBar
      label="Workspace tabs"
      pinnedTabId="chat"
      contentTabs
      className="h-auto flex-1 border-0 bg-transparent p-0"
      tabs={props.tabs}
      activeId={props.activeId}
      onSelect={props.onSelect}
      actions={
        <div className="flex items-center gap-1">
          {props.onSplitTerminal ? (
            <>
              <TerminalSplitButton direction="horizontal" onSplit={props.onSplitTerminal} />
              <TerminalSplitButton direction="vertical" onSplit={props.onSplitTerminal} />
            </>
          ) : null}
          <Menu modal={false}>
            <MenuTrigger
              render={<Button variant="chrome" size="icon-xs" aria-label="Open workspace tab" />}
            >
              <PlusIcon className="size-3.5" />
            </MenuTrigger>
            <ComposerPickerMenuPopup align="end" side="bottom" className="w-44 min-w-44">
              <MenuItem onClick={props.onAddTerminal}>
                <ComputerTerminal01Icon className="size-3.5" />
                Terminal
              </MenuItem>
            </ComposerPickerMenuPopup>
          </Menu>
        </div>
      }
    />
  );
}
