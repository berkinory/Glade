export function extendReplacementRangeForTrailingSpace(
  text: string,
  rangeEnd: number,
  replacement: string,
): number {
  if (!replacement.endsWith(" ")) {
    return rangeEnd;
  }
  return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
}

// Guarantees a whitespace separator between chips when the trigger starts directly after a
// non-whitespace character (e.g. the user typed `@bar` right after an existing `@foo` chip).
// Without this, the two mentions render as plain text because the segment parser requires
// whitespace on both sides. An empty replacement is a pure clear, so we never prepend a stray
// space.
export function ensureLeadingSpaceForReplacement(
  text: string,
  rangeStart: number,
  replacement: string,
): string {
  if (replacement.length === 0) return replacement;
  if (rangeStart === 0) return replacement;
  const precedingChar = text[rangeStart - 1];
  if (!precedingChar || /\s/.test(precedingChar)) return replacement;
  return ` ${replacement}`;
}
