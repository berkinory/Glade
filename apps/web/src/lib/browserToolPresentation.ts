import type { BrowserBatchTool } from "@glade/contracts/browser/browserTools";
import { pluralize } from "@glade/shared/text/text";
import { basenameOfPath } from "~/file-icons";
import {
  previewAt,
  presentGatewayToolCall,
  shortPreview,
  stringArg,
  stripUntrustedContent,
  type GatewayToolCall,
  type GatewayToolPresentation,
  type GatewayToolWording,
} from "./gatewayToolCall";

const BROWSER_TOOL_WORDING = {
  browser_tabs: ["Managing tabs", "Managed tabs", "manage tabs"],
  browser_navigate: ["Opening page", "Opened page", "open the page"],
  browser_snapshot: ["Reading page", "Read page", "read the page"],
  browser_find: ["Searching page", "Searched page", "search the page"],
  browser_get_text: ["Reading page text", "Read page text", "read the page text"],
  browser_click: ["Clicking", "Clicked", "click"],
  browser_hover: ["Hovering", "Hovered", "hover"],
  browser_drag: ["Dragging", "Dragged", "drag"],
  browser_type: ["Typing", "Typed", "type"],
  browser_fill: ["Filling form", "Filled form", "fill the form"],
  browser_press: ["Pressing", "Pressed", "press keys"],
  browser_select: ["Selecting", "Selected", "select"],
  browser_scroll: ["Scrolling", "Scrolled", "scroll"],
  browser_screenshot: ["Taking screenshot", "Took screenshot", "take a screenshot"],
  browser_dialog: ["Answering dialog", "Answered dialog", "answer the dialog"],
  browser_upload: ["Uploading", "Uploaded", "upload files"],
  browser_console: ["Reading console", "Read console", "read the console"],
  browser_network: ["Reading network requests", "Read network requests", "read network requests"],
  browser_batch: ["Running browser steps", "Ran browser steps", "run browser steps"],
  browser_evaluate: ["Evaluating script", "Evaluated script", "evaluate the script"],
  // Every listed tool needs wording; the index signature admits one before the contracts list it.
} as const satisfies Record<string, GatewayToolWording> &
  Record<BrowserBatchTool | "browser_batch" | "browser_evaluate", GatewayToolWording>;

type BrowserToolName = keyof typeof BROWSER_TOOL_WORDING;

const NAVIGATION_WORDING = {
  back: ["Going back", "Went back", "go back"],
  forward: ["Going forward", "Went forward", "go forward"],
  reload: ["Reloading", "Reloaded", "reload the page"],
} as const satisfies Record<string, GatewayToolWording>;

const TAB_WORDING = {
  list: ["Listing tabs", "Listed tabs", "list tabs"],
  open: ["Opening tab", "Opened tab", "open a tab"],
  close: ["Closing tab", "Closed tab", "close the tab"],
  select: ["Switching tab", "Switched tab", "switch tabs"],
} as const satisfies Record<string, GatewayToolWording>;

const isBrowserTool = (name: string): name is BrowserToolName =>
  Object.hasOwn(BROWSER_TOOL_WORDING, name);

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
  return isBrowserTool(gladeToolName.replace(/^glade_/u, ""));
}

// Bare gateway names, as some providers report them without the server prefix.
export function isBareBrowserToolName(normalizedName: string): boolean {
  return isBrowserTool(normalizedName);
}

function pageLabel(url: string | null): string | null {
  const parsed = url ? URL.parse(url) : null;
  if (!parsed?.host) return null;
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return shortPreview(`${parsed.host}${path}`);
}

const hostOf = (url: string | null) => (url ? (URL.parse(url)?.host ?? null) : null);

