import { createPublicKey, verify } from "node:crypto";

import {
  type McpCatalog,
  McpCatalogCategory,
  McpCatalogEnvelope,
  McpConnectorPreset,
} from "@glade/contracts/server/mcpCatalog";
import { Data, Option, Schema } from "effect";

// Ed25519 public keys, by key id. The private key never enters the repository; see
// packages/catalog/README.md.
const SIGNING_KEYS: Readonly<Record<string, string>> = {
  "2026-10": "MCowBQYDK2VwAyEAm2RJpNvtwuB9vcEa3kvHMO/G3YQYnfBkN7aJknNrLSo=",
};

export class McpCatalogRejected extends Data.TaggedError("McpCatalogRejected")<{
  readonly reason: string;
}> {}

const CatalogText = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  categories: Schema.Array(McpCatalogCategory),
  presets: Schema.Array(Schema.Unknown),
});

const decodeEnvelope = Schema.decodeUnknownOption(McpCatalogEnvelope);
const decodeCatalog = Schema.decodeUnknownOption(CatalogText);
const decodePreset = Schema.decodeUnknownOption(McpConnectorPreset);

function signatureValid(envelope: McpCatalogEnvelope): boolean {
  const key = SIGNING_KEYS[envelope.keyId];
  if (!key) return false;
  try {
    return verify(
      null,
      Buffer.from(envelope.payload, "utf8"),
      createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" }),
      Buffer.from(envelope.signature, "base64"),
    );
  } catch {
    return false;
  }
}

// Checks the signature over the payload text exactly as published, then keeps the presets this
// app understands: a newer catalog may add auth kinds or fields an older app has to skip.
export function openMcpCatalogEnvelope(value: unknown): McpCatalog | McpCatalogRejected {
  const envelope = decodeEnvelope(value);
  if (Option.isNone(envelope)) return new McpCatalogRejected({ reason: "unknown envelope" });
  if (!signatureValid(envelope.value)) return new McpCatalogRejected({ reason: "bad signature" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope.value.payload);
  } catch {
    return new McpCatalogRejected({ reason: "unreadable payload" });
  }
  const catalog = decodeCatalog(parsed);
  if (Option.isNone(catalog)) return new McpCatalogRejected({ reason: "unknown catalog shape" });
  const seen = new Set<string>();
  const presets = catalog.value.presets.flatMap((entry) => {
    const preset = decodePreset(entry);
    if (Option.isNone(preset) || seen.has(preset.value.id)) return [];
    seen.add(preset.value.id);
    return [preset.value];
  });
  return { version: catalog.value.version, categories: catalog.value.categories, presets };
}
