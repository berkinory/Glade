export const CHAT_IMAGE_SNAPSHOT_PREFIX = "/attachments/chat-images/";

export function chatImageSnapshotName(url: string): string | null {
  if (!url.startsWith(CHAT_IMAGE_SNAPSHOT_PREFIX)) return null;
  const name = url.slice(CHAT_IMAGE_SNAPSHOT_PREFIX.length);
  return /^[a-f0-9]{64}\.(?:avif|bmp|gif|heic|heif|ico|jpg|png|svg|tiff|webp)$/.test(name)
    ? name
    : null;
}
