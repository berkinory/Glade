import { useEffect, useRef, useState } from "react";
import {
  visualReplyDocument,
  visualReplyThemeForAppearance,
  type VisualReplyTheme,
} from "@glade/shared/attachments/visualReplyDocument";
import { SandboxedHtmlFrame, type SandboxedHtmlMessage } from "../SandboxedHtmlFrame";

export function VisualReplyFrame({
  html,
  title,
  onContentHeight,
  onScrollGesture,
}: {
  readonly html: string;
  readonly title: string;
  readonly onContentHeight?: ((height: number) => void) | undefined;
  readonly onScrollGesture?: ((upward: boolean) => void) | undefined;
}) {
  const frameWindow = useRef<Window | null>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const [theme, setTheme] = useState<VisualReplyTheme | null>(null);
  const [initialDocument, setInitialDocument] = useState<string | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const style = getComputedStyle(root);
      const color = (name: string) => style.getPropertyValue(`--${name}`).trim();
      setTheme({
        ...visualReplyThemeForAppearance(root.classList.contains("dark") ? "dark" : "light"),
        background: "transparent",
        foreground: color("foreground"),
        muted: color("muted-foreground"),
        accent: color("color-text-accent"),
        chart1: color("color-text-accent"),
        border: color("border"),
        surface: color("card"),
        surfaceForeground: color("card-foreground"),
        secondary: color("secondary"),
        secondaryForeground: color("secondary-foreground"),
        input: color("input"),
        ring: color("ring"),
        radius: color("radius"),
        fontMono: color("font-mono-family"),
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
  const receive = (message: SandboxedHtmlMessage) => {
    if (
      message.kind === "height" &&
      typeof message.height === "number" &&
      Number.isFinite(message.height) &&
      message.height >= 0
    ) {
      onContentHeight?.(message.height);
    } else if (message.kind === "scroll-intent" && typeof message.upward === "boolean") {
      onScrollGesture?.(message.upward);
    }
  };
  useEffect(() => {
    if (!theme) return;
    if (initialDocument === null) setInitialDocument(visualReplyDocument({ html, channel, theme }));
    frameWindow.current?.postMessage({ channel, kind: "theme", theme }, "*");
  }, [theme, initialDocument, html, channel]);
  if (initialDocument === null) return null;
  return (
    <SandboxedHtmlFrame
      document={initialDocument}
      channel={channel}
      title={title}
      className="bg-transparent"
      style={{ colorScheme: theme?.colorScheme, borderRadius: theme?.radius }}
      onMessage={receive}
      onFrameLoad={(contentWindow) => {
        frameWindow.current = contentWindow;
        contentWindow.postMessage({ channel, kind: "theme", theme }, "*");
      }}
    />
  );
}
