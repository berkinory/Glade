import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { expect, it } from "vitest";

import { runWithPreMigrationBackup } from "./MigrationBackup.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

it("backs up pending migrations with committed WAL data and retains five snapshots", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "glade-backup-"));
  const dbPath = path.join(directory, "state.sqlite");
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`PRAGMA journal_mode = WAL`;
        yield* sql`CREATE TABLE probe (value TEXT NOT NULL)`;
        yield* sql`INSERT INTO probe VALUES ('committed')`;
        for (let index = 0; index < 6; index++) {
          yield* runWithPreMigrationBackup(dbPath, Effect.void);
        }
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath }))),
    );
    const backupDirectory = `${dbPath}.backups`;
    const files = (await fs.readdir(backupDirectory)).filter((name) => name.endsWith(".sqlite"));
    expect(files).toHaveLength(5);
    const backup = new DatabaseSync(path.join(backupDirectory, files[0]!), { readOnly: true });
    try {
      expect(backup.prepare("SELECT value FROM probe").get()).toEqual({ value: "committed" });
    } finally {
      backup.close();
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
