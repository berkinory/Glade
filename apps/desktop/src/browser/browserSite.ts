import { Request } from "@ghostery/adblocker-electron";

// The registrable domain (eTLD+1) of an http(s) page, parsed by the content blocker engine's own
// Request so blocker exceptions and site data agree on what a site is.
export function siteOf(url: string): string | null {
  if (!/^https?:/iu.test(url)) return null;
  return Request.fromRawDetails({ url }).domain || null;
}
