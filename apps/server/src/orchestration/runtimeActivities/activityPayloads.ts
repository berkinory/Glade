import { type OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { isRecord } from "@glade/shared/transport/payloadValues";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";

const MAX_ACTIVITY_DATA_JSON_CHARS = 16_000;

export const MAX_ACTIVITY_DATA_STRING_CHARS = 2_000;

const MAX_ACTIVITY_DATA_ARRAY_ITEMS = 24;

const MAX_ACTIVITY_DATA_OBJECT_KEYS = 64;

const ACTIVITY_DATA_TRUNCATION_MARKER = "__gladeTruncated";

export type ActivityPayload = OrchestrationThreadActivity["payload"];

// Activity payloads splice in raw provider values - `Schema.Unknown` payload fields, rate-limit
// blobs, usage records, workflow snapshots - that are built in adapter code and never decoded.
// Already-safe values are returned by reference: a payload built from literals is walked but never
// copied.
function jsonSafeValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value !== "object") {
    return undefined;
  }
  if (ancestors.has(value)) {
    return "[Circular]";
  }
  ancestors.add(value);
  try {
    if (value instanceof Date) {
      return value.toJSON();
    }
    if (Array.isArray(value)) {
      let changed = false;
      const retained: unknown[] = new Array<unknown>(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];

        const safe = jsonSafeValue(entry, ancestors) ?? null;
        changed ||= !Object.is(safe, entry);
        retained[index] = safe;
      }
      return changed ? retained : value;
    }
    const prototype = Object.getPrototypeOf(value);
    const canReuseObject = prototype === Object.prototype || prototype === null;
    let changed = false;
    const retained: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const safe = jsonSafeValue(entry, ancestors);
      if (safe === undefined) {
        changed = true;
        continue;
      }
      changed ||= !Object.is(safe, entry);
      retained[key] = safe;
    }

    return changed || !canReuseObject ? retained : value;
  } finally {
    ancestors.delete(value);
  }
}

export function toActivityPayload(payload: unknown): ActivityPayload {
  return (jsonSafeValue(payload, new Set<object>()) ?? null) as ActivityPayload;
}

export function truncateDetail(value: string, limit = 180): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function isPlainJsonTree(value: unknown, seen: Set<object>): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.every((entry) => isPlainJsonTree(entry, seen));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  return Object.values(value).every((entry) => isPlainJsonTree(entry, seen));
}

function stringifyJsonLikeFallback(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (_key, entry) => {
      if (typeof entry === "bigint") {
        return entry.toString();
      }
      if (typeof entry === "function" || typeof entry === "symbol") {
        return undefined;
      }
      if (entry && typeof entry === "object") {
        if (seen.has(entry)) {
          return "[Circular]";
        }
        seen.add(entry);
      }
      return entry;
    }) ?? "null"
  );
}

function serializeJsonLike(value: unknown): {
  readonly text: string;
  readonly plain: boolean;
} {
  const plain = isPlainJsonTree(value, new Set<object>());
  return {
    text: plain ? (JSON.stringify(value) ?? "null") : stringifyJsonLikeFallback(value),
    plain,
  };
}

export function stringifyJsonLike(value: unknown): string {
  return serializeJsonLike(value).text;
}

