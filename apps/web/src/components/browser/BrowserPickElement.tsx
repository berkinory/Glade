import type { BrowserPickedElement, BrowserPickTheme } from "@glade/contracts/browser/browserView";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useEffect, useState } from "react";
import { formatBrowserElementReference } from "~/lib/browserElementReference";
import { appendComposerPromptText } from "~/lib/chatReferences";
import { CursorInWindowIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME } from "../chat/chatHeaderControls";
import { IconButton } from "../ui/icon-button";
import { ShortcutKbd } from "../ui/kbd";
import { toastManager } from "../ui/toast";
import { addBrowserImageToComposer } from "./browserComposerImage";

// The reference goes into the prompt as text the agent can act on; the element screenshot rides
// along as an ordinary image attachment.
async function addToComposer(threadId: ThreadId, element: BrowserPickedElement): Promise<void> {
  appendComposerPromptText(threadId, formatBrowserElementReference(element));
  if (!element.screenshot) return;
  await addBrowserImageToComposer(threadId, {
    data: element.screenshot.data,
    fileName: `element-${element.ref}.jpg`,
    warning: "Element added without its screenshot",
  });
}

// The overlay is drawn inside the page, so it gets Glade's resolved colors rather than variables.
function readPickTheme(): BrowserPickTheme {
  const probe = document.createElement("span");
  document.body.append(probe);
  const color = (token: string) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  const theme = {
    accent: color("--info"),
    surface: color("--popover"),
    foreground: color("--popover-foreground"),
    border: color("--border"),
    fontFamily: getComputedStyle(document.body).fontFamily,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
  probe.remove();
  return theme;
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
      .pickElement({ threadId, tabId, theme: readPickTheme() })
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
      tooltip={
        picking ? (
          <span className="inline-flex items-center gap-2">
            Stop picking
            <ShortcutKbd shortcutLabel="Esc" />
          </span>
        ) : (
          "Pick an element to reference in chat"
        )
      }
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
