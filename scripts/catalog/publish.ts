// Builds the signed MCP server catalog from packages/catalog. With --check it signs nothing and
// fails when the signed copies no longer match their source.
import { createPrivateKey, sign } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  McpCatalogRejected,
  openMcpCatalogEnvelope,
} from "../../apps/server/src/mcpCatalog/catalogEnvelope.ts";

const KEY_ID = "2026-10";
const root = path.resolve(import.meta.dirname, "../..");
const catalogDir = path.join(root, "packages/catalog");
const outputs = [
  path.join(catalogDir, "signed/mcp-servers.json"),
  path.join(root, "apps/landing/public/catalog/mcp-servers.json"),
];
const MIME: Readonly<Record<string, string>> = { ".svg": "image/svg+xml", ".png": "image/png" };

interface Brand {
  readonly monochrome?: boolean;
  readonly badge?: boolean;
  readonly coverage?: number;
}
interface SourcePreset {
  readonly id: string;
  readonly icon?: string;
  readonly [field: string]: unknown;
}
interface Source {
  readonly categories: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly presets: ReadonlyArray<SourcePreset>;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function brandFiles(): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  for (const file of readdirSync(path.join(catalogDir, "brands"))) {
    files.set(path.parse(file).name, path.join(catalogDir, "brands", file));
  }
  return files;
}

function buildContent() {
  const source = readJson(path.join(catalogDir, "mcp-servers.json")) as Source;
  const brands = readJson(path.join(catalogDir, "brands.json")) as Record<string, Brand>;
  const files = brandFiles();
  const categories = new Set(source.categories.map((category) => category.id));
  const ids = new Set<string>();
  const presets = source.presets.map(({ icon, ...preset }) => {
    if (ids.has(preset.id)) fail(`Preset ${preset.id} is listed twice.`);
    ids.add(preset.id);
    if (!categories.has(String(preset.category))) {
      fail(`Preset ${preset.id} names an unknown category.`);
    }
    if (icon === undefined) return preset;
    const brand = brands[icon];
    const file = files.get(icon);
    if (!brand || !file) fail(`Preset ${preset.id} names an unknown brand: ${icon}.`);
    const mime = MIME[path.extname(file)];
    if (!mime) fail(`Brand ${icon} is not an SVG or PNG.`);
    return {
      ...preset,
      icon: {
        src: `data:${mime};base64,${readFileSync(file).toString("base64")}`,
        ...(brand.monochrome ? { monochrome: true } : {}),
        ...(brand.badge ? { badge: true } : {}),
        ...(brand.coverage ? { coverage: brand.coverage } : {}),
      },
    };
  });
  return { categories: source.categories, presets };
}

function signedPayload(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  const envelope = readJson(file);
  const opened = openMcpCatalogEnvelope(envelope);
  if (opened instanceof McpCatalogRejected) fail(`${file} is rejected: ${opened.reason}.`);
  return JSON.parse((envelope as { payload: string }).payload) as Record<string, unknown>;
}

const content = buildContent();
const previous = signedPayload(outputs[0]!);
const { version: previousVersion, ...previousContent } = previous ?? { version: 0 };
const unchanged = previous !== null && isDeepStrictEqual(previousContent, content);

if (process.argv.includes("--check")) {
  const copies = outputs.map((file) => (existsSync(file) ? readFileSync(file, "utf8") : null));
  if (!unchanged || copies.some((copy) => copy !== copies[0])) {
    fail("The signed MCP catalog is out of date. Run `bun scripts/catalog/publish.ts`.");
  }
  process.exit(0);
}
if (unchanged) {
  console.log(`The signed MCP catalog is current (version ${String(previousVersion)}).`);
  process.exit(0);
}

const keyPath =
  process.env.GLADE_CATALOG_SIGNING_KEY ??
  path.join(homedir(), ".config/glade/catalog-signing-key.pem");
if (!existsSync(keyPath)) fail(`No catalog signing key at ${keyPath}.`);
const payload = JSON.stringify({ version: Number(previousVersion) + 1, ...content });
const envelope = {
  format: 1,
  keyId: KEY_ID,
  payload,
  signature: sign(
    null,
    Buffer.from(payload, "utf8"),
    createPrivateKey(readFileSync(keyPath)),
  ).toString("base64"),
};
const opened = openMcpCatalogEnvelope(envelope);
if (opened instanceof McpCatalogRejected) fail(`The new catalog is rejected: ${opened.reason}.`);
if (opened.presets.length !== content.presets.length) {
  fail("Some presets do not match the catalog schema.");
}
const text = `${JSON.stringify(envelope, null, 2)}\n`;
for (const file of outputs) writeFileSync(file, text);
console.log(`Signed MCP catalog version ${opened.version}: ${opened.presets.length} servers.`);