export function truncateJsonString(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 15))}... [truncated]` : value;
}

function activityPayloadKeyRank(key: string): number {
  const ranks: Record<string, number> = {
    itemType: 0,
    status: 1,
    title: 2,
    detail: 3,
    toolName: 4,
    tool: 5,
    toolCallId: 6,
    callID: 7,
    callId: 8,
    command: 9,
    cmd: 10,
    input: 11,
    rawInput: 12,
    arguments: 13,
    args: 14,
    params: 15,
    item: 16,
    result: 17,
    rawOutput: 18,
    output: 19,
    data: 20,
    commandActions: 21,
    files: 22,
    changes: 23,
    path: 24,
    file: 25,
    filePath: 26,
    stdout: 27,
    stderr: 28,
    content: 29,
    totalFiles: 30,
    truncated: 31,
  };
  return ranks[key] ?? 100;
}

function truncateJsonValue(
  value: unknown,
  options: {
    readonly stringLimit: number;
    readonly arrayItems: number;
    readonly objectKeys: number;
    readonly depth: number;
    readonly seen?: WeakSet<object>;
  },
): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return truncateJsonString(value, options.stringLimit);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function" || typeof value === "symbol" || value === undefined) {
    return null;
  }
  const seen = options.seen ?? new WeakSet<object>();
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
  }
  if (options.depth <= 0) {
    return isRecord(value) || Array.isArray(value)
      ? {
          [ACTIVITY_DATA_TRUNCATION_MARKER]: true,
        }
      : String(value);
  }
  if (Array.isArray(value)) {
    const retained = value
      .slice(0, options.arrayItems)
      .map((entry) => truncateJsonValue(entry, { ...options, depth: options.depth - 1 }));
    if (value.length > options.arrayItems) {
      retained.push({
        [ACTIVITY_DATA_TRUNCATION_MARKER]: true,
        omittedItems: value.length - options.arrayItems,
      });
    }
    return retained;
  }
  if (!isRecord(value)) {
    return String(value);
  }

  const entries = Object.entries(value).filter(
    ([, entry]) => entry !== undefined && typeof entry !== "function" && typeof entry !== "symbol",
  );
  const retainedEntries = selectLeadingActivityPayloadEntries(entries, options.objectKeys);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of retainedEntries) {
    result[key] = truncateJsonValue(entry, { ...options, depth: options.depth - 1 });
  }
  if (entries.length > options.objectKeys) {
    result[ACTIVITY_DATA_TRUNCATION_MARKER] = true;
    result.omittedKeys = entries.length - options.objectKeys;
  }
  return result;
}

export function boundActivityData(value: unknown): unknown {
  const serialization = serializeJsonLike(value);
  const serialized = serialization.text;
  if (serialized.length <= MAX_ACTIVITY_DATA_JSON_CHARS) {
    return serialization.plain ? value : JSON.parse(serialized);
  }

  const withTruncationMetadata = (bounded: unknown): Record<string, unknown> => {
    const metadata = {
      [ACTIVITY_DATA_TRUNCATION_MARKER]: true,
      originalJsonChars: serialized.length,
    };
    return isRecord(bounded) ? { ...bounded, ...metadata } : { ...metadata, value: bounded };
  };
  const hardFallback = (): Record<string, unknown> => ({
    [ACTIVITY_DATA_TRUNCATION_MARKER]: true,
    originalJsonChars: serialized.length,
    preview: truncateJsonString(serialized, MAX_ACTIVITY_DATA_STRING_CHARS),
  });

  const compact = truncateJsonValue(value, {
    stringLimit: MAX_ACTIVITY_DATA_STRING_CHARS,
    arrayItems: MAX_ACTIVITY_DATA_ARRAY_ITEMS,
    objectKeys: MAX_ACTIVITY_DATA_OBJECT_KEYS,
    depth: 6,
  });
  const compactWithMetadata = withTruncationMetadata(compact);
  if (stringifyJsonLike(compactWithMetadata).length <= MAX_ACTIVITY_DATA_JSON_CHARS) {
    return compactWithMetadata;
  }

  const bounded = withTruncationMetadata(
    truncateJsonValue(value, {
      stringLimit: 800,
      arrayItems: 12,
      objectKeys: 32,
      depth: 4,
    }),
  );
  return stringifyJsonLike(bounded).length <= MAX_ACTIVITY_DATA_JSON_CHARS
    ? bounded
    : hardFallback();
}

export function activityDataField(data: unknown): { readonly data?: unknown } {
  return data === undefined ? {} : { data: boundActivityData(data) };
}

export function runtimePayloadRecord(
  event: ProviderRuntimeEvent,
): Record<string, unknown> | undefined {
  const payload = (event as { payload?: unknown }).payload;
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
}

function compareActivityPayloadEntries(
  left: readonly [string, unknown],
  right: readonly [string, unknown],
): number {
  const byRank = activityPayloadKeyRank(left[0]) - activityPayloadKeyRank(right[0]);
  return byRank !== 0 ? byRank : left[0].localeCompare(right[0]);
}

// Payloads are untrusted and can be arbitrarily wide, so a full sort just to keep a handful of keys
// made truncation itself the expensive step. Keys are unique, so the comparator never ties and the
// selection is exactly `toSorted(...).slice(0, limit)`.
function selectLeadingActivityPayloadEntries(
  entries: ReadonlyArray<[string, unknown]>,
  limit: number,
): Array<[string, unknown]> {
  if (limit <= 0) {
    return [];
  }
  if (entries.length <= limit) {
    return entries.toSorted(compareActivityPayloadEntries);
  }
  const leading: Array<[string, unknown]> = [];
  for (const entry of entries) {
    if (
      leading.length === limit &&
      compareActivityPayloadEntries(entry, leading[leading.length - 1]!) >= 0
    ) {
      continue;
    }
    let low = 0;
    let high = leading.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compareActivityPayloadEntries(leading[middle]!, entry) <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    leading.splice(low, 0, entry);
    if (leading.length > limit) {
      leading.pop();
    }
  }
  return leading;
}