// The tab's URL as Glade reported it: a `URL:` line, or `… URL is now <url>` after an action.
function reportedUrl(lines: ReadonlyArray<string>): string | null {
  const urlLine = lines.findLast((line) => line.startsWith("URL: "));
  if (urlLine) return urlLine.slice("URL: ".length).trim();
  for (const line of lines.toReversed()) {
    const match = /URL is now (\S+?)(?:[;.]?\s|[;.]?$)/u.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}

// Glade names an element by ref as `role "name" (e12)` (just `e12` without a role), and a point as
// `<tag#id.class> "text" at (x, y)`. Show the name or text, else the role or tag; never the ref.
const ELEMENT_PATTERN =
  /([A-Za-z][\w-]*)(?: ("(?:[^"\\]|\\.)*"))? \(e[1-9]\d*\)|<([a-z][\w-]*)[^>]*>(?: ("(?:[^"\\]|\\.)*"))? at \(/gu;

function elementLabels(text: string | undefined): string[] {
  if (!text) return [];
  return Array.from(text.matchAll(ELEMENT_PATTERN), (match) => {
    let name = "";
    try {
      const quoted = match[2] ?? match[4];
      name = quoted ? (JSON.parse(quoted) as string) : "";
    } catch {
      name = "";
    }
    return name ? `"${shortPreview(name)}"` : (match[1] ?? match[3]!);
  });
}

const elementLabel = (text: string | undefined) => elementLabels(text)[0] ?? null;

function browserTarget(tool: BrowserToolName, call: GatewayToolCall, lines: string[]) {
  const { args } = call;
  const first = lines[0];
  const url = reportedUrl(lines);
  const host = hostOf(url);
  switch (tool) {
    case "browser_navigate":
    case "browser_tabs": {
      // A closed or listed tab's report names whichever tab is active afterwards.
      if (args.action === "close" || args.action === "list") return null;
      const page = pageLabel(url ?? stringArg(args, "url"));
      const arrives = args.history !== undefined || args.action === "select";
      return page && arrives ? `to ${page}` : page;
    }
    case "browser_find": {
      const query = stringArg(args, "query");
      return previewAt(query ? `for "${shortPreview(query)}"` : null, host);
    }
    case "browser_click":
    case "browser_hover":
      return previewAt(elementLabel(first), host);
    case "browser_drag": {
      const [from, to] = elementLabels(first);
      return previewAt(from && to ? `${from} to ${to}` : null, host);
    }
    case "browser_type": {
      const element = elementLabel(first);
      return previewAt(element ? `into ${element}` : null, host);
    }
    case "browser_select": {
      const match = first ? /^Selected (.+) in (.+)$/u.exec(first) : null;
      const element = elementLabel(match?.[2]);
      return previewAt(match?.[1] && element ? `${match[1]} in ${element}` : element, host);
    }
    case "browser_fill": {
      const fields = Array.isArray(args.fields) ? args.fields.length : 0;
      if (fields === 1) return previewAt(elementLabel(first), host);
      return previewAt(fields > 1 ? `${fields} fields` : null, host);
    }
    case "browser_press": {
      const key = stringArg(args, "key");
      const repeat = typeof args.repeat === "number" && args.repeat > 1 ? ` ×${args.repeat}` : "";
      return key ? `${shortPreview(key)}${repeat}` : null;
    }
    case "browser_scroll": {
      const direction = stringArg(args, "direction");
      const element = elementLabel(first);
      if (direction) return previewAt(element ? `${direction} in ${element}` : direction, host);
      return previewAt(element ? `${element} into view` : null, host);
    }
    case "browser_upload": {
      const paths = Array.isArray(args.paths)
        ? args.paths.filter((path): path is string => typeof path === "string")
        : [];
      return paths.length === 1
        ? basenameOfPath(paths[0]!)
        : paths.length > 1
          ? `${paths.length} files`
          : null;
    }
    default:
      return previewAt(null, host);
  }
}

function browserWording(tool: BrowserToolName, args: GatewayToolCall["args"]): GatewayToolWording {
  if (tool === "browser_navigate") {
    const history = stringArg(args, "history");
    if (history && Object.hasOwn(NAVIGATION_WORDING, history)) {
      return NAVIGATION_WORDING[history as keyof typeof NAVIGATION_WORDING];
    }
    if (stringArg(args, "url")) return ["Opening", "Opened", "open the page"];
  }
  if (tool === "browser_tabs") {
    const action = stringArg(args, "action");
    if (action && Object.hasOwn(TAB_WORDING, action)) {
      return TAB_WORDING[action as keyof typeof TAB_WORDING];
    }
  }
  if (tool === "browser_dialog" && typeof args.accept === "boolean") {
    return args.accept
      ? ["Accepting dialog", "Accepted dialog", "accept the dialog"]
      : ["Dismissing dialog", "Dismissed dialog", "dismiss the dialog"];
  }
  if (tool === "browser_fill" && Array.isArray(args.fields) && args.fields.length > 0) {
    return ["Filling", "Filled", "fill the form"];
  }
  if (tool === "browser_batch" && Array.isArray(args.steps) && args.steps.length > 0) {
    const steps = `${args.steps.length} browser ${pluralize(args.steps.length, "step")}`;
    return [`Running ${steps}`, `Ran ${steps}`, "run browser steps"];
  }
  return BROWSER_TOOL_WORDING[tool];
}

// `Clicked "Sign in" · github.com`, `Opened github.com/glade`, `Read page · github.com`.
// Refs, page content and report lines never reach the row.
export function describeBrowserToolCall(call: GatewayToolCall): GatewayToolPresentation | null {
  if (!isBrowserTool(call.tool)) return null;
  const lines = call.output ? stripUntrustedContent(call.output) : [];
  const presentation = presentGatewayToolCall(
    browserWording(call.tool, call.args),
    call,
    browserTarget(call.tool, call, lines),
  );
  if (call.status !== "failed" || !presentation.preview) return presentation;
  // Failure messages are written for the agent and name refs; the row names no refs.
  const preview = presentation.preview
    .replace(/\s*\(e[1-9]\d*\)/gu, "")
    .replace(/\b(?:ref\s+)?e[1-9]\d*\b/giu, "element");
  return { heading: presentation.heading, preview };
}
