import { Globe02Icon, PlusIcon } from "~/lib/icons";
import { PanelTabBar } from "../chat/PanelTabBar";
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
    <PanelTabBar
      label="Browser tabs"
      contentTabs
      className="h-auto flex-1 border-0 bg-transparent p-0"
      tabs={props.tabs.map((tab) => ({
        id: tab.tabId,
        label: tab.title || tab.url || "New tab",
        icon: tab.loading ? <Spinner aria-label="Loading" /> : <Globe02Icon />,
        onClose: () => props.onClose(tab.tabId),
      }))}
      activeId={props.tabs.find((tab) => tab.active)?.tabId ?? null}
      onSelect={props.onSelect}
      actions={
        <IconButton label="New tab" tooltip="New tab" tooltipSide="bottom" onClick={props.onNewTab}>
          <PlusIcon className="size-3.5" />
        </IconButton>
      }
    />
  );
}
