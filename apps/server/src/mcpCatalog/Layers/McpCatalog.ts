import { readFile } from "node:fs/promises";
import { join } from "node:path";

import bundledEnvelope from "@glade/catalog/signed/mcp-servers.json";
import type { McpCatalog as McpCatalogDocument } from "@glade/contracts/server/mcpCatalog";
import { Duration, Effect, Layer, Ref } from "effect";

import { writeFileStringAtomically } from "../../platform/filesystem/atomicWrite";
import { decodeOutboundJson, outboundHttp } from "../../platform/outboundHttp/outboundHttp.ts";
import { ServerConfig } from "../../server/config";
import { McpCatalogRejected, openMcpCatalogEnvelope } from "../catalogEnvelope";
import { McpCatalog } from "../Services/McpCatalog";

const CATALOG_URL = "https://useglade.dev/catalog/mcp-servers.json";
const REFRESH_INTERVAL = Duration.hours(24);

const POLICY = {
  service: "mcp-catalog",
  allowedOrigins: [new URL(CATALOG_URL).origin],
  timeoutMs: 15_000,
  maxRequestBytes: 0,
  maxResponseBytes: 4 * 1024 * 1024,
  maxRedirects: 0,
  maxConcurrent: 1,
  maxQueued: 1,
  requirePublicAddress: true,
  allowFakeIpDnsAddresses: true,
} as const;

interface CachedCatalog {
  readonly etag: string | null;
  readonly envelope: unknown;
}

const make = Effect.gen(function* () {
  const { stateDir } = yield* ServerConfig;
  const cachePath = join(stateDir, "mcp-catalog.json");
  const bundled = openMcpCatalogEnvelope(bundledEnvelope);
  if (bundled instanceof McpCatalogRejected) {
    return yield* Effect.die(new Error(`The bundled MCP catalog is invalid: ${bundled.reason}.`));
  }
  const current = yield* Ref.make<McpCatalogDocument>(bundled);
  const etag = yield* Ref.make<string | null>(null);

  // Catalogs only move forward, so a stale cache or mirror never replaces a newer bundle.
  const adopt = (envelope: unknown) => {
    const catalog = openMcpCatalogEnvelope(envelope);
    if (catalog instanceof McpCatalogRejected) {
      return Effect.logWarning("mcp_catalog.rejected", { reason: catalog.reason });
    }
    return Ref.update(current, (known) => (catalog.version > known.version ? catalog : known));
  };

  const cached = yield* Effect.tryPromise(async (): Promise<CachedCatalog> => {
    const text = await readFile(cachePath, "utf8");
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || !("envelope" in value)) {
      throw new Error("unknown cache shape");
    }
    const tag = "etag" in value && typeof value.etag === "string" ? value.etag : null;
    return { etag: tag, envelope: value.envelope };
  }).pipe(Effect.option);
  if (cached._tag === "Some") {
    yield* adopt(cached.value.envelope);
    yield* Ref.set(etag, cached.value.etag);
  }

  const refresh = Effect.gen(function* () {
    const previous = yield* Ref.get(etag);
    const response = yield* Effect.tryPromise(() =>
      outboundHttp.request({
        policy: POLICY,
        url: CATALOG_URL,
        headers: { accept: "application/json", ...(previous ? { "if-none-match": previous } : {}) },
      }),
    );
    if (response.status === 304) return;
    if (response.status !== 200) {
      return yield* Effect.logDebug("mcp_catalog.unavailable", { status: response.status });
    }
    const envelope = decodeOutboundJson(response, { maxDepth: 16, maxNodes: 100_000 });
    yield* adopt(envelope);
    const next = response.headers.get("etag");
    yield* Ref.set(etag, next);
    yield* writeFileStringAtomically({
      filePath: cachePath,
      contents: JSON.stringify({ etag: next, envelope } satisfies CachedCatalog),
    });
  });

  yield* Effect.forkScoped(
    Effect.forever(
      refresh.pipe(
        Effect.catchCause((cause) => Effect.logDebug("mcp_catalog.refresh_failed", { cause })),
        Effect.andThen(Effect.sleep(REFRESH_INTERVAL)),
      ),
    ),
  );

  return McpCatalog.of({ current: Ref.get(current) });
});

export const McpCatalogLive = Layer.effect(McpCatalog, make);
