import { totalmem } from "node:os";

import { Effect, Layer, FileSystem, Path } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import { runWithPreMigrationBackup } from "../MigrationBackup.ts";
import {
  ensurePrivateFileSync,
  repairPrivateFile,
} from "../../platform/filesystem/privatePathPermissions.ts";
import { resolveSqliteMemoryBudget } from "../sqliteMemoryBudget.ts";
import { ServerConfig } from "../../server/config.ts";
import {
  acquireDatabaseLifecycleLock,
  releaseDatabaseLifecycleLock,
} from "../DatabaseLifecycleLock.ts";

class SqliteStartupError extends Error {
  readonly _tag = "SqliteStartupError";
}

type RuntimeSqliteLayerConfig = {
  readonly filename: string;
};

type Loader = {
  layer: (config: RuntimeSqliteLayerConfig) => Layer.Layer<SqlClient.SqlClient>;
};
const defaultSqliteClientLoaders = {
  bun: () => import("@effect/sql-sqlite-bun/SqliteClient"),
  node: () => import("../NodeSqliteClient.ts"),
} satisfies Record<string, () => Promise<Loader>>;

const makeRuntimeSqliteLayer = (
  config: RuntimeSqliteLayerConfig,
): Layer.Layer<SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const runtime = process.versions.bun !== undefined ? "bun" : "node";
    const loader = defaultSqliteClientLoaders[runtime];
    const clientModule = yield* Effect.promise<Loader>(loader);
    return clientModule.layer(config);
  }).pipe(Layer.unwrap);

function errnoCode(cause: unknown): string | undefined {
  const error = cause as (Error & { readonly code?: string; readonly cause?: unknown }) | null;
  return error?.code ?? (error?.cause as NodeJS.ErrnoException | undefined)?.code;
}

const repairSqliteFilePermissions = (dbPath: string) =>
  Effect.promise(async () => {
    await repairPrivateFile(dbPath);
    for (const suffix of ["-wal", "-shm"]) {
      await repairPrivateFile(`${dbPath}${suffix}`).catch((cause) => {
        if (errnoCode(cause) !== "ENOENT") throw cause;
      });
    }
  });

const makeSetup = (dbPath?: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      if (dbPath) {
        const lockingModeRows = yield* sql<{ readonly locking_mode: string }>`
          PRAGMA locking_mode = EXCLUSIVE;
        `;
        const lockingMode = lockingModeRows[0]?.locking_mode;
        if (lockingMode?.toLowerCase() !== "exclusive") {
          return yield* Effect.fail(
            new SqliteStartupError(
              `SQLite exclusive locking mode could not be enabled (result: ${lockingMode ?? "unknown"})`,
            ),
          );
        }
      }
      yield* sql`PRAGMA busy_timeout = 5000;`;
      const journalModeRows = yield* sql<{ readonly journal_mode: string }>`
        PRAGMA journal_mode = WAL;
      `;
      const journalMode = journalModeRows[0]?.journal_mode;
      if (journalMode?.toLowerCase() !== "wal") {
        yield* Effect.logWarning("SQLite WAL journal mode could not be enabled", {
          resultingJournalMode: journalMode ?? "unknown",
        });
      }

      yield* sql`PRAGMA synchronous = NORMAL;`;
      yield* sql`PRAGMA foreign_keys = ON;`;

      const memoryBudget = resolveSqliteMemoryBudget(totalmem());
      yield* sql`PRAGMA cache_size = ${sql.literal(String(memoryBudget.cacheSizePragma))};`;
      if (dbPath) {
        // mmap serves large sequential reads (event replay, VACUUM INTO backups) through the OS page cache
        // without double-buffering into the SQLite heap cache. In-memory databases have nothing to map.
        // Accepted tradeoff: with mmap, a device I/O error or an external process truncating the file
        // surfaces as a signal (SIGBUS) instead of a recoverable SQLite error. locking_mode=EXCLUSIVE plus
        // the lifecycle lock make external mutation effectively impossible, and no internal path truncates
        // the live database.
        yield* sql`PRAGMA mmap_size = ${sql.literal(String(memoryBudget.mmapSizeBytes))};`;

        yield* sql`BEGIN EXCLUSIVE;`;
        yield* sql`COMMIT;`;
      }

      yield* dbPath ? runWithPreMigrationBackup(dbPath, runMigrations()) : runMigrations();
    }),
  );

export const makeSqlitePersistenceLive = (dbPath: string) =>
  Effect.acquireRelease(acquireDatabaseLifecycleLock(dbPath), (lock) =>
    releaseDatabaseLifecycleLock(lock).pipe(Effect.orDie),
  ).pipe(
    Effect.flatMap(() =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });
        // Never reopen the database, WAL, or SHM merely to chmod them while this connection is live:
        // closing any descriptor for the same inode releases POSIX process locks and can leave a mapped WAL
        // index vulnerable to SIGBUS. SQLite creates its sidecars with the database's private mode.
        yield* Effect.sync(() => ensurePrivateFileSync(dbPath));
        yield* repairSqliteFilePermissions(dbPath);

        return Layer.provideMerge(makeSetup(dbPath), makeRuntimeSqliteLayer({ filename: dbPath }));
      }),
    ),
    Layer.unwrap,
  );

export const SqlitePersistenceMemory = Layer.provideMerge(
  makeSetup(),
  makeRuntimeSqliteLayer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath)),
);
