import { type CSSProperties, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { openExternalLink } from "~/lib/linkChips";
import { requireHttpExternalUrl } from "~/lib/externalUrl";
import { cn } from "~/lib/utils";

export type SandboxedHtmlMessage = { readonly kind: unknown } & Readonly<Record<string, unknown>>;

// Expects a document that starts with `sandboxedHtmlHead(channel)`.
export function SandboxedHtmlFrame({
  document: srcDoc,
  channel,
  title,
  className,
  style,
  onMessage,
  onFrameLoad,
}: {
  readonly document: string;
  readonly channel: string;
  readonly title: string;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
  readonly onMessage?: ((message: SandboxedHtmlMessage) => void) | undefined;
  readonly onFrameLoad?: ((frameWindow: Window) => void) | undefined;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loadedWindow = useRef<Window | null>(null);
  const [navigated, setNavigated] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const forwardMessage = useEffectEvent((message: SandboxedHtmlMessage) => onMessage?.(message));
  // A fast page can post before passive effects run.
  useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        !event.data ||
        typeof event.data !== "object" ||
        event.data.channel !== channel
      )
        return;
      if (event.data.kind === "script-error" && typeof event.data.message === "string") {
        setScriptError(event.data.message.slice(0, 500));
      } else if (
        event.data.kind === "open-link" &&
        typeof event.data.url === "string" &&
        window.document.activeElement === frame.current &&
        navigator.userActivation.isActive
      ) {
        try {
          openExternalLink(requireHttpExternalUrl(event.data.url));
        } catch {
          // A sandbox can send arbitrary messages; only HTTP(S) user clicks leave the frame.
        }
      } else {
        forwardMessage(event.data as SandboxedHtmlMessage);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [channel]);
  if (navigated)
    return (
      <p className="p-4 text-ui-sm text-muted-foreground">
        This view tried to navigate away. Close and reopen it to reset.
      </p>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {scriptError && (
        <p role="alert" className="shrink-0 border-b border-border p-3 text-ui-sm text-destructive">
          A script in this view failed: {scriptError}
        </p>
      )}
      <iframe
        ref={frame}
        title={title}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        style={style}
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; bluetooth 'none'; fullscreen 'none'"
        className={cn("block min-h-0 w-full flex-1 border-0", className)}
        onLoad={() => {
          // A timeline reflow can move the iframe, which gives it a new browsing context that
          // reloads the same document. Only a second load in the same context is a navigation.
          const contentWindow = frame.current?.contentWindow ?? null;
          if (contentWindow && contentWindow === loadedWindow.current) {
            setNavigated(true);
            return;
          }
          loadedWindow.current = contentWindow;
          if (contentWindow) onFrameLoad?.(contentWindow);
        }}
      />
    </div>
  );
}
