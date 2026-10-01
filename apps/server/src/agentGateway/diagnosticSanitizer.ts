import { redactSensitiveProcessArgs } from "../platform/processArgumentRedaction.ts";

const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|secret|token|api[-_]?key)/i;
const MAX_STRING_CHARS = 4_000;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 50;

const MAX_DEPTH = 12;

const USAGE_COUNTER_KEYS = new Set([
  "usedTokens",
  "totalProcessedTokens",
  "maxTokens",
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "lastUsedTokens",
  "lastInputTokens",
  "lastCachedInputTokens",
  "lastOutputTokens",
  "lastReasoningOutputTokens",
  "cacheCreationInputTokens",
]);
type UsageContext = "event" | "payload" | "usage" | "cumulative" | undefined;

export function redactDiagnosticText(value: string): string {
  return redactSensitiveProcessArgs(value)
    .replace(
      /\b((?:authorization|proxy-authorization)\s*:\s*)(?:(?:basic|bearer)\s+)?[^\s,;]+/giu,
      "$1[redacted]",
    )
    .replace(
      /([?&](?:access[-_]?token|api[-_]?key|auth|authorization|cookie|credential|password|secret|token)=)[^&#\s]*/giu,
      "$1[redacted]",
    )
    .replace(
      /\b((?:access[-_]?token|api[-_]?key|auth|authorization|cookie|credential|password|secret|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/giu,
      "$1[redacted]",
    );
}

// Preparation needs complete log evidence rather than diagnostic preview truncation.
export function redactDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") return redactDiagnosticText(value);
  if (Array.isArray(value)) return value.map(redactDiagnosticValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) &&
      !(
        USAGE_COUNTER_KEYS.has(key) &&
        typeof entry === "number" &&
        Number.isSafeInteger(entry) &&
        entry >= 0
      )
        ? "[redacted]"
        : redactDiagnosticValue(entry),
    ]),
  );
}

export function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  const isUsageEvent =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === "thread.token-usage.updated";
  return sanitizeValue(value, depth, isUsageEvent ? "event" : undefined);
}

function sanitizeValue(value: unknown, depth: number, usageContext: UsageContext): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const redacted = redactDiagnosticText(value);
    return redacted.length <= MAX_STRING_CHARS
      ? redacted
      : `${redacted.slice(0, MAX_STRING_CHARS)}… [truncated ${redacted.length - MAX_STRING_CHARS} chars]`;
  }
  if (depth >= MAX_DEPTH) return "[depth limit]";
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry) => sanitizeValue(entry, depth + 1, undefined));
  }
  if (typeof value !== "object") return String(value);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_OBJECT_KEYS)
      .map(([key, entry]) => {
        const isUsageCounter =
          (usageContext === "usage" || usageContext === "cumulative") &&
          (USAGE_COUNTER_KEYS.has(key) || (key === "tokenAccountingVersion" && entry === 1)) &&
          typeof entry === "number" &&
          Number.isSafeInteger(entry) &&
          entry >= 0;
        const childContext: UsageContext =
          usageContext === "event" && key === "payload"
            ? "payload"
            : usageContext === "payload" && key === "usage"
              ? "usage"
              : usageContext === "usage" && key === "cumulativeUsage"
                ? "cumulative"
                : undefined;
        return [
          key,
          SENSITIVE_KEY.test(key) && !isUsageCounter
            ? "[redacted]"
            : sanitizeValue(entry, depth + 1, childContext),
        ];
      }),
  );
}
