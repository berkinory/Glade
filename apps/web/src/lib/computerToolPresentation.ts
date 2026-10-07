import { pluralize } from "@glade/shared/text/text";
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

const COMPUTER_TOOL_WORDING = {
  computer_apps: ["Listing apps", "Listed apps", "list apps"],
  computer_window_state: ["Reading window", "Read window", "read the window"],
  computer_act: ["Using app", "Used app", "use the app"],
  computer_request_access: ["Requesting access", "Requested access", "get access"],
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
  computer_key: ["Pressing", "Pressed", "press keys"],
  computer_wait: ["Waiting", "Waited", "wait"],
} as const satisfies Record<string, GatewayToolWording>;

const ACT_WORDING = {
  click: COMPUTER_TOOL_WORDING.computer_left_click,
  double_click: COMPUTER_TOOL_WORDING.computer_double_click,
  right_click: COMPUTER_TOOL_WORDING.computer_right_click,
  type: COMPUTER_TOOL_WORDING.computer_type,
  press: COMPUTER_TOOL_WORDING.computer_key,
  scroll: COMPUTER_TOOL_WORDING.computer_scroll,
  set_value: ["Setting value", "Set value", "set the value"],
  menu: ["Choosing menu item", "Chose", "choose the menu item"],
} as const satisfies Record<string, GatewayToolWording>;

type ComputerToolName = keyof typeof COMPUTER_TOOL_WORDING;

const isComputerTool = (name: string): name is ComputerToolName =>
  Object.hasOwn(COMPUTER_TOOL_WORDING, name);

export const GLADE_COMPUTER_TOOL_PRESENTATIONS = Object.fromEntries(
  Object.entries(COMPUTER_TOOL_WORDING).map(([name, [running, completed, failed]]) => [
    `glade_${name}`,
    { running, completed, failed: `Couldn't ${failed}` },
  ]),
) as Record<
  `glade_${ComputerToolName}`,
  { readonly running: string; readonly completed: string; readonly failed: string }
>;

export function isGladeComputerToolName(gladeToolName: string): boolean {
  return isComputerTool(gladeToolName.replace(/^glade_/u, ""));
}

// Bare gateway names, as some providers report them without the server prefix.
export function isBareComputerToolName(normalizedName: string): boolean {
  return isComputerTool(normalizedName);
}

export interface ComputerToolTarget {
  readonly app: string;
  readonly windowTitle: string | null;
}

const parseQuoted = (quoted: string | undefined): string | null => {
  if (!quoted) return null;
  try {
    const value: unknown = JSON.parse(quoted);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
};

// The app and window a computer tool result names: action results end with
// `Window: <app> "<title>"`; a window read only names its app on its APP_CONTENT marker, since its
// header sits inside the block.
export function computerToolTarget(output: string): ComputerToolTarget | null {
  const action = stripUntrustedContent(output).findLast((line) => line.startsWith("Window: "));
  const match = action ? /^Window: (.+?) ("(?:[^"\\]|\\.)*")$/u.exec(action) : null;
  if (match?.[1]) return { app: match[1], windowTitle: parseQuoted(match[2]) };
  const marker = /^--- APP_CONTENT nonce=[0-9a-f]+ app=("(?:[^"\\]|\\.)*")/mu.exec(output);
  const app = parseQuoted(marker?.[1]);
  return app ? { app, windowTitle: null } : null;
}

// Cua names the element it acted on as `[3] AXButton "Save"`; show the label, or the role in words
// when the label is empty, never the index.
function actedElement(lines: ReadonlyArray<string>): string | null {
  for (const line of lines) {
    const match = /\[\d+\] AX([A-Za-z]+)(?: ("(?:[^"\\]|\\.)*"))?/u.exec(line);
    if (!match) continue;
    const label = parseQuoted(match[2]);
    if (label) return `"${shortPreview(label)}"`;
    return match[1]!.replace(/([a-z])([A-Z])/gu, "$1 $2").toLowerCase();
  }
  return null;
}

