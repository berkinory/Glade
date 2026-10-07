import * as Crypto from "node:crypto";

// Wraps text taken from a web page so the model can tell page data from Glade's own words. The
// nonce is fresh per block, so a page cannot print a matching end marker and continue outside.
// A provenance cue for the model, not a security boundary.
export function untrustedPageContent(url: string | undefined, content: string): string {
  const nonce = Crypto.randomBytes(8).toString("hex");
  let origin = "unknown";
  try {
    if (url) origin = new URL(url).origin;
  } catch {
    origin = "unknown";
  }
  return [
    `--- PAGE_CONTENT nonce=${nonce} origin=${origin} ---`,
    content,
    `--- END PAGE_CONTENT nonce=${nonce} ---`,
  ].join("\n");
}
