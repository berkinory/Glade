type JsonLine =
  | { readonly lineNumber: number; readonly value: unknown }
  | { readonly lineNumber: number; readonly error: string; readonly text: string };

export type JsonDocument =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "lines"; readonly lines: readonly JsonLine[] }
  | { readonly kind: "error"; readonly message: string };

const TRUNCATED_MESSAGE =
  "This file is larger than the preview limit, so it can't be shown as a tree. Switch to Source to read it.";

// Config files such as tsconfig.json are JSONC: drop comments and trailing commas outside strings
// so they parse like plain JSON.
function stripJsonComments(text: string): string {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
      index += 1;
      output += text.slice(start, index);
    } else if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
    } else if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      output += char;
      index += 1;
    }
  }
  return output.replace(/,(\s*[}\]])/g, "$1");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid JSON.";
}

export function parseJsonDocument(input: {
  readonly text: string;
  readonly lines: boolean;
  readonly truncated: boolean;
}): JsonDocument {
  if (input.lines) {
    const rawLines = input.text.split("\n");
    // A truncated read usually cuts the last line in half.
    if (input.truncated) rawLines.pop();
    const lines: JsonLine[] = [];
    rawLines.forEach((text, index) => {
      if (text.trim() === "") return;
      try {
        lines.push({ lineNumber: index + 1, value: JSON.parse(text) });
      } catch (error) {
        lines.push({ lineNumber: index + 1, error: errorMessage(error), text });
      }
    });
    return { kind: "lines", lines };
  }
  if (input.truncated) return { kind: "error", message: TRUNCATED_MESSAGE };
  if (input.text.trim() === "") return { kind: "error", message: "This file is empty." };
  try {
    return { kind: "value", value: JSON.parse(input.text) };
  } catch (strictError) {
    try {
      return { kind: "value", value: JSON.parse(stripJsonComments(input.text)) };
    } catch {
      return { kind: "error", message: `Couldn't parse this file: ${errorMessage(strictError)}` };
    }
  }
}

export function jsonContainerEntries(
  value: unknown,
): readonly (readonly [string, unknown])[] | null {
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item] as const);
  if (value !== null && typeof value === "object") return Object.entries(value);
  return null;
}

const PREVIEW_ENTRY_LIMIT = 5;
const PREVIEW_STRING_LIMIT = 40;

function previewScalar(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value !== null && typeof value === "object") return "{…}";
  if (typeof value !== "string") return String(value);
  return JSON.stringify(
    value.length > PREVIEW_STRING_LIMIT ? `${value.slice(0, PREVIEW_STRING_LIMIT)}…` : value,
  );
}

// A one-line glimpse of a collapsed container, like browser devtools, so log records stay readable.
export function jsonContainerPreview(value: unknown): string {
  const entries = jsonContainerEntries(value) ?? [];
  const isArray = Array.isArray(value);
  const shown = entries
    .slice(0, PREVIEW_ENTRY_LIMIT)
    .map(([name, item]) => (isArray ? previewScalar(item) : `${name}: ${previewScalar(item)}`));
  if (entries.length > PREVIEW_ENTRY_LIMIT) shown.push("…");
  return isArray ? `[${shown.join(", ")}]` : `{${shown.join(", ")}}`;
}
