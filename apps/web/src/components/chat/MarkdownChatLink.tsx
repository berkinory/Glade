import { BubbleChatIcon, Link01Icon } from "~/lib/icons";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ReactNode } from "react";
import { useStore } from "~/store";
import { showContextMenu } from "~/components/contextMenu/contextMenuStore";
import { copyTextToClipboard } from "~/lib/clipboard";
import { toastManager } from "../ui/toast";

// A fragment avoids conflating local file paths or the desktop origin with native deep links.
export function markdownChatLinkId(href: string): ThreadId | null {
  try {
    const id = decodeURIComponent(href.slice("#chat=".length));
    return /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? ThreadId.makeUnsafe(id) : null;
  } catch {
    return null;
  }
}

export function MarkdownChatLink({
  href,
  threadId,
  children,
}: {
  href: string;
  threadId: ThreadId | null;
  children: ReactNode;
}) {
  const openChat = () => {
    if (!threadId || !useStore.getState().threadShellById?.[threadId]) {
      toastManager.add({
        type: "error",
        title: "Chat unavailable",
        description: threadId
          ? "This chat was deleted or is not accessible in this workspace."
          : "This chat link contains an invalid ID.",
      });
      return;
    }
    void import("~/appNavigation")
      .then(({ appHistory }) => appHistory.push(`/${encodeURIComponent(threadId)}`))
      .catch(() => toastManager.add({ type: "error", title: "Could not open chat" }));
  };
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        openChat();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          openChat();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void showContextMenu(
          [
            { id: "open", label: "Open chat", icon: BubbleChatIcon },
            { id: "copy", label: "Copy chat link", icon: Link01Icon },
          ],
          { x: event.clientX, y: event.clientY },
        )
          .then(async (action) => {
            if (action === "open") openChat();
            if (action === "copy") await copyTextToClipboard(href);
          })
          .catch(() => toastManager.add({ type: "error", title: "Could not copy chat link" }));
      }}
    >
      {children}
    </a>
  );
}
