import type { BrowserBatchTool } from "@glade/contracts/browser/browserTools";

// [running, completed, object of "Couldn't …"] per gateway browser tool. Action verbs stay bare so
// the row reads `Clicked button "Sign in" · example.com` with the result line as its preview.
const BROWSER_TOOL_WORDING = {
  browser_tabs: ["Managing tabs", "Managed tabs", "manage tabs"],
  browser_navigate: ["Opening page", "Opened", "open the page"],
  browser_snapshot: ["Reading page", "Read page", "read the page"],
  browser_find: ["Searching page", "Searched page", "search the page"],
  browser_get_text: ["Reading page text", "Read page text", "read the page text"],
  browser_click: ["Clicking", "Clicked", "click"],
  browser_hover: ["Hovering", "Hovered", "hover"],
  browser_type: ["Typing", "Typed", "type"],
  browser_fill: ["Filling form", "Filled form", "fill the form"],
  browser_press: ["Pressing keys", "Pressed", "press keys"],
  browser_select: ["Selecting", "Selected", "select"],
  browser_scroll: ["Scrolling", "Scrolled", "scroll"],
  browser_screenshot: ["Taking screenshot", "Took screenshot", "take a screenshot"],
  browser_dialog: ["Answering dialog", "Answered dialog", "answer the dialog"],
  browser_upload: ["Uploading files", "Uploaded", "upload files"],
  browser_console: ["Reading console", "Read console", "read the console"],
  browser_network: ["Reading network", "Read network requests", "read network requests"],
  browser_batch: ["Running browser steps", "Ran browser steps", "run browser steps"],
  browser_evaluate: ["Evaluating script", "Evaluated script", "evaluate the script"],
} as const satisfies Record<
  BrowserBatchTool | "browser_batch" | "browser_evaluate",
  readonly [string, string, string]
>;

type BrowserToolName = keyof typeof BROWSER_TOOL_WORDING;

const BROWSER_TOOL_NAMES = new Set<string>(Object.keys(BROWSER_TOOL_WORDING));
// Tools whose first result line is "<Verb> <what>.", where <Verb> repeats the row heading.
const SENTENCE_RESULT_TOOLS = new Set<string>([
  "browser_click",
  "browser_hover",
  "browser_type",
  "browser_press",
  "browser_select",
  "browser_scroll",
  "browser_upload",
]);

export const GLADE_BROWSER_TOOL_PRESENTATIONS = Object.fromEntries(
  Object.entries(BROWSER_TOOL_WORDING).map(([name, [running, completed, failed]]) => [
    `glade_${name}`,
    { running, completed, failed: `Couldn't ${failed}` },
  ]),
) as Record<
  `glade_${BrowserToolName}`,
  { readonly running: string; readonly completed: string; readonly failed: string }
>;

export function isGladeBrowserToolName(gladeToolName: string): boolean {
  return BROWSER_TOOL_NAMES.has(gladeToolName.replace(/^glade_/u, ""));
}

// Bare gateway names, as some providers report them without the server prefix.
export function isBareBrowserToolName(normalizedName: string): boolean {
  return BROWSER_TOOL_NAMES.has(normalizedName);
}

function pageLabel(url: string): string | null {
  const parsed = URL.parse(url);
  if (!parsed || !parsed.host) return null;
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return `${parsed.host}${path}`;
}

// A compact result line from the tool output, for example `button "Sign in" · example.com`.
export function browserToolResultPreview(gladeToolName: string, output: string): string | null {
  const tool = gladeToolName.replace(/^glade_/u, "");
  if (!BROWSER_TOOL_NAMES.has(tool)) return null;
  const lines = output.split("\n").map((line) => line.trim());
  const url = lines.find((line) => line.startsWith("URL: "))?.slice(5);
  if (tool === "browser_navigate") return url ? pageLabel(url) : null;
  const first = lines.find((line) => line.length > 0) ?? "";
  const what = SENTENCE_RESULT_TOOLS.has(tool)
    ? first
        .replace(/^\S+\s+/u, "")
        .replace(/\s*\(e\d+\)/gu, "")
        .replace(/\.$/u, "")
    : "";
  const host = url ? (URL.parse(url)?.host ?? null) : null;
  return [what, host].filter(Boolean).join(" · ") || null;
}
