import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { EraserIcon, ShieldCheckIcon, ShieldOffIcon } from "~/lib/icons";
import { readNativeApi } from "~/nativeApi";
import { MenuCheckboxItem, MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { BrowserToolbarMenu } from "./BrowserToolbarMenu";
import { useBrowserContentBlocker } from "./useBrowserContentBlocker";
import type { BrowserTab } from "./useBrowserTabs";

async function clearSiteData(threadId: ThreadId, tabId: string, domain: string): Promise<void> {
  const api = readNativeApi();
  const bridge = window.desktopBridge?.browser;
  if (!api || !bridge) return;
  const confirmed = await api.dialogs.confirm(
    `Clear data for ${domain}?\nThis removes its cookies, storage and cache in Glade's browser and signs you out of it.`,
  );
  if (!confirmed) return;
  await bridge.clearSiteData({ threadId, tabId }).catch((error: unknown) => {
    toastManager.add({
      type: "error",
      title: "Could not clear site data",
      description: error instanceof Error ? error.message : String(error),
    });
  });
}

// The active site's settings: whether the content blocker runs on it, and clearing its data.
export function BrowserSiteMenu(props: {
  threadId: ThreadId;
  tab: BrowserTab | null;
  onSiteBlocking: (enabled: boolean) => void;
}) {
  const blocker = useBrowserContentBlocker();
  const site = props.tab?.site ?? null;
  const tab = props.tab;
  if (!blocker.available || !tab || site === null) return null;
  const host = site.domain;
  const globallyOff = blocker.enabled === false;
  const blocking = site.blocking && !globallyOff;

  return (
    <BrowserToolbarMenu
      label={blocking ? `Blocking ads and trackers on ${host}` : `Not blocking on ${host}`}
      icon={
        blocking ? <ShieldCheckIcon className="size-3.5" /> : <ShieldOffIcon className="size-3.5" />
      }
    >
      <MenuGroup>
        <MenuGroupLabel className="truncate">{host}</MenuGroupLabel>
        <MenuCheckboxItem
          variant="switch"
          checked={site.blocking}
          disabled={globallyOff}
          onCheckedChange={(next) => props.onSiteBlocking(next)}
        >
          Block ads and trackers
        </MenuCheckboxItem>
        {globallyOff ? (
          <p className="px-2 pb-1 text-ui-xs text-muted-foreground">
            The blocker is turned off in Settings.
          </p>
        ) : null}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem
        variant="destructive"
        onClick={() => void clearSiteData(props.threadId, tab.tabId, site.domain)}
      >
        <EraserIcon className="size-3.5 shrink-0" />
        Clear data for {site.domain}
      </MenuItem>
    </BrowserToolbarMenu>
  );
}
