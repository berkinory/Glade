import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";

import { ensurePrivateDirectorySync } from "../platform/filesystem/privatePathPermissions";
import { normalizeOperationError } from "../platform/operationError";
import type { McpToolCallResult } from "./protocol.ts";

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

// Temp roots are already allowed for chat image snapshots, and a reply only needs the file until
// its message freezes a copy, so the OS may reclaim anything a deleted thread leaves behind.
function threadToolImagesDir(threadId: string): string | null {
  return /^[\w-]+$/.test(threadId) ? path.join(tmpdir(), "glade-tool-images", threadId) : null;
}

// Providers decide on their own whether an MCP image reaches disk, so every image the gateway
// returns gets a Glade-owned file the agent can embed in its reply.
export function saveToolResultImages(threadId: string, result: McpToolCallResult) {
  const directory = threadToolImagesDir(threadId);
  const images = result.content.flatMap((item) =>
    item.type === "image" && EXTENSION_BY_MIME_TYPE[item.mimeType] ? [item] : [],
  );
  if (!directory || images.length === 0) return Effect.succeed(result);
  return Effect.tryPromise({
    try: async () => {
      ensurePrivateDirectorySync(directory);
      const paths: string[] = [];
      for (const image of images) {
        const bytes = Buffer.from(image.data, "base64");
        const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}${EXTENSION_BY_MIME_TYPE[image.mimeType]}`;
        const filePath = path.join(directory, name);
        await fs.writeFile(filePath, bytes, { mode: 0o600 });
        paths.push(filePath);
      }
      return paths;
    },
    catch: normalizeOperationError,
  }).pipe(
    Effect.map(
      (paths): McpToolCallResult => ({
        ...result,
        content: [
          ...result.content,
          {
            type: "text",
            text: paths.map((filePath) => `Image saved to ${filePath}`).join("\n"),
          },
        ],
      }),
    ),
    Effect.catch((error) =>
      Effect.logWarning("could not save tool result image", { error }).pipe(Effect.as(result)),
    ),
  );
}

export function removeThreadToolImages(threadId: string) {
  const directory = threadToolImagesDir(threadId);
  if (!directory) return Effect.void;
  return Effect.tryPromise({
    try: () => fs.rm(directory, { recursive: true, force: true }),
    catch: normalizeOperationError,
  }).pipe(
    Effect.catch((error) =>
      Effect.logDebug("thread deletion cleanup skipped tool image removal", { threadId, error }),
    ),
  );
}
