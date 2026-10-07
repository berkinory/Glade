import type { BrowserPickedElement } from "@glade/contracts/browser/browserView";

export interface BrowserElementReference {
  readonly tabId: string;
  readonly ref: string;
  // `button "Save"` or `div.pricing-card`.
  readonly label: string;
  readonly url: string;
  // The block's lines below its first, for the chip's tooltip.
  readonly details: string;
}

const JSON_STRING = String.raw`"(?:[^"\\]|\\.)*"`;
// The block is the prompt text the agent reads. Page strings are JSON-quoted, so they cannot
// contain a line break, and the block is fenced like the gateway's PAGE_CONTENT with a fresh nonce
// a page cannot guess; the ref works with browser_* tools on the same tab until the page navigates.
const BLOCK_SOURCE = String.raw`--- PAGE_CONTENT nonce=([0-9a-f]{16}) picked element[^\n]*\n([^\n]+)\n((?:  [^\n]*\n)*?)--- END PAGE_CONTENT nonce=\1 ---(?=\s|$)`;
const HEADER = new RegExp(String.raw`^(\S+)(?: (${JSON_STRING}))?`, "u");
const PAGE_LINE = new RegExp(
  String.raw`^  page: (${JSON_STRING}) ${JSON_STRING} · ref (e[1-9]\d*) \(tab (t[1-9]\d*)\)$`,
  "mu",
);

const quote = (text: string) => JSON.stringify(text);

function nonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function plural(role: string): string {
  return /(?:s|x)$/u.test(role) ? `${role}es` : `${role}s`;
}

function origin(url: string): string {
  return URL.canParse(url) ? new URL(url).origin : "unknown";
}

export function formatBrowserElementReference(element: BrowserPickedElement): string {
  const { details } = element;
  const url = element.url || "about:blank";
  let header = element.label;
  if (details?.rank) {
    const { index, total } = details.rank;
    header += element.name
      ? ` — ${index} of ${total} ${quote(element.name)} ${plural(element.role)}`
      : ` — ${index} of ${total} with the same text`;
  }
  const lines = [header];
  if (details) {
    if (details.context.length > 0) {
      const hops = details.context.map(({ role, name }) =>
        name ? `${role} ${quote(name)}` : role,
      );
      lines.push(`  in: ${hops.join(" › ")}`);
    }
    if (details.contains) {
      const { texts, more } = details.contains;
      lines.push(`  contains: ${texts.map(quote).join(" ")}${more > 0 ? ` (+${more})` : ""}`);
    }
    if (details.fieldLabel) lines.push(`  label: ${quote(details.fieldLabel)}`);
    if (details.selector) lines.push(`  selector: ${quote(details.selector)}`);
    lines.push(`  style: ${details.style}`);
  }
  lines.push(
    `  page: ${quote(url)} ${quote(element.title)} · ref ${element.ref} (tab ${element.tabId})`,
  );
  const fence = nonce();
  return [
    `--- PAGE_CONTENT nonce=${fence} picked element origin=${origin(url)} ---`,
    ...lines,
    `--- END PAGE_CONTENT nonce=${fence} ---`,
  ].join("\n");
}

export function matchBrowserElementReferences(
  text: string,
): Array<{ reference: BrowserElementReference; start: number; end: number }> {
  if (!text.includes("--- PAGE_CONTENT nonce=")) return [];
  return Array.from(text.matchAll(new RegExp(BLOCK_SOURCE, "gu")), (match) => {
    const start = match.index ?? 0;
    const body = match[3]!;
    const header = HEADER.exec(match[2]!);
    const page = PAGE_LINE.exec(body);
    if (!header || !page) return null;
    const name = header[2] ? (JSON.parse(header[2]) as string) : "";
    return {
      reference: {
        tabId: page[3]!,
        ref: page[2]!,
        label: name ? `${header[1]} "${name}"` : header[1]!,
        url: JSON.parse(page[1]!) as string,
        details: `${match[2]}\n${body.replace(/^ {2}/gmu, "").trimEnd()}`,
      },
      start,
      end: start + match[0].length,
    };
  }).filter((entry) => entry !== null);
}
