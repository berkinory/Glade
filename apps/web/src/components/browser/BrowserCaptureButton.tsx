import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useState } from "react";
import { CameraIcon } from "~/lib/icons";
import { IconButton } from "../ui/icon-button";
import { toastManager } from "../ui/toast";
import { addBrowserImageToComposer } from "./browserComposerImage";

// Attaches what the active tab shows to the composer.
export function BrowserCaptureButton(props: { threadId: ThreadId; tabId: string | null }) {
  const [capturing, setCapturing] = useState(false);
  const { threadId, tabId } = props;
  const bridge = window.desktopBridge?.browser;

  const capture = () => {
    if (!bridge || !tabId) return;
    setCapturing(true);
    bridge
      .capture({ threadId, tabId })
      .then(({ data }) =>
        addBrowserImageToComposer(threadId, {
          data,
          fileName: `page-${tabId}.jpg`,
          warning: "Screenshot not added",
        }),
      )
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not capture the page",
          description: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => setCapturing(false));
  };

  return (
    <IconButton
      label="Add a screenshot to chat"
      tooltip="Add a screenshot of the page to chat"
      tooltipSide="bottom"
      disabled={!tabId || capturing}
      onClick={capture}
    >
      <CameraIcon className="size-3.5" />
    </IconButton>
  );
}
