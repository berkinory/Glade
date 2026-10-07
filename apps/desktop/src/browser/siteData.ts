import type { WebContents } from "electron";
import { BrowserFailure } from "./browserFailure";
import { siteOf } from "./browserSite";

// Signs the user out of the tab's site: its cookies across the whole registrable domain (sign-in
// cookies usually sit on the parent domain), plus storage and cache of the page's origin. Other
// sites keep everything. The tab reloads so the page reflects the cleared state.
export async function clearSiteData(webContents: WebContents): Promise<void> {
  const url = URL.parse(webContents.getURL());
  const site = siteOf(webContents.getURL());
  if (!url || site === null) {
    throw new BrowserFailure("invalid_input", "This page has no site data to clear.");
  }
  const { session } = webContents;
  const cookies = await session.cookies.get({ domain: site });
  await Promise.all(
    cookies.map((cookie) => {
      const host = (cookie.domain ?? site).replace(/^\./u, "");
      return session.cookies.remove(
        `${cookie.secure ? "https" : "http"}://${host}${cookie.path ?? "/"}`,
        cookie.name,
      );
    }),
  );
  await session.clearData({
    dataTypes: [
      "backgroundFetch",
      "cache",
      "fileSystems",
      "indexedDB",
      "localStorage",
      "serviceWorkers",
      "webSQL",
    ],
    origins: [url.origin],
  });
  webContents.reload();
}
