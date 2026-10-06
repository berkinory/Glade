export const VISUAL_REPLY_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "connect-src 'none'",
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
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly colorScheme: "light" | "dark";
}

export const DEFAULT_VISUAL_REPLY_THEME: VisualReplyTheme = {
  background: "#ffffff",
  foreground: "#18181b",
  muted: "#71717a",
  accent: "#6366f1",
  border: "#e4e4e7",
  fontFamily: "system-ui, sans-serif",
  fontSize: "14px",
  colorScheme: "light",
};

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
      for (const name of ['background', 'foreground', 'muted', 'accent', 'border', 'fontFamily', 'fontSize']) {
        root.style.setProperty('--glade-' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), String(theme[name]));
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
      event.preventDefault();

    }, true);
  })();</script>`;
  const cssValue = (value: string) => value.replace(/[<>{};]/gu, "");
  const themeCss = Object.entries(input.theme)
    .filter(([name]) => name !== "colorScheme")
    .map(
      ([name, value]) =>
        `--glade-${name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}:${cssValue(value)}`,
    )
    .join(";");
  const head = `<meta http-equiv="Content-Security-Policy" content="${VISUAL_REPLY_CSP}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{${themeCss};color-scheme:${input.theme.colorScheme}}html{color:var(--glade-foreground);background:var(--glade-background);font-family:var(--glade-font-family);font-size:var(--glade-font-size)}body{margin:0;padding:16px;box-sizing:border-box}*,*::before,*::after{box-sizing:border-box}img,svg,canvas{max-width:100%}</style>${bootstrap}`;
  // Place policy before all untrusted tokens. A string replacement could hit a comment or
  // miss an attributed head, leaving the document without its security policy.
  return `<!doctype html><html><head>${head}</head><body>${input.html}</body></html>`;
}
