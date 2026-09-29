import type { WebContents } from "electron";
import { GLADE_DESKTOP_SCHEME } from "@glade/shared/desktopIdentity";

export function isClipboardWritePermission(
  requester: Pick<WebContents, "isDestroyed" | "getURL"> | null,
  permission: string,
  details: { isMainFrame?: boolean; requestingUrl?: string; embeddingOrigin?: string },
  requestingOrigin?: string,
): boolean {
  if (
    permission !== "clipboard-sanitized-write" ||
    !requester ||
    requester.isDestroyed() ||
    details.isMainFrame === false
  )
    return false;
  try {
    const page = new URL(requester.getURL());
    const trustedScheme = page.protocol === `${GLADE_DESKTOP_SCHEME}:`;
    if (
      page.protocol !== "https:" &&
      !trustedScheme &&
      !(page.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(page.hostname))
    )
      return false;
    return [requestingOrigin, details.requestingUrl, details.embeddingOrigin].every(
      (origin) => !origin || new URL(origin).origin === page.origin,
    );
  } catch {
    return false;
  }
}
