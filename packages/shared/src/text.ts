export function normalizeLineEndings(contents: string): string {
  return contents.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function splitsSurrogatePair(text: string, offsetChars: number): boolean {
  if (offsetChars <= 0 || offsetChars >= text.length) return false;
  const previousCodeUnit = text.charCodeAt(offsetChars - 1);
  const nextCodeUnit = text.charCodeAt(offsetChars);
  return (
    previousCodeUnit >= 0xd800 &&
    previousCodeUnit <= 0xdbff &&
    nextCodeUnit >= 0xdc00 &&
    nextCodeUnit <= 0xdfff
  );
}

export function unicodeSafeEndOffset(text: string, requestedEndOffsetChars: number): number {
  return splitsSurrogatePair(text, requestedEndOffsetChars)
    ? requestedEndOffsetChars - 1
    : requestedEndOffsetChars;
}

// Normalizes an optional string to "present and meaningful" or absent. `??` only falls back on
// null/undefined, so a blank or whitespace-only string slips through every `a ?? b ?? fallback`
// chain. That matters because many contract fields are `TrimmedNonEmptyString`: a `""` satisfies
// TypeScript but is rejected by the schema at the boundary, and branded `makeUnsafe` constructors
// validate without normalizing, so an untrimmed value throws.
export function nonEmptyTrimmed(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/(?:\u001B\]|\u009D)[^\u0007\u001B\u009C]*(?:\u0007|\u001B\\|\u009C)/gu, "");
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}
