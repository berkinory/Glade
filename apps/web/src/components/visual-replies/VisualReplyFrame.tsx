import { useEffect, useRef, useState } from "react";
import {
  visualReplyDocument,
  type VisualReplyTheme,
} from "@glade/shared/attachments/visualReplyDocument";

export function VisualReplyFrame({
  html,
  title,
}: {
  readonly html: string;
  readonly title: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const [theme, setTheme] = useState<VisualReplyTheme | null>(null);
  const [navigated, setNavigated] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const loads = useRef({ document: "", count: 0 });
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
        event.data.channel !== channel ||
        event.data.kind !== "script-error" ||
        typeof event.data.message !== "string"
      )
        return;
      setScriptError(event.data.message.slice(0, 500));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [channel]);
  // Rebuild srcdoc on a theme change. A fresh opaque frame never inherits Glade credentials.
  if (!theme) return null;
  const srcDoc = visualReplyDocument({ html, channel, theme });
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
        key={srcDoc}
        ref={frame}
        title={title}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; bluetooth 'none'; fullscreen 'none'"
        className="block min-h-0 w-full flex-1 border-0 bg-background"
        onLoad={() => {
          const count = loads.current.document === srcDoc ? loads.current.count + 1 : 1;
          loads.current = { document: srcDoc, count };
          if (count > 1) setNavigated(true);
        }}
      />
    </div>
  );
}
