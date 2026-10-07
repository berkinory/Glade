// What a URL is loaded as: a document in a tab or popup, a document in an iframe, or anything a
// page fetches (scripts, images, XHR, workers).
export type BrowserRequestKind = "page" | "frame" | "resource";

const PAGE_SCHEMES = new Set(["http:", "https:"]);
// Frames also get inline documents; top-level data: navigations are refused by Chromium itself.
const FRAME_SCHEMES = new Set(["http:", "https:", "data:", "blob:", "about:"]);
const BLOCKED_RESOURCE_SCHEMES = new Set([
  "file:",
  "chrome:",
  "chrome-extension:",
  "devtools:",
  "view-source:",
  "javascript:",
]);
// Cloud instance metadata services hand out credentials to whatever can reach them. Most live on
// link-local 169.254.169.254 (blocked as a range); these are the other names and addresses.
const METADATA_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
  "100.100.100.200",
  "192.0.0.192",
  "[fd00:ec2::254]",
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

function canonicalHost(hostname: string): string {
  return embeddedIpv4(hostname.toLowerCase().replace(/\.+$/u, ""));
}

function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    host === "[::]" ||
    host === "0.0.0.0" ||
    /^127\.\d+\.\d+\.\d+$/u.test(host)
  );
}

// 169.254.0.0/16 and fe80::/10.
function isLinkLocalHost(host: string): boolean {
  return /^169\.254\.\d+\.\d+$/u.test(host) || /^\[fe[89ab][0-9a-f]:/u.test(host);
}

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80;
}

// Loopback and private LAN addresses stay reachable so agents can test the user's dev servers.
// Refused: other schemes for documents, link-local and cloud metadata hosts, and Glade's own
// backend and dev UI ports on loopback, because a page there would talk to Glade itself. Host
// names are checked as written; a public name that resolves to a blocked address is not caught.
export function browserUrlBlockReason(
  raw: string,
  gladePorts: ReadonlySet<number>,
  kind: BrowserRequestKind,
): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return kind === "page" ? "That is not a valid URL." : null;
  }
  const schemeAllowed =
    kind === "page"
      ? PAGE_SCHEMES.has(url.protocol) || url.href === "about:blank"
      : kind === "frame"
        ? FRAME_SCHEMES.has(url.protocol)
        : !BLOCKED_RESOURCE_SCHEMES.has(url.protocol);
  if (!schemeAllowed) return `${url.protocol} URLs are blocked in Glade's browser.`;
  const host = canonicalHost(url.hostname);
  if (isLinkLocalHost(host) || METADATA_HOSTS.has(host)) {
    return "Link-local and cloud metadata addresses are blocked in Glade's browser.";
  }
  if (isLoopbackHost(host) && gladePorts.has(effectivePort(url))) {
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
  return `${isLoopbackHost(canonicalHost(hostPart)) ? "http" : "https"}://${trimmed}`;
}
