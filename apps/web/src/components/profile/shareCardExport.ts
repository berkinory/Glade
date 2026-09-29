import { toBlob } from "html-to-image";
import { copyPngBlobToDesktopClipboard } from "~/lib/desktopClipboard";
import { readNativeApi } from "~/nativeApi";

export { downloadBlob } from "~/lib/browserDownload";

const SHARE_BRAND_HANDLE = "Glade";
const SHARE_TWEET_TEXT = `Just checking my ${SHARE_BRAND_HANDLE} dev stats. Absolute masterpiece of an IDE.`;
const SHARE_URL = "https://github.com/berkinory/Glade";

export type ShareTarget = "x" | "linkedin" | "reddit";

export async function renderNodeToPngBlob(
  node: HTMLElement,
  size?: { width: number; height: number },
): Promise<Blob | null> {
  try {
    return await toBlob(node, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#ffffff",
      ...(size ? { width: size.width, height: size.height } : {}),
    });
  } catch {
    return null;
  }
}

export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  if (await copyPngBlobToDesktopClipboard(blob)) {
    return true;
  }

  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      return false;
    }
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    return true;
  } catch {
    return false;
  }
}

export function openExternalUrl(url: string): void {
  const api = readNativeApi();
  if (api?.shell?.openExternal) {
    void api.shell.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function shareIntentUrl(target: ShareTarget): string {
  switch (target) {
    case "x":
      return `https://x.com/intent/tweet?text=${encodeURIComponent(SHARE_TWEET_TEXT)}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SHARE_URL)}`;
    case "reddit":
      return `https://www.reddit.com/submit?url=${encodeURIComponent(
        SHARE_URL,
      )}&title=${encodeURIComponent("My Glade dev stats")}`;
  }
}
