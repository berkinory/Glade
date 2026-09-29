const TRUNCATION_MARKER = "…";

export function clampTextToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let cut = maxLength - TRUNCATION_MARKER.length;
  const code = cut > 0 ? text.charCodeAt(cut - 1) : 0;
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return `${text.slice(0, Math.max(0, cut))}${TRUNCATION_MARKER}`;
}
