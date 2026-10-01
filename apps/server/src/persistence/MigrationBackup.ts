import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  ensurePrivateDirectorySync,
  repairPrivateFile,
} from "../platform/filesystem/privatePathPermissions.ts";
import { migrationEntries } from "./Migrations.ts";

const BACKUP_RETENTION = 5;

const migrationBackupDirectory = (dbPath: string): string => `${dbPath}.backups`;

const latestMigrationId = Math.max(...migrationEntries.map(([id]) => id));

const needsBackup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `;
  if (tables.length === 0) return false;
  if (!tables.some(({ name }) => name === "effect_sql_migrations")) return true;

  const rows = yield* sql<{ readonly migrationId: number | null }>`
    SELECT MAX(migration_id) AS "migrationId" FROM effect_sql_migrations
  `;
  return Number(rows[0]?.migrationId ?? 0) < latestMigrationId;
});

const pruneBackups = (directory: string, dbBasename: string) =>
  Effect.promise(async () => {
    const prefix = `${dbBasename}.migration-`;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const backups = entries
      .filter(
        (entry) =>
          entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".sqlite"),
      )
      .map((entry) => entry.name)
      .toSorted()
      .toReversed();
    for (const name of backups.slice(BACKUP_RETENTION)) {
      await fs.unlink(path.join(directory, name));
    }
  });

export const runWithPreMigrationBackup = <A, E, R>(
  dbPath: string,
  migration: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    if (yield* needsBackup) {
      const sql = yield* SqlClient.SqlClient;
      const directory = migrationBackupDirectory(dbPath);
      const basename = path.basename(dbPath);
      const stamp = new Date().toISOString().replaceAll(/[-:.TZ]/gu, "");
      const backupPath = path.join(
        directory,
        `${basename}.migration-${stamp}-${randomUUID()}.sqlite`,
      );
      yield* Effect.sync(() => ensurePrivateDirectorySync(directory));
      yield* sql`VACUUM INTO ${backupPath}`;
      yield* Effect.promise(() => repairPrivateFile(backupPath));
      yield* pruneBackups(directory, basename);
    }
    return yield* migration;
  });
