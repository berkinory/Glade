import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { BrowserPanelCommand } from "@glade/contracts/transport/ws/browserRpc";
import { useState } from "react";
import { isElectron } from "~/env";
import { useDesktopTopBarWindowControlsGutterClassName } from "~/hooks/useDesktopTopBarGutter";
import { disclosureWidthClassName } from "~/lib/disclosureMotion";
import { XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { CHAT_SURFACE_HEADER_ROW_CLASS_NAME } from "../chat/chatHeaderControls";
import { PanelStateMessage } from "../chat/PanelStateMessage";
import { PanelWidthResizeHandle, usePanelWidthResize } from "../chat/usePanelWidthResize";
import { IconButton } from "../ui/icon-button";
import { toastManager } from "../ui/toast";
import { BrowserAddressBar } from "./BrowserAddressBar";
import { BrowserAgentActivity } from "./BrowserAgentActivity";
import { BrowserCaptureButton } from "./BrowserCaptureButton";
import { BrowserMoreMenu } from "./BrowserMoreMenu";
import { BrowserPageDialog } from "./BrowserPageDialog";
import { BrowserPickElement } from "./BrowserPickElement";
import { BrowserSiteMenu } from "./BrowserSiteMenu";
import { useBrowserPanelStore } from "./browserPanelStore";
import { BrowserTabStrip } from "./BrowserTabStrip";
import { useBrowserTabs } from "./useBrowserTabs";
import { useBrowserViewPlacement } from "./useBrowserViewPlacement";

const DEFAULT_WIDTH_PX = 40 * 16;
const MIN_WIDTH_PX = 22 * 16;
const CHAT_MIN_WIDTH_PX = 20 * 16;

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

function BrowserPanelContent(props: { threadId: ThreadId; onClose: () => void }) {
  const { threadId } = props;
  const tabs = useBrowserTabs(threadId);
  const activeTab = tabs?.find((tab) => tab.active) ?? null;
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null);
  const gutterClassName = useDesktopTopBarWindowControlsGutterClassName();
  useBrowserViewPlacement(threadId, activeTab?.tabId ?? null, contentElement);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div
        className={cn(
          CHAT_SURFACE_HEADER_ROW_CLASS_NAME,
          "drag-region gap-1 pl-2 pr-2",
          gutterClassName,
        )}
      >
        <BrowserTabStrip
          tabs={tabs ?? []}
          onSelect={(tabId) => runCommand({ threadId, action: "select", tabId })}
          onClose={(tabId) => runCommand({ threadId, action: "close", tabId })}
          onNewTab={() => runCommand({ threadId, action: "open" })}
        />
        <BrowserPickElement threadId={threadId} tabId={activeTab?.tabId ?? null} />
        <BrowserCaptureButton threadId={threadId} tabId={activeTab?.tabId ?? null} />
        <IconButton
          label="Close browser"
          tooltip="Close browser"
          tooltipSide="bottom"
          onClick={props.onClose}
        >
          <XIcon className="size-3.5" />
        </IconButton>
      </div>
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
        {tabs === null ? (
          <PanelStateMessage loadingLabel="Loading browser" />
        ) : tabs.length === 0 ? (
          <PanelStateMessage>Enter an address, or ask the agent to open a page.</PanelStateMessage>
        ) : null}
      </div>
    </div>
  );
}

// The thread's browser, docked to the right of its chat pane. Desktop app only: the pages are
// native views the desktop places over the content box.
export function BrowserPanel(props: { threadId: ThreadId; paneScopeId: string }) {
  const open = useBrowserPanelStore((store) => store.openByThreadId[props.threadId] === true);
  const setOpen = useBrowserPanelStore((store) => store.setOpen);
  const { wrapperRef, width, startResize } = usePanelWidthResize({
    storageKey: "browser_panel_width",
    defaultWidth: DEFAULT_WIDTH_PX,
    minWidth: MIN_WIDTH_PX,
    chatMinWidth: CHAT_MIN_WIDTH_PX,
    paneScopeId: props.paneScopeId,
  });
  if (!isElectron) return null;

  return (
    <div
      ref={wrapperRef}
      className={disclosureWidthClassName(
        open,
        "border-l border-[var(--app-surface-divider)]",
        "relative flex h-full min-h-0 flex-none bg-[var(--app-content-surface,var(--card))] text-foreground",
      )}
      style={open ? { width, maxWidth: `calc(100% - ${CHAT_MIN_WIDTH_PX}px)` } : undefined}
      aria-hidden={open ? undefined : true}
      inert={!open}
    >
      {open ? (
        <>
          <PanelWidthResizeHandle onPointerDown={startResize} />
          <BrowserPanelContent
            key={props.threadId}
            threadId={props.threadId}
            onClose={() => setOpen(props.threadId, false)}
          />
        </>
      ) : null}
    </div>
  );
}
