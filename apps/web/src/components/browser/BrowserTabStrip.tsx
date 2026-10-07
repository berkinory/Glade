import { Globe02Icon, PlusIcon } from "~/lib/icons";
import { SurfaceTabChip } from "../chat/chatHeaderControls";
import { IconButton } from "../ui/icon-button";
import { Spinner } from "../ui/spinner";
import type { BrowserTab } from "./useBrowserTabs";

export function BrowserTabStrip(props: {
  tabs: readonly BrowserTab[];
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNewTab: () => void;
}) {
  return (
    <nav
      aria-label="Browser tabs"
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {props.tabs.map((tab) => {
        const label = tab.title || tab.url || "New tab";
        return (
          <SurfaceTabChip
            key={tab.tabId}
            active={tab.active}
            title={tab.url || label}
            label={label}
            labelClassName="max-w-[10rem]"
            icon={tab.loading ? <Spinner aria-label="Loading" /> : <Globe02Icon />}
            closeLabel={`Close ${label}`}
            onSelect={() => props.onSelect(tab.tabId)}
            onClose={() => props.onClose(tab.tabId)}
          />
        );
      })}
      <IconButton label="New tab" tooltip="New tab" tooltipSide="bottom" onClick={props.onNewTab}>
        <PlusIcon className="size-3.5" />
      </IconButton>
    </nav>
  );
}
