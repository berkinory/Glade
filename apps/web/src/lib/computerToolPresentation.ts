// [running, completed, object of "Couldn't …"] per gateway computer tool.
const COMPUTER_TOOL_WORDING = {
  computer_apps: ["Listing apps", "Listed apps", "list apps"],
  computer_window_state: ["Reading window", "Read window", "read the window"],
  computer_act: ["Using app", "Used app", "use the app"],
  computer_request_access: ["Requesting access", "Requested access", "request access"],
  computer_stop: ["Stopping Computer Use", "Stopped Computer Use", "stop Computer Use"],
  computer_screenshot: ["Taking screenshot", "Took screenshot", "take a screenshot"],
  computer_zoom: ["Zooming in", "Zoomed in", "zoom in"],
  computer_left_click: ["Clicking", "Clicked", "click"],
  computer_right_click: ["Right-clicking", "Right-clicked", "right-click"],
  computer_double_click: ["Double-clicking", "Double-clicked", "double-click"],
  computer_triple_click: ["Triple-clicking", "Triple-clicked", "triple-click"],
  computer_left_click_drag: ["Dragging", "Dragged", "drag"],
  computer_scroll: ["Scrolling", "Scrolled", "scroll"],
  computer_type: ["Typing", "Typed", "type"],
  computer_key: ["Pressing keys", "Pressed keys", "press keys"],
  computer_wait: ["Waiting", "Waited", "wait"],
} as const satisfies Record<string, readonly [string, string, string]>;

type ComputerToolName = keyof typeof COMPUTER_TOOL_WORDING;

const COMPUTER_TOOL_NAMES = new Set<string>(Object.keys(COMPUTER_TOOL_WORDING));
const PREVIEW_MAX_LENGTH = 80;

export const GLADE_COMPUTER_TOOL_PRESENTATIONS = Object.fromEntries(
  Object.entries(COMPUTER_TOOL_WORDING).map(([name, [running, completed, failed]]) => [
    `glade_${name}`,
    { running, completed, failed: `Couldn't ${failed}` },
  ]),
) as Record<
  `glade_${ComputerToolName}`,
  { readonly running: string; readonly completed: string; readonly failed: string }
>;

const bareName = (gladeToolName: string) => gladeToolName.replace(/^glade_/u, "");

export function isGladeComputerToolName(gladeToolName: string): boolean {
  return COMPUTER_TOOL_NAMES.has(bareName(gladeToolName));
}

// Bare gateway names, as some providers report them without the server prefix.
export function isBareComputerToolName(normalizedName: string): boolean {
  return COMPUTER_TOOL_NAMES.has(normalizedName);
}

export interface ComputerToolTarget {
  readonly app: string;
  readonly windowTitle: string | null;
}

const parseTitle = (quoted: string | undefined): string | null => {
  if (!quoted) return null;
  try {
    const title: unknown = JSON.parse(quoted);
    return typeof title === "string" && title.length > 0 ? title : null;
  } catch {
    return null;
  }
};

// The app and window a computer tool result names: action results end with
// `Window: <app> "<title>"`, window reads start with `<app> window <id> "<title>"`.
export function computerToolTarget(output: string): ComputerToolTarget | null {
  const lines = output.split("\n").map((line) => line.trim());
  const action = lines.findLast((line) => line.startsWith("Window: "));
  const match = action
    ? /^Window: (.+?) ("(?:[^"\\]|\\.)*")$/u.exec(action)
    : /^(.+?) window \d+ ("(?:[^"\\]|\\.)*")$/u.exec(lines[0] ?? "");
  if (!match?.[1]) return null;
  return { app: match[1], windowTitle: parseTitle(match[2]) };
}

// A compact result line, for example `"Save" button · TextEdit`.
export function computerToolResultPreview(gladeToolName: string, output: string): string | null {
  const tool = bareName(gladeToolName);
  if (!COMPUTER_TOOL_NAMES.has(tool)) return null;
  const target = computerToolTarget(output);
  if (!target) return null;
  if (tool === "computer_window_state") return target.app;
  // Cua's own action line, minus a verb the row heading already says.
  const completed = COMPUTER_TOOL_WORDING[tool as ComputerToolName][1];
  const first = output.split("\n")[0]?.trim() ?? "";
  const what =
    first === "Done." || first.startsWith("Window: ")
      ? ""
      : first
          .replace(new RegExp(`^${completed}\\s+`, "iu"), "")
          .replace(/\.$/u, "")
          .slice(0, PREVIEW_MAX_LENGTH);
  return what ? `${what} · ${target.app}` : target.app;
}
