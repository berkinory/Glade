import { ChatImageSnapshotError } from "./storage";
import fs from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  CHAT_IMAGE_SNAPSHOT_PREFIX,
  chatImageSnapshotName,
} from "@glade/shared/attachments/chatImageSnapshots";
import { normalizeOperationError } from "../../platform/operationError";

export function cleanChatImageSnapshots(input: {
  readonly sql: SqlClient.SqlClient;
  readonly attachmentsDir: string;
  readonly now: Date;
}) {
  const { sql } = input;
  const cutoff = new Date(input.now.getTime() - 60 * 60 * 1000).toISOString();
  return Effect.gen(function* () {
    const removed = yield* sql.withTransaction(
      Effect.gen(function* () {
        // References are committed with the event, independently of projection rebuilds.
        // The lease protects images staged before their event transaction commits.
        const unused = yield* sql<{ name: string }>`SELECT name FROM chat_image_snapshots AS image
        WHERE touched_at < ${cutoff} AND NOT EXISTS (
          SELECT 1 FROM chat_image_snapshot_references AS ref WHERE ref.name = image.name
        ) LIMIT 64`;
        for (const image of unused) {
          if (!chatImageSnapshotName(`${CHAT_IMAGE_SNAPSHOT_PREFIX}${image.name}`))
            return yield* Effect.fail(
              new ChatImageSnapshotError({ message: "Invalid chat image storage identity." }),
            );
          yield* Effect.tryPromise({
            try: () =>
              fs.rm(path.join(input.attachmentsDir, "chat-images", image.name), { force: true }),
            catch: normalizeOperationError,
          });
          yield* sql`DELETE FROM chat_image_snapshot_references WHERE name = ${image.name}`;
          yield* sql`DELETE FROM chat_image_snapshots WHERE name = ${image.name}`;
        }
        return unused.length;
      }),
    );
    yield* Effect.tryPromise({
      try: async () => {
        const directory = path.join(input.attachmentsDir, "chat-images");
        const entries = await fs.readdir(directory).catch((error) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
        let deleted = 0;
        for (const entry of entries) {
          if (!/^\.[0-9a-f-]{36}\.part$/.test(entry)) continue;
          const file = path.join(directory, entry);
          const info = await fs.stat(file).catch((error) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
          if (info && info.mtimeMs < Date.parse(cutoff)) {
            await fs.rm(file, { force: true });
            if (++deleted === 64) break;
          }
        }
      },
      catch: normalizeOperationError,
    });
    return removed;
  });
}
