// Sidecars (.br/.gz) are emitted at build time by apps/web's Vite precompress plugin — the server
// never compresses on the request path.

const STATIC_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

const STATIC_REVALIDATE_CACHE_CONTROL = "no-cache";

const STATIC_ICON_CACHE_CONTROL = "public, max-age=86400";

const ICON_DIRECTORY_PREFIXES = ["central-icons-reversed/", "central-icons-fill/"];

export function staticCacheControl(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.startsWith("assets/")) return STATIC_IMMUTABLE_CACHE_CONTROL;
  if (ICON_DIRECTORY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return STATIC_ICON_CACHE_CONTROL;
  }
  return STATIC_REVALIDATE_CACHE_CONTROL;
}

interface StaticEncodingCandidate {
  readonly encoding: "br" | "gzip";
  readonly sidecarExtension: ".br" | ".gz";
}

const STATIC_ENCODING_CANDIDATES: readonly StaticEncodingCandidate[] = [
  { encoding: "br", sidecarExtension: ".br" },
  { encoding: "gzip", sidecarExtension: ".gz" },
];

const QVALUE_PATTERN = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

function parseQValue(rawParams: readonly string[]): number | null {
  for (const param of rawParams) {
    const normalized = param.trim().toLowerCase();
    const separator = normalized.indexOf("=");
    if (separator < 0) continue;
    const name = normalized.slice(0, separator);

    if (name.trimEnd() !== "q") continue;
    const value = normalized.slice(separator + 1);

    if (name !== "q" || value !== value.trim()) return null;
    return QVALUE_PATTERN.test(value) ? Number.parseFloat(value) : null;
  }
  return 1;
}

export interface StaticEncodingPreference {
  readonly candidates: readonly (StaticEncodingCandidate | null)[];

  readonly identityAcceptable: boolean;
}

export function negotiateStaticEncodingPreference(
  acceptEncoding: string | undefined,
): StaticEncodingPreference {
  if (!acceptEncoding) return { candidates: [null], identityAcceptable: true };
  const explicit = new Map<string, number>();
  for (const rawEntry of acceptEncoding.split(",")) {
    const [rawName, ...rawParams] = rawEntry.trim().split(";");
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;
    const weight = parseQValue(rawParams);
    if (weight === null) continue;

    if (!explicit.has(name)) explicit.set(name, weight);
  }
  const wildcard = explicit.get("*");

  const identityWeight = explicit.get("identity") ?? wildcard ?? 1;
  const ranked: {
    readonly candidate: StaticEncodingCandidate | null;
    readonly weight: number;
    readonly preference: number;
  }[] = [
    ...STATIC_ENCODING_CANDIDATES.map((candidate, index) => ({
      candidate: candidate as StaticEncodingCandidate | null,
      weight: explicit.get(candidate.encoding) ?? wildcard ?? 0,
      preference: index,
    })),

    { candidate: null, weight: identityWeight, preference: STATIC_ENCODING_CANDIDATES.length },
  ];

  return {
    candidates: ranked
      .filter((entry) => entry.weight > 0)
      .toSorted((a, b) => b.weight - a.weight || a.preference - b.preference)
      .map((entry) => entry.candidate),
    identityAcceptable: identityWeight > 0,
  };
}

// Sidecars are a negotiation detail, never addressable resources: a direct request for one would
// serve compressed bytes with identity encoding and a misleading MIME type. Matched
// case-insensitively because case-insensitive filesystems (macOS default) resolve `app.js.BR` to
// the real sidecar.
export function isSidecarRequestPath(relativePath: string): boolean {
  const lowered = relativePath.toLowerCase();
  return lowered.endsWith(".br") || lowered.endsWith(".gz");
}

function opaqueTag(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
}

export function ifNoneMatchSatisfies(headerValue: string | undefined, etag: string): boolean {
  if (!headerValue) return false;
  const trimmed = headerValue.trim();
  if (trimmed === "*") return true;
  const target = opaqueTag(etag);
  return trimmed.split(",").some((candidate) => opaqueTag(candidate) === target);
}

export function staticEtag(size: number, mtimeMs: number, encoding?: string): string {
  return `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}${encoding ? `-${encoding}` : ""}"`;
}
