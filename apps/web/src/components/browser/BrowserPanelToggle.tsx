import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";
import { isElectron } from "~/env";
import { shortcutLabelForCommand } from "~/keybindings";
import { Globe02Icon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { CHAT_HEADER_TOGGLE_CLASS_NAME, SurfaceChipIcon } from "../chat/chatHeaderControls";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useBrowserPanelStore } from "./browserPanelStore";

export function BrowserPanelToggle(props: {
  threadId: ThreadId;
  keybindings: ResolvedKeybindingsConfig;
}) {
  const open = useBrowserPanelStore((store) => store.openByThreadId[props.threadId] === true);
  const setOpen = useBrowserPanelStore((store) => store.setOpen);
  if (!isElectron) return null;
  const shortcut = shortcutLabelForCommand(props.keybindings, "browser.toggle");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className={cn(
              CHAT_HEADER_TOGGLE_CLASS_NAME,
              "!size-7 [&_svg,&_[data-slot=central-icon]]:mx-0",
            )}
            pressed={open}
            onPressedChange={(pressed) => setOpen(props.threadId, pressed)}
            aria-label="Toggle browser"
            variant="default"
            size="xs"
          >
            <SurfaceChipIcon icon={Globe02Icon} className="size-4" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {`${open ? "Close" : "Open"} browser${shortcut ? ` (${shortcut})` : ""}`}
      </TooltipPopup>
    </Tooltip>
  );
}
