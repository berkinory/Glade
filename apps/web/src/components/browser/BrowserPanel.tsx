import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { BrowserPanelCommand } from "@glade/contracts/transport/ws/browserRpc";
import { useEffect, useRef, useState } from "react";
import { readNativeApi } from "~/nativeApi";
import { PanelStateMessage } from "../chat/PanelStateMessage";
import { toastManager } from "../ui/toast";
import { BrowserAddressBar } from "./BrowserAddressBar";
import { BrowserAgentActivity } from "./BrowserAgentActivity";
import { BrowserCaptureButton } from "./BrowserCaptureButton";
import { BrowserMoreMenu } from "./BrowserMoreMenu";
import { BrowserPageDialog } from "./BrowserPageDialog";
import { BrowserPickElement } from "./BrowserPickElement";
import { BrowserSiteMenu } from "./BrowserSiteMenu";
import { BrowserTabStrip } from "./BrowserTabStrip";
import type { BrowserTab } from "./useBrowserTabs";
import { useBrowserViewPlacement } from "./useBrowserViewPlacement";

function runCommand(command: BrowserPanelCommand): void {
  readNativeApi()
    ?.browser.command(command)
    .catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Browser action failed",
        description: error instanceof Error ? error.message : String(error),
      });
    });
}

// The thread's browser view in the right sidebar. Desktop app only: the pages are native views the
// desktop places over the content box. Mounted only while shown, so each showing starts a blank
// tab when the thread has none.
export function BrowserPanel(props: { threadId: ThreadId; tabs: readonly BrowserTab[] | null }) {
  const { threadId, tabs } = props;
  const activeTab = tabs?.find((tab) => tab.active) ?? null;
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null);
  const frozenFrame = useBrowserViewPlacement(threadId, activeTab?.tabId ?? null, contentElement);
  // Only the first tab list after opening decides; closing the last tab later leaves it empty.
  const checkedFirstList = useRef(false);
  useEffect(() => {
    if (tabs === null || checkedFirstList.current) return;
    checkedFirstList.current = true;
    if (tabs.length === 0) runCommand({ threadId, action: "open" });
  }, [tabs, threadId]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <BrowserTabStrip
        tabs={tabs ?? []}
        onSelect={(tabId) => runCommand({ threadId, action: "select", tabId })}
        onClose={(tabId) => runCommand({ threadId, action: "close", tabId })}
        onNewTab={() => runCommand({ threadId, action: "open" })}
      >
        <BrowserPickElement threadId={threadId} tabId={activeTab?.tabId ?? null} />
        <BrowserCaptureButton threadId={threadId} tabId={activeTab?.tabId ?? null} />
      </BrowserTabStrip>
      <BrowserAddressBar
        tab={activeTab}
        onOpen={(url) =>
          runCommand(
            activeTab
              ? { threadId, action: "navigate", tabId: activeTab.tabId, url }
              : { threadId, action: "open", url },
          )
        }
        onHistory={(history) => {
          if (activeTab)
            runCommand({ threadId, action: "navigate", tabId: activeTab.tabId, history });
        }}
      >
        <BrowserSiteMenu
          threadId={threadId}
          tab={activeTab}
          onSiteBlocking={(enabled) => {
            if (activeTab)
              runCommand({ threadId, action: "contentBlocker", tabId: activeTab.tabId, enabled });
          }}
        />
        <BrowserMoreMenu threadId={threadId} tab={activeTab} />
      </BrowserAddressBar>
      <BrowserAgentActivity threadId={threadId} />
      <BrowserPageDialog
        dialog={activeTab?.dialog ?? null}
        onAnswer={(accept) => {
          if (activeTab) runCommand({ threadId, action: "dialog", tabId: activeTab.tabId, accept });
        }}
      />
      {/* The active tab's native view is placed over this box. */}
      <div ref={setContentElement} className="relative min-h-0 flex-1">
        {frozenFrame ? (
          <img
            src={frozenFrame}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full object-fill select-none"
          />
        ) : null}
        {tabs === null ? (
          <PanelStateMessage loadingLabel="Loading browser" />
        ) : tabs.length === 0 ? (
          <PanelStateMessage>Enter an address, or ask the agent to open a page.</PanelStateMessage>
        ) : null}
      </div>
    </div>
  );
}
