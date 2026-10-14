import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Data, Effect } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  CHAT_IMAGE_SNAPSHOT_PREFIX,
  chatImageSnapshotName,
} from "@glade/shared/attachments/chatImageSnapshots";
import { resolveAllowedLocalPreviewFile } from "../localImageFiles";
import { ensurePrivateDirectorySync } from "../../platform/filesystem/privatePathPermissions";
import { syncDirectoryEntry } from "../../platform/filesystemPlatform";
import { normalizeOperationError } from "../../platform/operationError";

export class ChatImageSnapshotError extends Data.TaggedError("ChatImageSnapshotError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024 * 1024;

export function preserveChatImage(input: {
  readonly source: string;
  readonly cwd: string | null;
  readonly attachmentsDir: string;
  readonly sql: SqlClient.SqlClient;
}) {
  return Effect.gen(function* () {
    if (chatImageSnapshotName(input.source)) return input.source;
    const bytes = yield* Effect.tryPromise({
      try: async () => {
        const file = await resolveAllowedLocalPreviewFile({
          requestedPath: input.source,
          cwd: input.cwd,
        });
        if (!file || file.sizeBytes === 0 || file.sizeBytes > MAX_IMAGE_BYTES)
          throw new Error("Image is unavailable or exceeds the 32 MiB snapshot limit.");
        const handle = await fs.open(file.path, "r");
        try {
          const buffer = Buffer.alloc(file.sizeBytes + 1);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          if (bytesRead !== file.sizeBytes) throw new Error("Image changed while preserving it.");
          return buffer.subarray(0, bytesRead);
        } finally {
          await handle.close();
        }
      },
      catch: normalizeOperationError,
    });
    const extension = path
      .extname(input.source)
      .toLowerCase()
      .replace(/^\.jpeg$/, ".jpg");
    const name = `${createHash("sha256").update(bytes).digest("hex")}${extension}`;
    const url = `${CHAT_IMAGE_SNAPSHOT_PREFIX}${name}`;
    if (!chatImageSnapshotName(url))
      return yield* Effect.fail(
        new ChatImageSnapshotError({ message: "Unsupported image format." }),
      );
    const sql = input.sql;
    // Renew the lease before touching the file, so cleanup cannot unlink a concurrent publication.
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const existing = yield* sql`SELECT name FROM chat_image_snapshots WHERE name = ${name}`;
        if (existing.length === 0) {
          const [usage] = yield* sql<{
            bytes: number;
            count: number;
          }>`SELECT COALESCE(SUM(size_bytes), 0) AS bytes, COUNT(*) AS count FROM chat_image_snapshots`;
          if (usage!.bytes + bytes.length > MAX_SNAPSHOT_BYTES || usage!.count >= 20_000)
            return yield* Effect.fail(
              new ChatImageSnapshotError({ message: "Chat image storage quota exceeded." }),
            );
        }
        yield* sql`INSERT INTO chat_image_snapshots (name, size_bytes, touched_at)
        VALUES (${name}, ${bytes.length}, ${new Date().toISOString()})
        ON CONFLICT(name) DO UPDATE SET touched_at = excluded.touched_at`;
      }),
    );
    yield* Effect.tryPromise({
      try: async () => {
        const directory = path.join(input.attachmentsDir, "chat-images");
        ensurePrivateDirectorySync(directory);
        const destination = path.join(directory, name);
        const existing = await fs.stat(destination).catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (existing?.size === bytes.length) return;
        const temporary = path.join(directory, `.${randomUUID()}.part`);
        try {
          const handle = await fs.open(temporary, "wx", 0o600);
          try {
            await handle.writeFile(bytes);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await fs.rename(temporary, destination);
          await syncDirectoryEntry(directory);
          await syncDirectoryEntry(input.attachmentsDir);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      },
      catch: normalizeOperationError,
    });
    return url;
  });
}
