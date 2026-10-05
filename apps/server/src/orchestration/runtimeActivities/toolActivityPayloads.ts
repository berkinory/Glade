import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { asRecord } from "@glade/shared/transport/payloadValues";
import {
  isSensitiveKey,
  REDACTED_SENSITIVE_VALUE,
  redactSensitiveJsonFields,
} from "../../diagnostics/sensitiveKeys.ts";
import { asString } from "@glade/shared/text/text";
import {
  ActivityPayload,
  MAX_ACTIVITY_DATA_STRING_CHARS,
  toActivityPayload,
  truncateDetail,
  boundActivityData,
  truncateJsonString,
} from "./activityPayloads";

export function buildToolProgressActivityPayload(
  event: Extract<ProviderRuntimeEvent, { type: "tool.progress" }>,
): ActivityPayload {
  const summary = event.payload.summary
    ? truncateDetail(event.payload.summary, MAX_ACTIVITY_DATA_STRING_CHARS)
    : undefined;
  return toActivityPayload({
    itemType: "mcp_tool_call" as const,
    title: "MCP tool call",
    ...(summary ? { detail: summary } : {}),
    data: boundActivityData({
      ...(event.payload.toolUseId ? { toolUseId: event.payload.toolUseId } : {}),
      ...(event.payload.toolName ? { toolName: event.payload.toolName } : {}),
      ...(summary ? { summary } : {}),
      ...(event.payload.elapsedSeconds !== undefined
        ? { elapsedSeconds: event.payload.elapsedSeconds }
        : {}),
    }),
  });
}

export function requestKindFromCanonicalRequestType(
  requestType: string | undefined,
): "command" | "file-read" | "file-change" | "permissions" | "tool" | undefined {
  if (requestType === "command_execution_approval" || requestType === "exec_command_approval")
    return "command";
  if (requestType === "file_read_approval") return "file-read";
  if (requestType === "permissions_approval") return "permissions";
  if (requestType === "tool_approval") return "tool";

  if (requestType === "dynamic_tool_call") return "tool";
  return requestType === "file_change_approval" || requestType === "apply_patch_approval"
    ? "file-change"
    : undefined;
}

export function requestedPermissionProfile(
  event: Extract<ProviderRuntimeEvent, { type: "request.opened" }>,
): Record<string, unknown> | undefined {
  if (event.payload.requestType !== "permissions_approval") {
    return undefined;
  }
  const args = asRecord(event.payload.args) ?? undefined;
  const permissions = asRecord(args?.permissions) ?? undefined;
  return permissions && Object.keys(permissions).length > 0
    ? (boundActivityData(permissions) as Record<string, unknown>)
    : undefined;
}

export function sessionApprovalAvailable(
  event: Extract<ProviderRuntimeEvent, { type: "request.opened" }>,
): boolean | undefined {
  const args = asRecord(event.payload.args) ?? undefined;
  return typeof args?.sessionApprovalAvailable === "boolean"
    ? args.sessionApprovalAvailable
    : undefined;
}

function toolParamsDisplayFromToolInput(
  input: Record<string, unknown> | undefined,
): ReadonlyArray<{ readonly name: string; readonly value: unknown }> | undefined {
  if (!input) {
    return undefined;
  }
  const entries = Object.entries(input).map(([name, value]) => ({ name, value }));
  return entries.length > 0 ? entries : undefined;
}

function toolParamDisplayValue(names: ReadonlyArray<string | undefined>, value: unknown): string {
  if (names.some((name) => name !== undefined && isSensitiveKey(name))) {
    return REDACTED_SENSITIVE_VALUE;
  }
  if (typeof value === "string") {
    return redactStructuredToolParamString(value);
  }

  return safeStringifyToolParamValue(value) ?? String(value);
}

// Codex can supply already-formatted parameter strings. Inspect a complete JSON object or array,
// but leave ordinary strings and JSON without secrets unchanged.
function redactStructuredToolParamString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") {
      return value;
    }
    let redacted = false;
    const serialized = JSON.stringify(parsed, (key, entry: unknown) => {
      if (isSensitiveKey(key)) {
        redacted = true;
      }
      return redactSensitiveJsonFields(key, entry);
    });
    return redacted ? serialized : value;
  } catch {
    return value;
  }
}

function safeStringifyToolParamValue(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, redactSensitiveJsonFields);
  } catch {
    return undefined;
  }
}

export function requestedMcpToolCallPresentation(
  event: Extract<ProviderRuntimeEvent, { type: "request.opened" }>,
): { title?: string; toolName?: string; toolParamsDisplay?: unknown } {
  if (
    event.payload.requestType !== "tool_approval" &&
    event.payload.requestType !== "dynamic_tool_call"
  ) {
    return {};
  }
  const args = asRecord(event.payload.args) ?? undefined;

  const metadata = asRecord(args?._meta) ?? undefined;
  const title = asString(metadata?.tool_title);
  const toolName = asString(metadata?.tool_name) ?? asString(args?.toolName);
  const rawParams = Array.isArray(metadata?.tool_params_display)
    ? metadata.tool_params_display
    : toolParamsDisplayFromToolInput(asRecord(args?.input) ?? undefined);

  const toolParamsDisplay = rawParams?.slice(0, 12).map((entry) => {
    const row = asRecord(entry) ?? undefined;
    const name = asString(row?.name);
    const displayName = asString(row?.display_name);
    return {
      ...(displayName ? { display_name: truncateJsonString(displayName, 128) } : {}),
      name: truncateJsonString(name ?? "argument", 128),
      value: truncateJsonString(toolParamDisplayValue([name, displayName], row?.value), 900),
    };
  });
  return {
    ...(title ? { title: truncateJsonString(title, 128) } : {}),
    ...(toolName ? { toolName } : {}),
    ...(toolParamsDisplay !== undefined ? { toolParamsDisplay } : {}),
  };
}
