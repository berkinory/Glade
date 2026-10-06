export const VISUAL_REPLY_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https: http:",
  "style-src 'unsafe-inline' https: http:",
  "img-src data: https: http:",
  "font-src data: https: http:",
  "media-src data: https: http:",
  "connect-src https: http: wss: ws:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export interface VisualReplyTheme {
  readonly background: string;
  readonly foreground: string;
  readonly muted: string;
  readonly accent: string;
  readonly border: string;
  readonly surface: string;
  readonly surfaceForeground: string;
  readonly secondary: string;
  readonly secondaryForeground: string;
  readonly input: string;
  readonly ring: string;
  readonly radius: string;
  readonly fontMono: string;
  readonly chart1: string;
  readonly chart2: string;
  readonly chart3: string;
  readonly chart4: string;
  readonly chart5: string;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly colorScheme: "light" | "dark";
}

export const DEFAULT_VISUAL_REPLY_THEME: VisualReplyTheme = {
  background: "transparent",
  foreground: "#18181b",
  muted: "#71717a",
  accent: "#6366f1",
  border: "#e4e4e7",
  surface: "#f4f4f5",
  surfaceForeground: "#18181b",
  secondary: "#f4f4f5",
  secondaryForeground: "#18181b",
  input: "#e4e4e7",
  ring: "#6366f1",
  radius: "0.625rem",
  fontMono: "ui-monospace, monospace",
  chart1: "#6366f1",
  chart2: "#10b981",
  chart3: "#f59e0b",
  chart4: "#ec4899",
  chart5: "#8b5cf6",
  fontFamily: "system-ui, sans-serif",
  fontSize: "14px",
  colorScheme: "light",
};

export function visualReplyThemeForAppearance(
  colorScheme: VisualReplyTheme["colorScheme"],
): VisualReplyTheme {
  if (colorScheme === "light") return DEFAULT_VISUAL_REPLY_THEME;
  return {
    ...DEFAULT_VISUAL_REPLY_THEME,
    foreground: "#f4f4f5",
    muted: "#a1a1aa",
    accent: "#818cf8",
    border: "#3f3f46",
    surface: "#27272a",
    surfaceForeground: "#f4f4f5",
    secondary: "#27272a",
    secondaryForeground: "#f4f4f5",
    input: "#3f3f46",
    ring: "#818cf8",
    chart1: "#818cf8",
    colorScheme,
  };
}

export function visualReplyDocument(input: {
  readonly html: string;
  readonly channel: string;
  readonly theme: VisualReplyTheme;
}): string {
  const settings = JSON.stringify({ channel: input.channel, theme: input.theme }).replaceAll(
    "<",
    "\\u003c",
  );
  const bootstrap = `<script>(() => {
    const settings = ${settings};
    const applyTheme = theme => {
      const root = document.documentElement;
      for (const name of Object.keys(settings.theme)) {
        if (name === 'colorScheme') continue;
        root.style.setProperty('--glade-' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase()).replace(/([a-z])([0-9])/g, '$1-$2'), String(theme[name]));
      }
      root.style.colorScheme = theme.colorScheme;
    };
    applyTheme(settings.theme);
    const reportError = message => parent.postMessage({ channel: settings.channel, kind: 'script-error', message: String(message).slice(0, 500) }, '*');
    addEventListener('error', event => { if (event.message) reportError(event.message); });
    addEventListener('unhandledrejection', event => reportError(event.reason?.message ?? 'An interaction failed.'));
    addEventListener('message', event => {
      if (event.source === parent && event.data?.channel === settings.channel && event.data?.kind === 'theme') applyTheme(event.data.theme);
    });
    addEventListener('click', event => {
      const link = event.composedPath().find(node => node instanceof HTMLAnchorElement);
      if (!link) return;
      if (link.getAttribute('href')?.startsWith('#')) return;
      event.preventDefault();
      if (event.isTrusted && navigator.userActivation.isActive && /^https?:/.test(link.href)) {
        parent.postMessage({ channel: settings.channel, kind: 'open-link', url: link.href }, '*');
      }
    }, true);
    addEventListener('DOMContentLoaded', () => {
      let previous = 0;
      const reportHeight = () => {
        const root = document.documentElement;
        const height = Math.ceil(root.scrollHeight > root.clientHeight ? root.scrollHeight : root.getBoundingClientRect().height);
        if (height !== previous) {
          previous = height;
          parent.postMessage({ channel: settings.channel, kind: 'height', height }, '*');
        }
      };
      const observer = new ResizeObserver(reportHeight);
      observer.observe(document.documentElement);
      observer.observe(document.body);
      addEventListener('load', reportHeight);
      reportHeight();
    });
  })();</script>`;
  const cssValue = (value: string) => value.replace(/[<>{};]/gu, "");
  const themeCss = Object.entries(input.theme)
    .filter(([name]) => name !== "colorScheme")
    .map(
      ([name, value]) =>
        `--glade-${name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/([a-z])([0-9])/g, "$1-$2")}:${cssValue(value)}`,
    )
    .join(";");
  const head = `<meta http-equiv="Content-Security-Policy" content="${VISUAL_REPLY_CSP}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{${themeCss};color-scheme:${input.theme.colorScheme}}html{color:var(--glade-foreground);background:var(--glade-background);font-family:var(--glade-font-family);font-size:var(--glade-font-size);line-height:1.5;-webkit-font-smoothing:antialiased;scrollbar-width:none}html::-webkit-scrollbar{display:none}body{margin:0;padding:0;box-sizing:border-box}*,*::before,*::after{box-sizing:border-box}code,kbd,pre,samp{font-family:var(--glade-font-mono)}img,svg,canvas{max-width:100%}</style>${bootstrap}`;
  // Place policy before all untrusted tokens. A string replacement could hit a comment or
  // miss an attributed head, leaving the document without its security policy.
  return `<!doctype html><html><head>${head}</head><body>${input.html}</body></html>`;
}
