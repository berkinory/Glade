import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { execProcessFileAsync } from "../../platform/processRunner";

const KEYCHAIN_TIMEOUT_MS = 5_000;

// Build a short, non-secret identity for cache partitioning without retaining credentials.
export function credentialFingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url").slice(0, 18);
}

export async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

// Claims are read only to schedule refreshes and derive identities; the signature is not verified.
export function jwtClaims(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    return asObjectRecord(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

// Opens another app's database read-only; a missing file, table or lock reads as null.
export function readSqlite<T>(path: string, read: (db: DatabaseSync) => T): T | null {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    return read(db);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

// Read-only: we never call `add-generic-password`.
export async function readKeychainPassword(input: {
  service: string;
  account?: string;
  platform: NodeJS.Platform;
}): Promise<string | null> {
  if (input.platform !== "darwin") {
    return null;
  }
  const args = ["find-generic-password", "-s", input.service, "-w"];
  if (input.account) {
    args.push("-a", input.account);
  }
  try {
    const { stdout } = await execProcessFileAsync("security", args, {
      timeout: KEYCHAIN_TIMEOUT_MS,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function decodeKeychainJson(value: string): unknown | null {
  const trimmed = value.trim();
  const tryParse = (candidate: string): unknown | null => {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct !== null) {
    return direct;
  }

  const hex = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
  if (hex.length % 2 === 0 && /^[0-9a-fA-F]+$/u.test(hex)) {
    try {
      return tryParse(Buffer.from(hex, "hex").toString("utf8"));
    } catch {
      return null;
    }
  }
  return null;
}
