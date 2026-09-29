const TASK_MARKER_PATTERN = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)[ xX](\])/;

export function toggleMarkdownTaskMarker(
  contents: string,
  sourceLine: number,
  checked: boolean,
): string | null {
  const lines = contents.split("\n");
  const index = sourceLine - 1;
  const line = lines[index];
  if (line === undefined) {
    return null;
  }
  const match = TASK_MARKER_PATTERN.exec(line);
  if (!match) {
    return null;
  }
  lines[index] = `${match[1]}${checked ? "x" : " "}${match[2]}${line.slice(match[0].length)}`;
  return lines.join("\n");
}
