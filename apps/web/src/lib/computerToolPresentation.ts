import { pluralize } from "@glade/shared/text/text";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
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
  computer_open_app: ["Opening", "Opened", "open the app"],
  computer_file_dialog: ["Saving file", "Saved", "save the file"],
  computer_window_state: ["Reading window", "Read window", "read the window"],
  computer_request_access: ["Requesting access", "Requested access", "get access"],
  computer_stop: ["Stopping Computer Use", "Stopped Computer Use", "stop Computer Use"],
  computer_screenshot: ["Taking screenshot", "Took screenshot", "take a screenshot"],
  computer_left_click: ["Clicking", "Clicked", "click"],
  computer_right_click: ["Right-clicking", "Right-clicked", "right-click"],
  computer_double_click: ["Double-clicking", "Double-clicked", "double-click"],
  computer_triple_click: ["Triple-clicking", "Triple-clicked", "triple-click"],
  computer_left_click_drag: ["Dragging", "Dragged", "drag"],
  computer_scroll: ["Scrolling", "Scrolled", "scroll"],
  computer_type: ["Typing", "Typed", "type"],
  computer_key: ["Pressing", "Pressed", "press keys"],
  computer_select_text: ["Selecting", "Selected", "select text"],
  computer_set_value: ["Setting value", "Set value", "set the value"],
  computer_menu: ["Choosing menu item", "Chose", "choose the menu item"],
  computer_verify: ["Checking window", "Checked window", "check the window"],
  computer_clipboard_write: [
    "Copying to clipboard",
    "Copied to clipboard",
    "copy to the clipboard",
  ],
  computer_clipboard_read: ["Reading clipboard", "Read clipboard", "read the clipboard"],
  computer_window_frame: ["Moving window", "Moved window", "move the window"],
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

interface ComputerToolTarget {
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

// The app and window a computer tool result names in its closing `Window: <app> "<title>"` line.
export function computerToolTarget(output: string): ComputerToolTarget | null {
  const line = stripUntrustedContent(output).findLast((entry) => entry.startsWith("Window: "));
  const match = line ? /^Window: (.+?) ("(?:[^"\\]|\\.)*")$/u.exec(line) : null;
  return match?.[1] ? { app: match[1], windowTitle: parseQuoted(match[2]) } : null;
}

// The row names only the app; the window title stays in the expanded output.
const targetLabel = (target: ComputerToolTarget | null) => target?.app ?? null;

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

