const BLOCKED_SCHEMES = new Set([
  "file:",
  "chrome:",
  "chrome-extension:",
  "devtools:",
  "view-source:",
  "javascript:",
]);

// WHATWG URL parsing already folds IPv4 shorthand (127.1, 0x7f.1, 2130706433, 0) into dotted form
// and writes IPv4-mapped IPv6 in hex ([::ffff:7f00:1]), so only that form needs decoding.
function embeddedIpv4(host: string): string {
  const mapped = /^\[::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/u.exec(host);
  if (!mapped) return host;
  const high = Number.parseInt(mapped[1]!, 16);
  const low = Number.parseInt(mapped[2]!, 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

function isLoopbackHost(hostname: string): boolean {
  const host = embeddedIpv4(hostname.toLowerCase().replace(/\.+$/u, ""));
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
