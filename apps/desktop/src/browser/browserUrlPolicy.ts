const BLOCKED_SCHEMES = new Set([
  "file:",
  "chrome:",
  "chrome-extension:",
  "devtools:",
  "view-source:",
  "javascript:",
]);

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    host === "[::]" ||
    host === "0.0.0.0" ||
    /^127\.\d+\.\d+\.\d+$/u.test(host)
  );
}

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80;
}

// Loopback stays reachable so agents can test the user's local dev servers. Only Glade's own
// backend and dev UI ports are refused, because a page there would talk to Glade itself.
export function browserUrlBlockReason(raw: string, gladePorts: ReadonlySet<number>): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (BLOCKED_SCHEMES.has(url.protocol))
    return `${url.protocol} URLs are blocked in Glade's browser.`;
  if (isLoopbackHost(url.hostname) && gladePorts.has(effectivePort(url))) {
    return "Glade's own server is blocked in Glade's browser.";
  }
  return null;
}

export function normalizeNavigationUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed) && !/^[^/:]+:\d+(?:[/?#]|$)/u.test(trimmed)) {
    return trimmed;
  }
  const hostPart = trimmed.split(/[/?#]/u, 1)[0]!.replace(/:\d+$/u, "");
  return `${isLoopbackHost(hostPart) ? "http" : "https"}://${trimmed}`;
}
