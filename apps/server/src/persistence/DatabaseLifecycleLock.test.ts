import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireDatabaseLifecycleLock,
  DatabaseLifecycleLockedError,
  releaseDatabaseLifecycleLock,
  withDatabaseLifecycleLock,
} from "./DatabaseLifecycleLock.ts";
import { makeSqlitePersistenceLive } from "./Layers/Sqlite.ts";

const DEAD_PID = 2_147_483_647;
const tempDirectories: Array<string> = [];

async function makeDbPath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "glade-db-lock-"));
  tempDirectories.push(directory);
  return path.join(directory, "state.sqlite");
}

async function writeOwnedDirectory(directoryPath: string, pid: number): Promise<void> {
  await fs.mkdir(directoryPath, { mode: 0o700 });
  await fs.writeFile(
    path.join(directoryPath, "owner.json"),
    `${JSON.stringify({
      pid,
      token: randomUUID(),
      createdAt: new Date().toISOString(),
    })}\n`,
    { mode: 0o600 },
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe("database lifecycle lock", () => {
  it("allows one same-process owner and releases only its owner token", async () => {
    const dbPath = await makeDbPath();
    const first = await Effect.runPromise(acquireDatabaseLifecycleLock(dbPath));

    try {
      await expect(Effect.runPromise(acquireDatabaseLifecycleLock(dbPath))).rejects.toBeInstanceOf(
        DatabaseLifecycleLockedError,
      );
      expect(await fs.readdir(path.dirname(dbPath))).toEqual([path.basename(first.lockPath)]);
      await expect(fs.readFile(path.join(first.lockPath, "owner.json"), "utf8")).resolves.toContain(
        first.owner.token,
      );
      const forged = { ...first, owner: { ...first.owner, token: randomUUID() } };
      await expect(Effect.runPromise(releaseDatabaseLifecycleLock(forged))).rejects.toBeInstanceOf(
        DatabaseLifecycleLockedError,
      );
    } finally {
      await Effect.runPromise(releaseDatabaseLifecycleLock(first));
    }

    const next = await Effect.runPromise(acquireDatabaseLifecycleLock(dbPath));
    await Effect.runPromise(releaseDatabaseLifecycleLock(next));
    expect(await fs.readdir(path.dirname(dbPath))).toEqual([]);
  });

  it("does not take over a reaper guard owned by a live process", async () => {
    const dbPath = await makeDbPath();
    const lockPath = `${dbPath}.lifecycle-lock`;
    const reaperPath = `${lockPath}.reaper`;
    await writeOwnedDirectory(lockPath, DEAD_PID);
    await writeOwnedDirectory(reaperPath, process.pid);

    await expect(Effect.runPromise(acquireDatabaseLifecycleLock(dbPath))).rejects.toBeInstanceOf(
      DatabaseLifecycleLockedError,
    );
    await expect(fs.stat(lockPath)).resolves.toBeDefined();
    await expect(fs.stat(reaperPath)).resolves.toBeDefined();
  });

  it.each([
    { name: "a dead owner's lock", lock: "dead", reaper: "none" },
    { name: "a dead owner's lock and reaper guard", lock: "dead", reaper: "dead" },
    { name: "an ownerless lock directory", lock: "empty", reaper: "none" },
    { name: "an ownerless lock holding only Finder metadata", lock: "finder", reaper: "none" },
    { name: "an ownerless reaper holding only Finder metadata", lock: "dead", reaper: "finder" },
  ] as const)("recovers $name", async ({ lock, reaper }) => {
    const dbPath = await makeDbPath();
    const lockPath = `${dbPath}.lifecycle-lock`;
    for (const [directoryPath, layout] of [
      [lockPath, lock],
      [`${lockPath}.reaper`, reaper],
    ] as const) {
      if (layout === "dead") await writeOwnedDirectory(directoryPath, DEAD_PID);
      if (layout === "empty" || layout === "finder") await fs.mkdir(directoryPath, { mode: 0o700 });
      if (layout === "finder")
        await fs.writeFile(path.join(directoryPath, ".DS_Store"), "Finder metadata");
    }

    await Effect.runPromise(withDatabaseLifecycleLock(dbPath, Effect.void));

    expect(await fs.readdir(path.dirname(dbPath))).toEqual([]);
  });

  it("fails closed for an owner-file symlink", async () => {
    const dbPath = await makeDbPath();
    const lockPath = `${dbPath}.lifecycle-lock`;
    await fs.mkdir(lockPath, { mode: 0o700 });
    const outsideOwner = path.join(path.dirname(dbPath), "outside-owner.json");
    const outsideContents = `${JSON.stringify({
      pid: DEAD_PID,
      token: randomUUID(),
      createdAt: new Date().toISOString(),
    })}\n`;
    await fs.writeFile(outsideOwner, outsideContents);
    await fs.symlink(outsideOwner, path.join(lockPath, "owner.json"));

    await expect(Effect.runPromise(acquireDatabaseLifecycleLock(dbPath))).rejects.toBeInstanceOf(
      DatabaseLifecycleLockedError,
    );
    expect(await fs.readFile(outsideOwner, "utf8")).toBe(outsideContents);
    expect((await fs.lstat(path.join(lockPath, "owner.json"))).isSymbolicLink()).toBe(true);
  });

  it("preserves an unverifiable lock that also holds Finder metadata", async () => {
    const dbPath = await makeDbPath();
    const lockPath = `${dbPath}.lifecycle-lock`;
    await fs.mkdir(lockPath, { mode: 0o700 });
    await fs.writeFile(path.join(lockPath, ".DS_Store"), "Finder metadata");
    await fs.writeFile(path.join(lockPath, "unrecognized"), "kept");

    await expect(
      Effect.runPromise(withDatabaseLifecycleLock(dbPath, Effect.void)),
    ).rejects.toBeInstanceOf(DatabaseLifecycleLockedError);
    expect(await fs.readdir(lockPath)).toEqual([".DS_Store", "unrecognized"]);
  });

  it("makes server startup refuse while recovery owns the database", async () => {
    const dbPath = await makeDbPath();

    const startupExit = await Effect.runPromise(
      withDatabaseLifecycleLock(
        dbPath,
        Effect.exit(
          Layer.build(
            makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer)),
          ).pipe(Effect.scoped),
        ),
      ),
    );

    expect(startupExit._tag).toBe("Failure");
    if (startupExit._tag === "Failure") {
      expect(String(startupExit.cause)).toContain("DatabaseLifecycleLockedError");
    }
  });
});
