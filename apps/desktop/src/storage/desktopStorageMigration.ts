import * as FS from "node:fs";
import * as Path from "node:path";

import type { GladeStorageSnapshot } from "@glade/contracts/ipc/ipc";

const GLADE_STORAGE_SNAPSHOT_FILE_NAME = "glade-storage-origin-v1.json";
export const GLADE_STORAGE_SNAPSHOT_MAX_BYTES = 16 * 1024 * 1024;
const GLADE_STORAGE_SNAPSHOT_MAX_ENTRIES = 2_048;
const GLADE_STORAGE_SNAPSHOT_MAX_KEY_LENGTH = 512;
const GLADE_STORAGE_SNAPSHOT_MAX_VALUE_LENGTH = 16 * 1024 * 1024;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isGladeStorageKey(key: string): boolean {
  return key.startsWith("glade:") || key.startsWith("glade.");
}

export function validateGladeStorageSnapshot(value: unknown): GladeStorageSnapshot | null {
  if (!isPlainRecord(value) || value.version !== 1 || !isPlainRecord(value.entries)) {
    return null;
  }
  if (typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))) {
    return null;
  }

  const entries = Object.entries(value.entries);
  if (entries.length > GLADE_STORAGE_SNAPSHOT_MAX_ENTRIES) {
    return null;
  }
  for (const [key, entryValue] of entries) {
    if (
      !isGladeStorageKey(key) ||
      key.length === 0 ||
      key.length > GLADE_STORAGE_SNAPSHOT_MAX_KEY_LENGTH ||
      typeof entryValue !== "string" ||
      entryValue.length > GLADE_STORAGE_SNAPSHOT_MAX_VALUE_LENGTH
    ) {
      return null;
    }
  }

  const snapshot = value as unknown as GladeStorageSnapshot;
  try {
    if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > GLADE_STORAGE_SNAPSHOT_MAX_BYTES) {
      return null;
    }
  } catch {
    return null;
  }
  return snapshot;
}

export function resolveGladeStorageSnapshotPath(userDataPath: string): string {
  return Path.join(userDataPath, GLADE_STORAGE_SNAPSHOT_FILE_NAME);
}

export function readGladeStorageSnapshot(snapshotPath: string): GladeStorageSnapshot | null {
  try {
    const stats = FS.statSync(snapshotPath);
    if (!stats.isFile() || stats.size > GLADE_STORAGE_SNAPSHOT_MAX_BYTES) {
      return null;
    }
    return validateGladeStorageSnapshot(JSON.parse(FS.readFileSync(snapshotPath, "utf8")));
  } catch {
    return null;
  }
}

export async function acknowledgeGladeStorageSnapshot(snapshotPath: string): Promise<void> {
  await FS.promises.rm(snapshotPath, { force: true }).catch(() => undefined);
}
