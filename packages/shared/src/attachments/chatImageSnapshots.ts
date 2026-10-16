export const CHAT_IMAGE_SNAPSHOT_PREFIX = "/attachments/chat-images/";

const IMAGE_EXTENSIONS = "avif|bmp|gif|heic|heif|ico|jpg|png|svg|tiff|webp";
const SNAPSHOT_NAME_PATTERN = new RegExp(`^[a-f0-9]{64}\\.(?:${IMAGE_EXTENSIONS})$`);
const IMAGE_PATH_PATTERN = new RegExp(`\\.(?:${IMAGE_EXTENSIONS}|jpeg)$`, "i");

export function chatImageSnapshotName(url: string): string | null {
  if (!url.startsWith(CHAT_IMAGE_SNAPSHOT_PREFIX)) return null;
  const name = url.slice(CHAT_IMAGE_SNAPSHOT_PREFIX.length);
  return SNAPSHOT_NAME_PATTERN.test(name) ? name : null;
}

export function hasChatImageExtension(filePath: string): boolean {
  return IMAGE_PATH_PATTERN.test(filePath);
}
