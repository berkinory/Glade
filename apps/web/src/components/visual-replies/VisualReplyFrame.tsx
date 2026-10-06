import { useEffect, useRef, useState } from "react";
import {
  visualReplyDocument,
  type VisualReplyTheme,
} from "@glade/shared/attachments/visualReplyDocument";
import { openExternalLink } from "~/lib/linkChips";
import { requireHttpExternalUrl } from "~/lib/externalUrl";

export function VisualReplyFrame({
  html,
  title,
  onContentHeight,
}: {
  readonly html: string;
  readonly title: string;
  readonly onContentHeight?: ((height: number) => void) | undefined;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const [theme, setTheme] = useState<VisualReplyTheme | null>(null);
  const [navigated, setNavigated] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const loads = useRef(0);
  const [initialDocument, setInitialDocument] = useState<string | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const style = getComputedStyle(root);
      const color = (name: string) => style.getPropertyValue(`--${name}`).trim();
      setTheme({
        background: color("background"),
        foreground: color("foreground"),
        muted: color("muted-foreground"),
        accent: color("primary"),
        border: color("border"),
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: style.getPropertyValue("--app-font-size-ui").trim(),
        colorScheme: root.classList.contains("dark") ? "dark" : "light",
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme-variant"],
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
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
        event.data.kind === "height" &&
        typeof event.data.height === "number" &&
        Number.isFinite(event.data.height)
      ) {
        onContentHeight?.(Math.min(2000, Math.max(80, event.data.height)));
      } else if (
        event.data.kind === "open-link" &&
        typeof event.data.url === "string" &&
        document.activeElement === frame.current &&
        navigator.userActivation.isActive
      ) {
        try {
          openExternalLink(requireHttpExternalUrl(event.data.url));
        } catch {
          // A sandbox can send arbitrary messages; only HTTP(S) user clicks leave the frame.
        }
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [channel, onContentHeight]);
  useEffect(() => {
    if (!theme) return;
    if (initialDocument === null) setInitialDocument(visualReplyDocument({ html, channel, theme }));
    frame.current?.contentWindow?.postMessage({ channel, kind: "theme", theme }, "*");
  }, [theme, initialDocument, html, channel]);
  if (initialDocument === null) return null;
  if (navigated)
    return (
      <p className="p-4 text-ui-sm text-muted-foreground">
        This visual tried to navigate away. Close and reopen it to reset.
      </p>
    );
  return (
    <div className="flex h-full flex-col">
      {scriptError && (
        <p role="alert" className="shrink-0 border-b border-border p-3 text-ui-sm text-destructive">
          This visual's interaction failed: {scriptError}
        </p>
      )}
      <iframe
        ref={frame}
        title={title}
        srcDoc={initialDocument}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        style={{ colorScheme: theme?.colorScheme }}
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; bluetooth 'none'; fullscreen 'none'"
        className="block min-h-0 w-full flex-1 border-0 bg-background"
        onLoad={() => {
          loads.current += 1;
          if (loads.current > 1) setNavigated(true);
          else frame.current?.contentWindow?.postMessage({ channel, kind: "theme", theme }, "*");
        }}
      />
    </div>
  );
}
