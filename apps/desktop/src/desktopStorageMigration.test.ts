import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { describe, expect, it } from "vitest";

import {
  acknowledgeGladeStorageSnapshot,
  readGladeStorageSnapshot,
  GLADE_STORAGE_SNAPSHOT_MAX_BYTES,
  validateGladeStorageSnapshot,
} from "./desktopStorageMigration";

const snapshot = () => ({
  version: 1 as const,
  exportedAt: "2026-07-09T00:00:00.000Z",
  entries: {
    "glade:theme": "dark",
    "glade.openUsage.enabled": "true",
  },
});

describe("desktopStorageMigration", () => {
  it("reads a legacy snapshot and removes it after acknowledgement", async () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "glade-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      FS.writeFileSync(target, `${JSON.stringify(snapshot())}\n`);
      expect(readGladeStorageSnapshot(target)).toEqual(snapshot());

      await acknowledgeGladeStorageSnapshot(target);
      expect(readGladeStorageSnapshot(target)).toBeNull();
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed, disallowed, and oversized snapshots", () => {
    expect(validateGladeStorageSnapshot({ version: 1 })).toBeNull();
    expect(
      validateGladeStorageSnapshot({
        ...snapshot(),
        entries: { "foreign:theme": "dark" },
      }),
    ).toBeNull();
    expect(
      validateGladeStorageSnapshot({
        ...snapshot(),
        entries: { "glade:large": "x".repeat(GLADE_STORAGE_SNAPSHOT_MAX_BYTES) },
      }),
    ).toBeNull();
  });

  it("accepts renderer snapshots containing large composer drafts", () => {
    const largeDraft = "x".repeat(2 * 1024 * 1024);

    expect(
      validateGladeStorageSnapshot({
        ...snapshot(),
        entries: { "glade:composer-drafts:v1": largeDraft },
      })?.entries["glade:composer-drafts:v1"],
    ).toBe(largeDraft);
  });

  it("treats missing and malformed files as absent", () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "glade-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      expect(readGladeStorageSnapshot(target)).toBeNull();
      FS.writeFileSync(target, "not json");
      expect(readGladeStorageSnapshot(target)).toBeNull();
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
