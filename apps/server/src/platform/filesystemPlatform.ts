import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";

const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set(["EINVAL", "ENOTSUP", "EBADF"]);

export function supportsPosixPermissions(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32";
}

export async function syncDirectoryEntry(
  directoryPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (!supportsPosixPermissions(platform)) return;

  const handle = await fs.open(
    directoryPath,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  try {
    await handle.sync().catch((cause) => {
      const code = (cause as NodeJS.ErrnoException).code;
      if (!code || !UNSUPPORTED_DIRECTORY_SYNC_CODES.has(code)) throw cause;
    });
  } finally {
    await handle.close();
  }
}
