const SANDBOXED_HTML_CSP = [
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

export function embedSandboxSettings(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/**
 * Head markup every untrusted document in a sandboxed Glade frame starts with: the security
 * policy, then a bootstrap that reports script errors and turns link clicks into host requests.
 * It must precede all untrusted tokens so the policy covers them.
 */
export function sandboxedHtmlHead(channel: string): string {
  const bootstrap = `<script>(() => {
    const channel = ${embedSandboxSettings(channel)};
    const reportError = message => parent.postMessage({ channel, kind: 'script-error', message: String(message).slice(0, 500) }, '*');
    addEventListener('error', event => { if (event.message) reportError(event.message); });
    addEventListener('unhandledrejection', event => reportError(event.reason?.message ?? 'An interaction failed.'));
    addEventListener('click', event => {
      const link = event.composedPath().find(node => node instanceof HTMLAnchorElement);
      if (!link) return;
      if (link.getAttribute('href')?.startsWith('#')) return;
      event.preventDefault();
      if (event.isTrusted && navigator.userActivation.isActive && /^https?:/.test(link.href)) {
        parent.postMessage({ channel, kind: 'open-link', url: link.href }, '*');
      }
    }, true);
  })();</script>`;
  return `<meta http-equiv="Content-Security-Policy" content="${SANDBOXED_HTML_CSP}"><meta name="referrer" content="no-referrer">${bootstrap}`;
}