function actTarget(call: GatewayToolCall, lines: ReadonlyArray<string>): string | null {
  const { args } = call;
  switch (args.action) {
    case "press":
      return stringArg(args, "key");
    case "scroll":
      return stringArg(args, "direction");
    case "menu":
      return Array.isArray(args.menu_path)
        ? shortPreview(args.menu_path.filter((part) => typeof part === "string").join(" › "))
        : null;
    case "type": {
      const element = actedElement(lines);
      return element ? `into ${element}` : null;
    }
    default:
      return actedElement(lines);
  }
}

function accessPresentation(
  call: GatewayToolCall,
  lines: ReadonlyArray<string>,
): GatewayToolPresentation | null {
  const app = stringArg(call.args, "app");
  const first = lines[0] ?? "";
  if (call.status === "failed" && first.startsWith("The user denied")) {
    return { heading: "Access denied", preview: previewAt(null, app) };
  }
  if (call.status !== "completed") return null;
  if (first.startsWith("Granted:"))
    return { heading: "Access granted", preview: previewAt(null, app) };
  if (first.startsWith("Waiting for the user")) {
    return { heading: "Waiting for access", preview: previewAt(null, app) };
  }
  return null;
}

// `Clicked "Save" · TextEdit`, `Read window "Untitled" · TextEdit`, `Access granted · TextEdit`.
// Element indices, the accessibility tree and Cua's report lines never reach the row.
export function describeComputerToolCall(call: GatewayToolCall): GatewayToolPresentation | null {
  if (!isComputerTool(call.tool)) return null;
  const lines = call.output ? stripUntrustedContent(call.output) : [];
  const target = call.output ? computerToolTarget(call.output) : null;
  const app = target?.app ?? null;
  const { args } = call;
  switch (call.tool) {
    case "computer_request_access":
      return (
        accessPresentation(call, lines) ??
        presentGatewayToolCall(
          COMPUTER_TOOL_WORDING.computer_request_access,
          call,
          stringArg(args, "app") ? `to ${stringArg(args, "app")}` : null,
        )
      );
    case "computer_act": {
      const action = stringArg(args, "action");
      const wording =
        action && Object.hasOwn(ACT_WORDING, action)
          ? ACT_WORDING[action as keyof typeof ACT_WORDING]
          : COMPUTER_TOOL_WORDING.computer_act;
      return presentGatewayToolCall(wording, call, previewAt(actTarget(call, lines), app));
    }
    case "computer_window_state":
      return presentGatewayToolCall(
        COMPUTER_TOOL_WORDING.computer_window_state,
        call,
        target?.windowTitle
          ? previewAt(`"${shortPreview(target.windowTitle)}"`, app)
          : previewAt(null, app),
      );
    case "computer_apps": {
      const count = lines.filter((line) => /^\S.* pid \d+/u.test(line)).length;
      const apps = `${count} ${pluralize(count, "app")}`;
      return presentGatewayToolCall(
        count > 0
          ? ["Listing apps", `Listed ${apps}`, "list apps"]
          : COMPUTER_TOOL_WORDING.computer_apps,
        call,
        null,
      );
    }
    case "computer_key":
      return presentGatewayToolCall(
        COMPUTER_TOOL_WORDING.computer_key,
        call,
        previewAt(stringArg(args, "key"), app),
      );
    case "computer_scroll":
      return presentGatewayToolCall(
        COMPUTER_TOOL_WORDING.computer_scroll,
        call,
        previewAt(stringArg(args, "direction"), app),
      );
    case "computer_wait":
      return presentGatewayToolCall(
        COMPUTER_TOOL_WORDING.computer_wait,
        call,
        typeof args.seconds === "number" ? `${args.seconds}s` : null,
      );
    default:
      return presentGatewayToolCall(COMPUTER_TOOL_WORDING[call.tool], call, previewAt(null, app));
  }
}
