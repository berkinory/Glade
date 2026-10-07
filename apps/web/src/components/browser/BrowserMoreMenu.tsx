import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { CodeSquareIcon, EllipsisIcon, ExternalLinkIcon } from "~/lib/icons";
import { readNativeApi } from "~/nativeApi";
import { MenuItem } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { BrowserToolbarMenu } from "./BrowserToolbarMenu";
import type { BrowserTab } from "./useBrowserTabs";

const ICON_CLASS_NAME = "size-3.5 shrink-0 text-muted-foreground";

export function BrowserMoreMenu(props: { threadId: ThreadId; tab: BrowserTab | null }) {
  const { tab } = props;
  const bridge = window.desktopBridge?.browser;
  const webUrl = tab && /^https?:/iu.test(tab.url) ? tab.url : null;

  return (
    <BrowserToolbarMenu label="More" icon={<EllipsisIcon className="size-3.5" />} disabled={!tab}>
      <MenuItem
        disabled={webUrl === null}
        onClick={() => {
          if (!webUrl) return;
          readNativeApi()
            ?.shell.openExternal(webUrl)
            .catch((error: unknown) => {
              toastManager.add({
                type: "error",
                title: "Could not open the page",
                description: error instanceof Error ? error.message : String(error),
              });
            });
        }}
      >
        <ExternalLinkIcon className={ICON_CLASS_NAME} />
        Open in default browser
      </MenuItem>
      <MenuItem
        onClick={() => {
          if (tab) bridge?.toggleDevTools({ threadId: props.threadId, tabId: tab.tabId });
        }}
      >
        <CodeSquareIcon className={ICON_CLASS_NAME} />
        Toggle developer tools
      </MenuItem>
    </BrowserToolbarMenu>
  );
}
