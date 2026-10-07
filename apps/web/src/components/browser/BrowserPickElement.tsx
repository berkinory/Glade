import type { BrowserPickedElement } from "@glade/contracts/browser/browserView";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useEffect, useState } from "react";
import { useComposerDraftStore } from "~/composerDraftStore";
import { formatBrowserElementReference } from "~/lib/browserElementReference";
import { appendComposerPromptText } from "~/lib/chatReferences";
import { prepareComposerImageAttachmentsFromFiles } from "~/lib/composerSend";
import { CursorInWindowIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME } from "../chat/chatHeaderControls";
import { IconButton } from "../ui/icon-button";
import { toastManager } from "../ui/toast";

// The reference goes into the prompt as text the agent can act on; the element screenshot rides
// along as an ordinary image attachment.
async function addToComposer(threadId: ThreadId, element: BrowserPickedElement): Promise<void> {
  appendComposerPromptText(threadId, formatBrowserElementReference(element));
  if (!element.screenshot) return;
  const bytes = Uint8Array.from(atob(element.screenshot.data), (char) => char.charCodeAt(0));
  const file = new File([bytes], `element-${element.ref}.jpg`, { type: "image/jpeg" });
  const { images, error } = await prepareComposerImageAttachmentsFromFiles({
    files: [file],
    existingAttachmentCount: 0,
  });
  const added = useComposerDraftStore.getState().addImages(threadId, images);
  if (error || added < images.length) {
    toastManager.add({
      type: "warning",
      title: "Element added without its screenshot",
      description: error ?? "This message already has the most attachments it can carry.",
    });
  }
}

export function BrowserPickElement(props: { threadId: ThreadId; tabId: string | null }) {
  const [picking, setPicking] = useState(false);
  const { threadId, tabId } = props;
  const bridge = window.desktopBridge?.browser;

  useEffect(() => {
    if (!picking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") bridge?.cancelPick(threadId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      bridge?.cancelPick(threadId);
    };
  }, [picking, bridge, threadId]);

  const start = () => {
    if (!bridge || !tabId) return;
    setPicking(true);
    bridge
      .pickElement({ threadId, tabId })
      .then((element) => (element ? addToComposer(threadId, element) : undefined))
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not pick the element",
          description: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => setPicking(false));
  };

  return (
    <IconButton
      label={picking ? "Stop picking" : "Pick an element"}
      tooltip={picking ? "Stop picking (Esc)" : "Pick an element to reference in chat"}
      tooltipSide="bottom"
      aria-pressed={picking}
      disabled={!tabId}
      className={cn(picking && CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME)}
      onClick={() => (picking ? bridge?.cancelPick(threadId) : start())}
    >
      <CursorInWindowIcon className="size-3.5" />
    </IconButton>
  );
}
