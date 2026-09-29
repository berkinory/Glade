import type { ProviderInteractionMode, RuntimeMode } from "@glade/contracts";

export const GLADE_COMPUTER_TOOL_NAMES = [
  "computer_activate_window",
  "computer_click",
  "computer_drag",
  "computer_get_accessibility_tree",
  "computer_get_cursor_position",
  "computer_get_screen_size",
  "computer_get_state",
  "computer_help",
  "computer_inspect",
  "computer_spaces",
  "computer_invoke_menu",
  "computer_kill_app",
  "computer_launch_app",
  "computer_list_apps",
  "computer_list_windows",
  "computer_move_cursor",
  "computer_paste",
  "computer_perform_action",
  "computer_press_key",
  "computer_read_clipboard",
  "computer_run",
  "computer_screenshot",
  "computer_scroll",
  "computer_select_text",
  "computer_set_app_visibility",
  "computer_set_value",
  "computer_set_window_frame",
  "computer_set_window_minimized",
  "computer_type_text",
  "computer_verify_state",
  "computer_wait",
  "computer_write_clipboard",
  "computer_zoom",
  // Deliberately inside the Computer namespace: these are the same capability (computer:control), the
  // same approval gate, and the same denial-card path as the desktop tools — they merely dispatch
  // over CDP rather than OS events. They must never collide with the integrated `browser_*` surface,
  // which is a different host.
  "computer_browser_state",
  "computer_browser_prepare",
  "computer_browser_navigate",
  "computer_browser_click",
  "computer_browser_type",
  "computer_browser_dialog",
  "computer_browser_upload",
  "computer_browser_download",
  "computer_browser_pointer",
  "computer_browser_press",
] as const;

export type GladeComputerToolName = (typeof GLADE_COMPUTER_TOOL_NAMES)[number];

const GLADE_COMPUTER_TOOL_NAME_SET = new Set<string>(GLADE_COMPUTER_TOOL_NAMES);

function recordString(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = Reflect.get(value, key);
  return typeof candidate === "string" ? candidate : undefined;
}

export function canonicalGladeComputerToolName(value: unknown): GladeComputerToolName | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  const canonical = normalized.startsWith("mcp__glade__")
    ? normalized.slice("mcp__glade__".length)
    : normalized.startsWith("glade_")
      ? normalized.slice("glade_".length)
      : normalized;
  return GLADE_COMPUTER_TOOL_NAME_SET.has(canonical)
    ? (canonical as GladeComputerToolName)
    : undefined;
}

export function qualifiedGladeComputerToolName(value: unknown): GladeComputerToolName | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith("mcp__glade__") && !normalized.startsWith("glade_")) {
    return undefined;
  }
  return canonicalGladeComputerToolName(normalized);
}

// Denied sessions must still surface the computer permission card for exact owned tool names,
// including native prefixes. Foreign or unknown names retain ordinary permission and INVALID_PARAMS
// handling.
export function isGladeComputerToolFamilyName(value: unknown): boolean {
  return canonicalGladeComputerToolName(value) !== undefined;
}

function firstRecordString(value: unknown, keys: ReadonlyArray<string>): string | undefined {
  for (const key of keys) {
    const candidate = recordString(value, key);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

export function computerToolNameFromProviderPermission(input: {
  readonly name?: unknown;
  readonly title?: unknown;
  readonly rawInput?: unknown;
  readonly metadata?: unknown;
}): GladeComputerToolName | undefined {
  const explicitName = typeof input.name === "string" ? input.name : undefined;
  if (explicitName !== undefined) return qualifiedGladeComputerToolName(explicitName);

  const rawToolName = firstRecordString(input.rawInput, ["_toolName", "toolName", "tool_name"]);
  if (rawToolName !== undefined) return qualifiedGladeComputerToolName(rawToolName);

  const metadataToolName = firstRecordString(input.metadata, [
    "_toolName",
    "toolName",
    "tool_name",
  ]);
  if (metadataToolName !== undefined) return qualifiedGladeComputerToolName(metadataToolName);

  return qualifiedGladeComputerToolName(input.title);
}

export function shouldAllowGladeComputerProviderTool(input: {
  readonly computerControlEnabled: boolean;
  readonly activeTurn: boolean;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly permission: Parameters<typeof computerToolNameFromProviderPermission>[0];
}): boolean {
  return (
    input.computerControlEnabled &&
    input.activeTurn &&
    input.runtimeMode === "approval-required" &&
    input.interactionMode === "default" &&
    computerToolNameFromProviderPermission(input.permission) !== undefined
  );
}
