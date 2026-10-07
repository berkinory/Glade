import * as Crypto from "node:crypto";

// Wraps text taken from a web page (PAGE_CONTENT) or a desktop app's windows and accessibility
// tree (APP_CONTENT) so the model can tell that data from Glade's own words. The nonce is fresh
// per block, so the source cannot print a matching end marker and continue outside. A provenance
// cue for the model, not a security boundary.
export function untrustedContent(
  kind: "PAGE_CONTENT" | "APP_CONTENT",
  source: string,
  content: string,
): string {
  const nonce = Crypto.randomBytes(8).toString("hex");
  return [
    `--- ${kind} nonce=${nonce} ${source} ---`,
    content,
    `--- END ${kind} nonce=${nonce} ---`,
  ].join("\n");
}

export const pageOrigin = (url: string | undefined): string =>
  url && URL.canParse(url) ? new URL(url).origin : "unknown";
