import type { WorkLogToolKind } from "~/workLog.types";

const INLINE_VALUE_MAX_CHARS = 120;
const FILE_PATH_KEYS = ["file_path", "filePath", "path", "notebook_path"] as const;
// `cat -n` style prefixes Claude's Read output carries on every line.
const NUMBERED_LINE_PATTERN = /^\s*\d+\t/;

export type ToolInputField =
  | { key: string; layout: "inline"; text: string }
  | { key: string; layout: "block"; text: string; language: "json" | "text" };

// The argument a tool's row already names in its title (the file read, the page fetched, the
// query searched) is not repeated in its details.
const ROW_TITLE_KEYS: Partial<Record<WorkLogToolKind, ReadonlySet<string>>> = {
  read: new Set(FILE_PATH_KEYS),
  fetch: new Set(["url"]),
  web_search: new Set(["query"]),
};

// Short scalar arguments read best beside their name; long text and nested values get a block.
export function describeToolInput(
  input: Readonly<Record<string, unknown>>,
  toolKind: WorkLogToolKind | undefined,
): ToolInputField[] {
  const titleKeys = toolKind ? ROW_TITLE_KEYS[toolKind] : undefined;
  return Object.entries(input).flatMap(([key, value]): ToolInputField[] => {
    if (value === undefined || value === null || value === "" || titleKeys?.has(key)) return [];
    if (typeof value === "string") {
      return value.length <= INLINE_VALUE_MAX_CHARS && !value.includes("\n")
        ? [{ key, layout: "inline", text: value }]
        : [{ key, layout: "block", text: value, language: "text" }];
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return [{ key, layout: "inline", text: String(value) }];
    }
    return [{ key, layout: "block", text: JSON.stringify(value, null, 2), language: "json" }];
  });
}

export function toolInputFilePath(input: Readonly<Record<string, unknown>> | undefined) {
  for (const key of FILE_PATH_KEYS) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function languageForPath(path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return extension ?? "text";
}

function stripLineNumbers(text: string): string {
  const lines = text.split("\n");
  const numbered = lines
    .filter((line) => line.trim())
    .every((line) => NUMBERED_LINE_PATTERN.test(line));
  return numbered ? lines.map((line) => line.replace(NUMBERED_LINE_PATTERN, "")).join("\n") : text;
}

function prettyJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

export type ToolOutputView =
  | { format: "code"; language: string; text: string }
  | { format: "markdown"; text: string }
  | { format: "error"; text: string };

// Providers wrap tool errors in a tag such as `<tool_use_error>`; the message reads better without it.
const WRAPPED_ERROR_PATTERN = /^<([a-z_]+)>([\s\S]*)<\/\1>$/i;

// Picks how to show a tool's output from what the tool does and what the text looks like.
export function describeToolOutput(input: {
  text: string;
  toolKind: WorkLogToolKind | undefined;
  filePath: string | null;
  isError: boolean;
}): ToolOutputView {
  if (input.isError) {
    const trimmed = input.text.trim();
    return { format: "error", text: WRAPPED_ERROR_PATTERN.exec(trimmed)?.[2]?.trim() ?? trimmed };
  }
  if (input.toolKind === "read" && input.filePath) {
    return {
      format: "code",
      language: languageForPath(input.filePath),
      text: stripLineNumbers(input.text),
    };
  }
  const json = prettyJson(input.text);
  if (json) return { format: "code", language: "json", text: json };
  if (input.toolKind === "fetch" || input.toolKind === "web_search") {
    return { format: "markdown", text: input.text };
  }
  return { format: "code", language: "text", text: input.text };
}
