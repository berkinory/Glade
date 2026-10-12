import type * as Ghostery from "@ghostery/adblocker-electron";
import { createRequire } from "node:module";

const requireOnFirstUse = createRequire(__filename);

// Ghostery loads with the first browser tab rather than with the app, where it delayed the server.
export const blockerEngine = (): typeof Ghostery =>
  requireOnFirstUse("@ghostery/adblocker-electron");

// The registrable domain (eTLD+1) of an http(s) page, parsed by the content blocker engine's own
// Request so blocker exceptions and site data agree on what a site is.
export function siteOf(url: string): string | null {
  if (!/^https?:/iu.test(url)) return null;
  return blockerEngine().Request.fromRawDetails({ url }).domain || null;
}