// `File › Save As…` from a path given as an array or one "File > Save As…" string.
function menuPathLabel(path: unknown): string | null {
  const parts = Array.isArray(path)
    ? path.filter((part): part is string => typeof part === "string")
    : typeof path === "string"
      ? path.split(/\s*[>▸→]\s*/u)
      : [];
  return parts.length > 0 ? shortPreview(parts.join(" › ")) : null;
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

const VERIFY_STATUS = /^Status: (satisfied|unsatisfied|unknown)\b/u;

// `Confirmed "Saved" · TextEdit`: the first condition's label (or role) and the outcome.
function verifyPresentation(
  call: GatewayToolCall,
  lines: ReadonlyArray<string>,
  where: string | null,
): GatewayToolPresentation {
  const condition = Array.isArray(call.args.conditions)
    ? asObjectRecord(call.args.conditions[0])
    : null;
  const subject = condition
    ? (stringArg(condition, "label_contains") ?? stringArg(condition, "role"))
    : null;
  const preview = previewAt(subject ? `"${shortPreview(subject)}"` : null, where);
  const status = lines.map((line) => VERIFY_STATUS.exec(line)?.[1]).find(Boolean);
  if (call.status === "completed" && status) {
    return { heading: status === "satisfied" ? "Confirmed" : "Not confirmed", preview };
  }
  return presentGatewayToolCall(COMPUTER_TOOL_WORDING.computer_verify, call, preview);
}

// `Clicked "Save" · TextEdit`, `Read window · TextEdit`,
// `Access granted · TextEdit`. Element indices, the accessibility tree and Cua's report lines never
// reach the row.
export function describeComputerToolCall(call: GatewayToolCall): GatewayToolPresentation | null {
  if (!isComputerTool(call.tool)) return null;
  const lines = call.output ? stripUntrustedContent(call.output) : [];
  const where = targetLabel(call.output ? computerToolTarget(call.output) : null);
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
    case "computer_apps": {
      const count = Number(/^(\d+) running apps?\./u.exec(lines[0] ?? "")?.[1] ?? 0);
      const apps = `${count} ${pluralize(count, "app")}`;
      return presentGatewayToolCall(
        count > 0
          ? ["Listing apps", `Listed ${apps}`, "list apps"]
          : COMPUTER_TOOL_WORDING.computer_apps,
        call,
        null,
      );
    }
    case "computer_open_app": {
      // `Opened TextEdit`, `Opened bench.pdf · Preview`; a bundle id argument gives way to the
      // app name the result reports.
      const app =
        (call.output ? computerToolTarget(call.output)?.app : null) ?? stringArg(args, "app");
      const opened = Array.isArray(args.open)
        ? args.open.filter((entry): entry is string => typeof entry === "string")
        : [];
      const first = opened[0]?.split(/[\\/]/u).findLast(Boolean) ?? opened[0];
      const what = first
        ? shortPreview(opened.length > 1 ? `${first} +${opened.length - 1}` : first)
        : app;
      return presentGatewayToolCall(
        COMPUTER_TOOL_WORDING.computer_open_app,
        call,
        first ? previewAt(what, app) : what,
      );
    }
    case "computer_file_dialog": {
      // `Saved report.rtf · TextEdit`; the open action reads `Opened bench.pdf · Preview`.
      const fileName = stringArg(args, "file_name");
      const path = stringArg(args, "path");
      const file = fileName ?? path?.split(/[\\/]/u).findLast(Boolean) ?? null;
      const wording: GatewayToolWording =
        args.action === "open"
          ? ["Opening file", "Opened", "open the file"]
          : COMPUTER_TOOL_WORDING.computer_file_dialog;
      return presentGatewayToolCall(
        wording,
        call,
        previewAt(file ? shortPreview(file) : null, where),
      );
    }
    case "computer_verify":
      return verifyPresentation(call, lines, where);
    case "computer_left_click":
    case "computer_right_click":
    case "computer_double_click":
    case "computer_triple_click":
    case "computer_set_value":
      return presentGatewayToolCall(
        COMPUTER_TOOL_WORDING[call.tool],
        call,
        previewAt(actedElement(lines), where),
      );
    case "computer_type": {
      const element = actedElement(lines);
      return presentGatewayToolCall(
        COMPUTER_TOOL_WORDING.computer_type,
        call,
        previewAt(element ? `into ${element}` : null, where),
      );
    }
    case "computer_menu":
      return presentGatewayToolCall(
        COMPUTER_TOOL_WORDING.computer_menu,
        call,
        previewAt(menuPathLabel(args.menu_path), where),
      );
    case "computer_screenshot":
      return presentGatewayToolCall(
        Array.isArray(args.region)
          ? ["Zooming in", "Zoomed in", "zoom in"]
          : COMPUTER_TOOL_WORDING.computer_screenshot,
        call,
        previewAt(null, where),
      );
    case "computer_key":
      return presentGatewayToolCall(
        COMPUTER_TOOL_WORDING.computer_key,
        call,
        previewAt(stringArg(args, "text"), where),
      );
    case "computer_select_text": {
      // `Selected line · TextEdit`, `Selected 3 characters left · TextEdit`.
      const select = stringArg(args, "select")?.replace("_", " ") ?? null;
      const count = typeof args.count === "number" ? args.count : 1;
      const what =
        select === "left" || select === "right"
          ? `${count} ${pluralize(count, "character")} ${select}`
          : select;
      return presentGatewayToolCall(
        COMPUTER_TOOL_WORDING.computer_select_text,
        call,
        previewAt(what, where),
      );
    }
    case "computer_scroll":
      return presentGatewayToolCall(
        COMPUTER_TOOL_WORDING.computer_scroll,
        call,
        previewAt(stringArg(args, "scroll_direction"), where),
      );
    default:
      return presentGatewayToolCall(COMPUTER_TOOL_WORDING[call.tool], call, previewAt(null, where));
  }
}
