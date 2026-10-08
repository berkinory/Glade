import type { ReactNode } from "react";
import { Globe02Icon, PlusIcon } from "~/lib/icons";
import { PanelTabBar } from "../chat/PanelTabBar";
import { IconButton } from "../ui/icon-button";
import { Spinner } from "../ui/spinner";
import { type BrowserTab, isBlankBrowserTab } from "./useBrowserTabs";

export function BrowserTabStrip(props: {
  tabs: readonly BrowserTab[];
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNewTab: () => void;
  children?: ReactNode;
}) {
  return (
    <PanelTabBar
      label="Browser tabs"
      contentTabs
      tabs={props.tabs.map((tab) => ({
        id: tab.tabId,
        label: isBlankBrowserTab(tab) ? "New tab" : tab.title || tab.url,
        icon: tab.loading ? <Spinner aria-label="Loading" /> : <Globe02Icon />,
        onClose: () => props.onClose(tab.tabId),
      }))}
      activeId={props.tabs.find((tab) => tab.active)?.tabId ?? null}
      onSelect={props.onSelect}
      actions={
        <div className="flex items-center gap-1">
          {props.children}
          <IconButton
            label="New tab"
            tooltip="New tab"
            tooltipSide="bottom"
            onClick={props.onNewTab}
          >
            <PlusIcon className="size-3.5" />
          </IconButton>
        </div>
      }
    />
  );
}
