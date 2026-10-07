import { ShieldCheckIcon, ShieldOffIcon } from "~/lib/icons";
import { MenuCheckboxItem, MenuGroup, MenuGroupLabel } from "../ui/menu";
import { BrowserToolbarMenu } from "./BrowserToolbarMenu";
import { useBrowserContentBlocker } from "./useBrowserContentBlocker";
import type { BrowserTab } from "./useBrowserTabs";

// The active site's settings: whether the content blocker runs on it.
export function BrowserSiteMenu(props: {
  tab: BrowserTab | null;
  onSiteBlocking: (enabled: boolean) => void;
}) {
  const blocker = useBrowserContentBlocker();
  const siteBlocking = props.tab?.siteBlocking ?? null;
  const host = props.tab ? URL.parse(props.tab.url)?.hostname : undefined;
  if (!blocker.available || siteBlocking === null || !host) return null;
  const globallyOff = blocker.enabled === false;
  const blocking = siteBlocking && !globallyOff;

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
          checked={siteBlocking}
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
    </BrowserToolbarMenu>
  );
}
