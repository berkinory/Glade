import type { ToolLifecycleItemType } from "@glade/contracts/provider/runtimeMetadata";
import { BROWSER_TOOL_TITLES } from "@glade/shared/browser/browserAutomationPresentation";
import type { ComputerToolName } from "./computerToolPresentation";
import { extractToolArgumentField } from "./toolArgumentSummary";

export function normalizeCompactToolLabel(value: string): string {
  return value
    .trimEnd()
    .replace(/\s(?:complete|completed|done|finished|success|succeeded|started|running)$/i, "")
    .trim();
}

export function normalizeToolTextForComparison(value: string | undefined): string {
  return normalizeCompactToolLabel(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const WEB_FETCH_TOOL_NAMES = new Set(["webfetch", "fetch", "urlfetch", "fetchurl", "httpfetch"]);

function isWebFetchToolName(toolName: string | null | undefined): boolean {
  if (!toolName) {
    return false;
  }
  const normalized = toolName.toLowerCase().replace(/[^a-z]/g, "");
  if (WEB_FETCH_TOOL_NAMES.has(normalized)) {
    return true;
  }
  return (
    normalized.includes("fetch") &&
    (normalized.includes("web") || normalized.includes("url") || normalized.includes("http"))
  );
}

export function extractWebFetchUrl(input: {
  readonly toolName?: string | null | undefined;
  readonly detail?: string | null | undefined;
}): string | null {
  if (!isWebFetchToolName(input.toolName)) {
    return null;
  }
  const detail = input.detail;
  if (!detail) {
    return null;
  }
  const candidate =
    extractToolArgumentField(detail, ["url", "uri"]) ??
    /https?:\/\/[^\s"'<>)\]}]+/i.exec(detail)?.[0]?.replace(/[.,;:!?]+$/, "");
  if (candidate && /^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  return null;
}

export function humanizeMcpToolIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("mcp__")) {
    return null;
  }

  const [, server, tool, ...rest] = trimmed.split("__");
  const normalizedServer = humanizeMcpToken(server);
  const normalizedTool = [tool, ...rest]
    .map((part) => humanizeMcpToken(part))
    .filter((part) => part.length > 0)
    .join(" ");

  if (!normalizedServer || !normalizedTool) {
    return null;
  }
  return `${normalizedServer}: ${normalizedTool}`;
}

export function humanizeMcpServerTool(server: string, tool: string): string | null {
  const normalizedServer = humanizeMcpToken(server);
  const normalizedTool = humanizeMcpToken(tool);
  if (!normalizedServer || !normalizedTool) {
    return null;
  }
  return `${normalizedServer}: ${normalizedTool}`;
}

export interface ReadableToolTitleInput {
  readonly title?: string | null;
  readonly fallbackLabel: string;
  readonly itemType?: ToolLifecycleItemType | undefined;
  readonly requestKind?:
    | "command"
    | "file-read"
    | "file-change"
    | "permissions"
    | "tool"
    | undefined;
  readonly command?: string | null;
  readonly payload?: Record<string, unknown> | null;
  readonly isRunning?: boolean;
}

export interface GladeMcpToolPresentation {
  readonly running: string;
  readonly completed: string;
  readonly failed: string;
}

const BROWSER_HISTORY_TITLES = {
  ...BROWSER_TOOL_TITLES,
  browser_snapshot: "Snapshot browser page",
  browser_webmcp_tools: "Discover page WebMCP tools",
  browser_webmcp_call: "Call page WebMCP tool",
  browser_click: "Click browser target",
  browser_hover: "Hover browser target",
  browser_drag: "Drag between browser targets",
  browser_type: "Type into browser target",
  browser_select: "Select browser options",
  browser_press: "Press browser keys",
  browser_scroll: "Scroll browser page",
  browser_wait: "Wait for browser condition",
  browser_evaluate: "Evaluate browser expression",
} as const;

type BrowserHistoryToolName = keyof typeof BROWSER_HISTORY_TITLES;

type GladeBrowserToolName = `glade_${BrowserHistoryToolName}`;

const BROWSER_HISTORY_TOOL_NAMES = Object.keys(BROWSER_HISTORY_TITLES) as BrowserHistoryToolName[];

const BROWSER_TOOL_NAME_SET = new Set<string>(BROWSER_HISTORY_TOOL_NAMES);

const GLADE_BROWSER_TOOL_PRESENTATIONS = Object.fromEntries(
  BROWSER_HISTORY_TOOL_NAMES.map((toolName) => {
    const title = BROWSER_HISTORY_TITLES[toolName];
    return [`glade_${toolName}`, { running: title, completed: title, failed: title }];
  }),
) as Record<GladeBrowserToolName, GladeMcpToolPresentation>;

// Every browser tool had a curated presentation and every computer tool had none, so the most
// consequential rows in the transcript — an agent moving a pointer on the user's own machine — fell
// through to the invented "Glade is handling computer click" fallback. The wording deliberately
// keeps the machine in the sentence ("this computer's desktop") rather than saying "the desktop",
// because on the backends that matter it is the user's own.
const GLADE_COMPUTER_TOOL_PRESENTATIONS = {
  glade_computer_screenshot: presentComputerTool("taking a screenshot", "took a screenshot"),
  glade_computer_get_state: presentComputerTool("reading the screen", "read the screen"),
  glade_computer_get_screen_size: presentComputerTool(
    "measuring the screen",
    "measured the screen",
  ),
  glade_computer_list_windows: presentComputerTool("listing windows", "listed the windows"),
  glade_computer_list_apps: presentComputerTool("listing apps", "listed the apps"),
  glade_computer_verify_state: presentComputerTool(
    "checking desktop state",
    "checked desktop state",
  ),
  glade_computer_zoom: presentComputerTool("zooming into a window", "zoomed into a window"),
  glade_computer_get_accessibility_tree: presentComputerTool(
    "listing apps and windows",
    "listed apps and windows",
  ),
  glade_computer_get_cursor_position: presentComputerTool(
    "reading the cursor position",
    "read the cursor position",
  ),
  glade_computer_help: presentComputerTool(
    "reading the Computer playbook",
    "read the Computer playbook",
  ),
  glade_computer_click: presentComputerTool("clicking the desktop", "clicked the desktop"),
  glade_computer_move_cursor: presentComputerTool("moving the cursor", "moved the cursor"),
  glade_computer_drag: presentComputerTool("dragging on the desktop", "dragged on the desktop"),
  glade_computer_scroll: presentComputerTool("scrolling the desktop", "scrolled the desktop"),
  glade_computer_type_text: presentComputerTool("typing on the desktop", "typed on the desktop"),
  glade_computer_press_key: presentComputerTool("pressing a key", "pressed a key"),
  glade_computer_set_value: presentComputerTool("setting a field", "set a field"),
  glade_computer_select_text: presentComputerTool("selecting text", "selected text"),
  glade_computer_perform_action: presentComputerTool("activating a control", "activated a control"),
  glade_computer_launch_app: presentComputerTool("opening an app", "opened an app"),
  glade_computer_activate_window: presentComputerTool("activating a window", "activated a window"),
  glade_computer_set_window_frame: presentComputerTool(
    "moving or resizing a window",
    "moved or resized a window",
  ),
  glade_computer_invoke_menu: presentComputerTool("invoking a menu item", "invoked a menu item"),
  glade_computer_kill_app: presentComputerTool("force-quitting an app", "force-quit an app"),
  glade_computer_set_window_minimized: presentComputerTool(
    "changing a window's visibility",
    "changed a window's visibility",
  ),
  glade_computer_set_app_visibility: presentComputerTool(
    "changing an app's visibility",
    "changed an app's visibility",
  ),
  glade_computer_wait: presentComputerTool("waiting for the desktop", "waited for the desktop"),
  glade_computer_read_clipboard: presentComputerTool("reading the clipboard", "read the clipboard"),
  glade_computer_write_clipboard: presentComputerTool(
    "writing to the clipboard",
    "wrote to the clipboard",
  ),
  glade_computer_paste: presentComputerTool("pasting text", "pasted text"),
  glade_computer_run: presentComputerTool("running a desktop sequence", "ran a desktop sequence"),
  glade_computer_inspect: presentComputerTool("inspecting the computer", "inspected the computer"),
  glade_computer_spaces: presentComputerTool(
    "inspecting desktop Spaces",
    "inspected desktop Spaces",
  ),
  glade_computer_browser_state: presentComputerTool(
    "reading the browser page",
    "read the browser page",
  ),
  glade_computer_browser_prepare: presentComputerTool("preparing a browser", "prepared a browser"),
  glade_computer_browser_navigate: presentComputerTool(
    "opening a browser page",
    "opened a browser page",
  ),
  glade_computer_browser_click: presentComputerTool(
    "clicking in the browser",
    "clicked in the browser",
  ),
  glade_computer_browser_type: presentComputerTool(
    "typing in a browser field",
    "typed in a browser field",
  ),
  glade_computer_browser_dialog: presentComputerTool(
    "handling a browser dialog",
    "handled a browser dialog",
  ),
  glade_computer_browser_upload: presentComputerTool(
    "attaching files in the browser",
    "attached files in the browser",
  ),
  glade_computer_browser_download: presentComputerTool("downloading a file", "downloaded a file"),
  glade_computer_browser_pointer: presentComputerTool(
    "using the pointer in the browser",
    "used the pointer in the browser",
  ),
  glade_computer_browser_press: presentComputerTool(
    "pressing Enter in the browser",
    "pressed Enter in the browser",
  ),
} as const satisfies Record<`glade_${ComputerToolName}`, GladeMcpToolPresentation>;

function presentComputerTool(present: string, past: string): GladeMcpToolPresentation {
  return {
    running: `Glade is ${present}`,
    completed: `Glade ${past}`,
    failed: `Glade couldn't finish ${present}`,
  };
}

export const GLADE_MCP_TOOL_PRESENTATIONS = {
  glade_context: {
    running: "Glade is checking its context",
    completed: "Glade checked its context",
    failed: "Glade couldn't check its context",
  },
  glade_capabilities: {
    running: "Glade is checking available agents",
    completed: "Glade checked available agents",
    failed: "Glade couldn't check available agents",
  },
  glade_overview: {
    running: "Glade is gathering an overview",
    completed: "Glade gathered an overview",
    failed: "Glade couldn't gather an overview",
  },
  glade_list_allowed_projects: {
    running: "Glade is listing allowed projects",
    completed: "Glade listed allowed projects",
    failed: "Glade couldn't list allowed projects",
  },
  glade_create_task: {
    running: "Glade is creating a task",
    completed: "Glade created a task",
    failed: "Glade couldn't create a task",
  },
  glade_wait_for_task: {
    running: "Glade is waiting for a task",
    completed: "Glade finished waiting for a task",
    failed: "Glade couldn't wait for a task",
  },
  glade_read_task: {
    running: "Glade is reading a task",
    completed: "Glade read a task",
    failed: "Glade couldn't read a task",
  },
  glade_list_projects: {
    running: "Glade is listing projects",
    completed: "Glade listed projects",
    failed: "Glade couldn't list projects",
  },
  glade_list_threads: {
    running: "Glade is listing threads",
    completed: "Glade listed threads",
    failed: "Glade couldn't list threads",
  },
  glade_read_thread: {
    running: "Glade is reading a thread",
    completed: "Glade read a thread",
    failed: "Glade couldn't read a thread",
  },
  glade_read_thread_activity: {
    running: "Glade is reading thread activity",
    completed: "Glade read thread activity",
    failed: "Glade couldn't read thread activity",
  },
  glade_read_thread_events: {
    running: "Glade is reading thread events",
    completed: "Glade read thread events",
    failed: "Glade couldn't read thread events",
  },
  glade_read_thread_runtime_events: {
    running: "Glade is reading thread runtime events",
    completed: "Glade read thread runtime events",
    failed: "Glade couldn't read thread runtime events",
  },
  glade_diagnose_thread: {
    running: "Glade is diagnosing a thread",
    completed: "Glade diagnosed a thread",
    failed: "Glade couldn't diagnose a thread",
  },
  glade_create_thread: {
    running: "Glade is creating a thread",
    completed: "Glade created a thread",
    failed: "Glade couldn't create a thread",
  },
  glade_create_threads: {
    running: "Glade is creating threads",
    completed: "Glade created threads",
    failed: "Glade couldn't create threads",
  },
  glade_wait_for_threads: {
    running: "Glade is waiting for threads",
    completed: "Glade finished waiting for threads",
    failed: "Glade couldn't wait for threads",
  },
  glade_send_message: {
    running: "Glade is sending a message",
    completed: "Glade sent a message",
    failed: "Glade couldn't send a message",
  },
  glade_interrupt_thread: {
    running: "Glade is interrupting a thread",
    completed: "Glade interrupted a thread",
    failed: "Glade couldn't interrupt a thread",
  },
  glade_set_thread_title: {
    running: "Glade is renaming a thread",
    completed: "Glade renamed a thread",
    failed: "Glade couldn't rename a thread",
  },
  glade_set_thread_archived: {
    running: "Glade is updating a thread",
    completed: "Glade updated a thread",
    failed: "Glade couldn't update a thread",
  },
  glade_create_automation: {
    running: "Glade is creating an automation",
    completed: "Glade created an automation",
    failed: "Glade couldn't create an automation",
  },
  glade_list_automations: {
    running: "Glade is listing automations",
    completed: "Glade listed automations",
    failed: "Glade couldn't list automations",
  },
  glade_view_automation: {
    running: "Glade is viewing an automation",
    completed: "Glade viewed an automation",
    failed: "Glade couldn't view an automation",
  },
  glade_update_automation: {
    running: "Glade is updating an automation",
    completed: "Glade updated an automation",
    failed: "Glade couldn't update an automation",
  },
  glade_update_automation_memory: {
    running: "Glade is updating automation memory",
    completed: "Glade updated automation memory",
    failed: "Glade couldn't update automation memory",
  },
  glade_report_automation_result: {
    running: "Glade is reporting an automation result",
    completed: "Glade reported an automation result",
    failed: "Glade couldn't report an automation result",
  },
  glade_cancel_automation: {
    running: "Glade is stopping an automation",
    completed: "Glade stopped an automation",
    failed: "Glade couldn't stop an automation",
  },
  ...GLADE_BROWSER_TOOL_PRESENTATIONS,
  ...GLADE_COMPUTER_TOOL_PRESENTATIONS,
} as const satisfies Record<string, GladeMcpToolPresentation>;

export function normalizeGladeMcpIdentifier(value: string): string {
  return value
    .replace(/\bglade\b/gi, "glade")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const GLADE_BROWSER_TOOL_NAME_BY_PRESENTATION = new Map<string, GladeBrowserToolName>(
  BROWSER_HISTORY_TOOL_NAMES.map((toolName) => [
    normalizeGladeMcpIdentifier(BROWSER_HISTORY_TITLES[toolName]),
    `glade_${toolName}`,
  ]),
);

export const GLADE_MCP_TOOL_PRESENTATION_ENTRIES = Object.entries(GLADE_MCP_TOOL_PRESENTATIONS).map(
  ([toolName, presentation]) => ({
    toolName,
    presentation,
    normalizedRunning: normalizeGladeMcpIdentifier(presentation.running),
    normalizedCompleted: normalizeGladeMcpIdentifier(presentation.completed),
    normalizedFailed: normalizeGladeMcpIdentifier(presentation.failed),
  }),
);

export function extractGladeMcpToolName(normalizedCandidate: string): string | null {
  if (BROWSER_TOOL_NAME_SET.has(normalizedCandidate)) {
    return `glade_${normalizedCandidate}`;
  }
  if (normalizedCandidate.startsWith("mcp_glade_glade_")) {
    return normalizedCandidate.slice("mcp_glade_".length);
  }
  if (normalizedCandidate.startsWith("mcp_glade_")) {
    return `glade_${normalizedCandidate.slice("mcp_glade_".length)}`;
  }
  if (normalizedCandidate.startsWith("glade_glade_")) {
    return normalizedCandidate.slice("glade_".length);
  }
  if (normalizedCandidate.startsWith("glade_")) {
    return normalizedCandidate;
  }
  return null;
}

export function resolveGladeBrowserToolName(
  candidates: ReadonlyArray<string | null | undefined>,
): GladeBrowserToolName | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalizedCandidate = normalizeGladeMcpIdentifier(candidate);
    const extractedToolName = extractGladeMcpToolName(normalizedCandidate);
    const candidateToolName =
      extractedToolName ??
      GLADE_BROWSER_TOOL_NAME_BY_PRESENTATION.get(normalizedCandidate) ??
      normalizedCandidate;
    if (candidateToolName in GLADE_BROWSER_TOOL_PRESENTATIONS) {
      return candidateToolName as GladeBrowserToolName;
    }
  }
  return null;
}

export function fallbackGladeMcpToolPresentation(toolName: string): GladeMcpToolPresentation {
  const action =
    toolName
      .replace(/^glade_/, "")
      .replace(/_+/g, " ")
      .trim() || "an action";
  return {
    running: `Glade is handling ${action}`,
    completed: `Glade handled ${action}`,
    failed: `Glade couldn't handle ${action}`,
  };
}

export function humanizeMcpToken(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .split(" ")
    .map((token) => {
      const lower = token.toLowerCase();
      if (lower === "mcp") return "MCP";
      if (token.toUpperCase() === token && token.length <= 5) return token;
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}
