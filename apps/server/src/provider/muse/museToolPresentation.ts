import type { CanonicalItemType } from "@glade/contracts/provider/runtimeMetadata";

import type { MspItem } from "./mspProtocol.ts";

const COMMAND_TOOLS = new Set(["bash", "bash_input"]);
const FILE_CHANGE_TOOLS = new Set(["edit_file", "write_file"]);
const WEB_SEARCH_TOOLS = new Set(["web_search"]);

export interface MuseToolPresentation {
  readonly itemType: CanonicalItemType;
  readonly title: string;
  readonly data: Record<string, unknown>;
}

// The model authors tool arguments as JSON; a streaming or malformed value stays unparsed.
function parseArgs(args: string | undefined): Record<string, unknown> | undefined {
  if (!args) return undefined;
  try {
    const parsed: unknown = JSON.parse(args);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function itemTypeFor(item: MspItem): CanonicalItemType {
  if (item.kind === "webSearch") return "web_search";
  const tool = item.tool ?? "";
  if (COMMAND_TOOLS.has(tool)) return "command_execution";
  if (FILE_CHANGE_TOOLS.has(tool)) return "file_change";
  if (WEB_SEARCH_TOOLS.has(tool)) return "web_search";
  return "dynamic_tool_call";
}

// Muse names its built-in tools (`bash`, `read_file`, `edit_file`, ...); the web reads a row's
// command, paths and edits from `input`, so the arguments are passed through as the model wrote them.
export function museToolPresentation(item: MspItem, output: string): MuseToolPresentation {
  const itemType = itemTypeFor(item);
  const input = parseArgs(item.args) ?? {};
  const toolName = item.tool ?? item.kind;
  const title =
    item.kind === "subagent" ? item.objective?.trim() || item.role?.trim() || "Agent" : toolName;
  return {
    itemType,
    title,
    data: {
      toolCallId: item.callId ?? item.itemId,
      callId: item.callId ?? item.itemId,
      toolName,
      input,
      ...(output ? { output } : {}),
      ...(item.exitCode !== undefined ? { exitCode: item.exitCode } : {}),
      ...(item.patchSummary ? { patchSummary: item.patchSummary } : {}),
      ...(item.failureReason ? { failureReason: item.failureReason } : {}),
    },
  };
}
