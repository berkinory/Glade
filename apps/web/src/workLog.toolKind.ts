import type { ToolLifecycleItemType } from "@glade/contracts/provider/runtimeMetadata";
import { classifyInspectCommand } from "./lib/toolCallLabel.commands";
import type { WorkLogEntry, WorkLogToolKind } from "./workLog.types";

// Providers report built-in read-only tools as generic dynamic calls, so their native names are the
// only signal for what they did. Keys are lowercase with punctuation removed.
const NATIVE_TOOL_KINDS: Readonly<Record<string, WorkLogToolKind>> = {
  read: "read",
  readfile: "read",
  viewfile: "read",
  notebookread: "read",
  grep: "search",
  codesearch: "search",
  glob: "list",
  ls: "list",
  listfiles: "list",
  listdirectory: "list",
  webfetch: "fetch",
  fetchurl: "fetch",
  websearch: "web_search",
};

const COMMAND_ACTION_KINDS: Readonly<Record<string, WorkLogToolKind>> = {
  read: "read",
  readfile: "read",
  listfiles: "list",
  search: "search",
  find: "search",
};

function normalizeToolKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function classifyWorkLogToolKind(input: {
  itemType: ToolLifecycleItemType | undefined;
  requestKind: WorkLogEntry["requestKind"];
  toolName: string | null | undefined;
  command: string | null | undefined;
  commandActionType: string | undefined;
}): WorkLogToolKind | undefined {
  const { itemType, requestKind, toolName, command } = input;
  if (itemType === "file_change" || requestKind === "file-change") return "edit";
  if (itemType === "collab_agent_tool_call") return "agent";
  if (itemType === "web_search") return "web_search";
  if (itemType === "image_view" || itemType === "image_generation") return itemType;
  const actionKind = input.commandActionType
    ? COMMAND_ACTION_KINDS[normalizeToolKey(input.commandActionType)]
    : undefined;
  if (actionKind) return actionKind;
  const nativeKind = toolName ? NATIVE_TOOL_KINDS[normalizeToolKey(toolName)] : undefined;
  if (nativeKind) return nativeKind;
  if (requestKind === "file-read") return "read";
  if (itemType === "command_execution" || requestKind === "command" || command) {
    return (command ? classifyInspectCommand(command) : null) ?? "command";
  }
  if (itemType === "mcp_tool_call") return "mcp";
  if (itemType === "dynamic_tool_call" || requestKind === "tool" || toolName) return "tool";
  return undefined;
}
