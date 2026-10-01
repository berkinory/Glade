import { unicodeSafeEndOffset } from "@glade/shared/text/text";
import { redactDiagnosticText, sanitizeDiagnosticValue } from "./diagnosticSanitizer";
import { ToolInputError } from "./toolInput";

const SENSITIVE_PATH = /(?:authorization|cookie|credential|password|secret|token|api[-_]?key)/i;

export function readActivityPassage(input: {
  readonly payload: unknown;
  readonly path: ReadonlyArray<string>;
  readonly offset: number;
  readonly maxChars: number;
}) {
  if (!Number.isSafeInteger(input.offset) || input.offset < 0)
    throw new ToolInputError("detailOffsetChars must be a non-negative integer.");
  let value = input.payload;
  for (const key of input.path) {
    if (SENSITIVE_PATH.test(key)) return { path: input.path, value: "[redacted]" };
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, key))
      throw new ToolInputError("The requested activity detail path is unavailable.");
    value = (value as Record<string, unknown>)[key];
  }
  if (typeof value !== "string") {
    if (typeof value === "object" && value !== null) {
      const keys = Object.keys(value);
      return {
        path: input.path,
        keys: keys.slice(input.offset, input.offset + 50),
        totalKeys: keys.length,
        ...(input.offset + 50 < keys.length ? { nextOffsetChars: input.offset + 50 } : {}),
      };
    }
    return { path: input.path, value: sanitizeDiagnosticValue(value) };
  }
  const text = redactDiagnosticText(value);
  const start = unicodeSafeEndOffset(text, Math.min(input.offset, text.length));
  const end = unicodeSafeEndOffset(
    text,
    Math.min(start + Math.max(50, Math.min(20_000, input.maxChars)), text.length),
  );
  return {
    path: input.path,
    offsetChars: start,
    text: text.slice(start, end),
    totalChars: text.length,
    ...(end < text.length ? { nextOffsetChars: end } : {}),
  };
}
