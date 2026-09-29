import { Schema } from "effect";

// Nothing here may interpret a browser target as a desktop window id, and nothing here may trust a
// caller-provided session, transport, or ownership field — the host injects those.

export const COMPUTER_BROWSER_TOOL_NAMES = [
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

export type ComputerBrowserToolName = (typeof COMPUTER_BROWSER_TOOL_NAMES)[number];

export const COMPUTER_BROWSER_REFUSAL_CODES = [
  "browser_route_unavailable",
  "browser_requires_setup",
  "browser_binding_ambiguous",
  "browser_binding_stale",
  "browser_wrong_target_refused",
  "browser_tab_required",
  "browser_tab_not_found",
  "browser_ref_stale",
  "browser_input_trust_unavailable",
  "browser_endpoint_owner_mismatch",
  "browser_consent_required",
  "browser_consent_revoked",
  "browser_reconnect_exhausted",
  "browser_input_incomplete",
  "browser_action_unavailable",
  "browser_origin_outside_scope",
] as const;

export type ComputerBrowserRefusalCode = (typeof COMPUTER_BROWSER_REFUSAL_CODES)[number];

export const ComputerBrowserRefusal = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  detail: Schema.optional(Schema.Unknown),
});
export type ComputerBrowserRefusal = typeof ComputerBrowserRefusal.Type;

export const ComputerBrowserRefusedContent = Schema.Struct({
  status: Schema.Literal("refused"),
  refusal: ComputerBrowserRefusal,
});
export type ComputerBrowserRefusedContent = typeof ComputerBrowserRefusedContent.Type;

export const ComputerBrowserResultStatus = Schema.String;

export const ComputerBrowserTabInfo = Schema.Struct({
  tab_id: Schema.String,
});
export type ComputerBrowserTabInfo = typeof ComputerBrowserTabInfo.Type;

export const ComputerBrowserState = Schema.Struct({
  target_id: Schema.String,
  tabs: Schema.Array(ComputerBrowserTabInfo),
});
export type ComputerBrowserState = typeof ComputerBrowserState.Type;

export const COMPUTER_BROWSER_DRIVER_NAMES: Record<ComputerBrowserToolName, string> = {
  computer_browser_state: "get_browser_state",
  computer_browser_prepare: "browser_prepare",
  computer_browser_navigate: "browser_navigate",
  computer_browser_click: "browser_click",
  computer_browser_type: "browser_type",
  computer_browser_dialog: "browser_dialog",
  computer_browser_upload: "browser_set_input_files",
  computer_browser_download: "browser_download",
  computer_browser_pointer: "browser_pointer",
  computer_browser_press: "browser_type",
};
