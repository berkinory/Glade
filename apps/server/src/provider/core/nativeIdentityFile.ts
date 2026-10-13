import { readFile } from "node:fs/promises";
import { Schema } from "effect";

export const decodeNativeIdentityRecord = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Unknown),
);

export async function readNativeIdentityFile(
  file: string,
): Promise<Record<string, unknown> | null> {
  try {
    return decodeNativeIdentityRecord(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    // JSON and schema errors can quote authentication file contents.
    throw new Error("Malformed provider authentication metadata.", { cause: error });
  }
}
