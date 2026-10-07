import type { BrowserPickedElement } from "@glade/contracts/browser/browserView";

export interface BrowserElementReference {
  readonly tabId: string;
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly url: string;
}

const MAX_NAME_CHARS = 80;
const JSON_STRING = String.raw`"(?:[^"\\]|\\.)*"`;
// The agent reads this text as is; the ref works with browser_* tools on the same tab until the
// page navigates.
const TOKEN_SOURCE = String.raw`\[browser element tab=(t[1-9]\d*) ref=(e[1-9]\d*) role=(${JSON_STRING}) name=(${JSON_STRING}) url=(\S+)\](?=\s|$)`;

export function formatBrowserElementReference(element: BrowserPickedElement): string {
  const name =
    element.name.length > MAX_NAME_CHARS
      ? `${element.name.slice(0, MAX_NAME_CHARS - 1)}…`
      : element.name;
  return `[browser element tab=${element.tabId} ref=${element.ref} role=${JSON.stringify(element.role)} name=${JSON.stringify(name)} url=${element.url || "about:blank"}]`;
}

export function matchBrowserElementReferences(
  text: string,
): Array<{ reference: BrowserElementReference; start: number; end: number }> {
  if (!text.includes("[browser element ")) return [];
  return Array.from(text.matchAll(new RegExp(TOKEN_SOURCE, "g")), (match) => {
    const start = match.index ?? 0;
    return {
      reference: {
        tabId: match[1]!,
        ref: match[2]!,
        role: JSON.parse(match[3]!) as string,
        name: JSON.parse(match[4]!) as string,
        url: match[5]!,
      },
      start,
      end: start + match[0].length,
    };
  });
}

export function describeBrowserElementReference(reference: BrowserElementReference): string {
  return reference.name ? `${reference.role} "${reference.name}"` : reference.role;
}
