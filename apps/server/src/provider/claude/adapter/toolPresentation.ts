import {
  type CanonicalItemType,
  type CanonicalRequestType,
} from "@glade/contracts/provider/runtimeMetadata";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  ToolInFlight,
  ClaudeToolResultStreamKind,
  type ClaudeSessionContext,
} from "./sessionTypes";
import { extractTextContent } from "./messageContent";
import { subagentName } from "@glade/shared/threads/subagentName";
import { isSupportedLocalImagePath } from "@glade/shared/attachments/localPreviewFiles";
import { asRecord } from "@glade/shared/transport/payloadValues";

// Only the SDK's own launcher spawns a subagent; MCP or custom tools that mention "agent" are ordinary
// tools and must not open child threads.
export function isClaudeSubagentTool(toolName: string): boolean {
  return toolName === "Task" || toolName === "Agent";
}

const IMAGE_GENERATION_TOOL_NAMES = new Set(["image_gen", "image_edit", "generate_image"]);

export function classifyToolItemType(toolName: string): CanonicalItemType {
  const normalized = toolName.toLowerCase();
  // Match the bare tool name of `mcp__<server>__<tool>` exactly, before the broad "edit" check turns
  // `image_edit` into a file change.
  if (IMAGE_GENERATION_TOOL_NAMES.has(normalized.replace(/^mcp__.+?__/, ""))) {
    return "image_generation";
  }
  if (
    normalized === "todowrite" ||
    normalized.includes("todo") ||
    normalized === "taskcreate" ||
    normalized === "taskupdate" ||
    normalized === "taskget" ||
    normalized === "tasklist"
  ) {
    return "plan";
  }
  if (isClaudeSubagentTool(toolName) || toolName === "SendMessage") {
    return "collab_agent_tool_call";
  }
  if (
    normalized.includes("bash") ||
    normalized.includes("command") ||
    normalized.includes("shell") ||
    normalized.includes("terminal")
  ) {
    return "command_execution";
  }
  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("file") ||
    normalized.includes("patch") ||
    normalized.includes("replace") ||
    normalized.includes("create") ||
    normalized.includes("delete")
  ) {
    return "file_change";
  }
  if (normalized.includes("mcp")) {
    return "mcp_tool_call";
  }
  if (normalized.includes("websearch") || normalized.includes("web search")) {
    return "web_search";
  }
  if (normalized.includes("image")) {
    return "image_view";
  }
  return "dynamic_tool_call";
}

function isReadOnlyToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return (
    normalized === "read" ||
    normalized.includes("read file") ||
    normalized.includes("view") ||
    normalized.includes("grep") ||
    normalized.includes("glob") ||
    normalized.includes("search")
  );
}

export function classifyRequestType(toolName: string): CanonicalRequestType {
  if (toolName.startsWith("mcp__")) {
    return "tool_approval";
  }
  if (isReadOnlyToolName(toolName)) {
    return "file_read_approval";
  }
  const itemType = classifyToolItemType(toolName);

  return itemType === "command_execution"
    ? "command_execution_approval"
    : itemType === "file_change"
      ? "file_change_approval"
      : "tool_approval";
}

export function summarizeToolRequest(
  toolName: string,
  input: Record<string, unknown>,
  serializedInput = JSON.stringify(input),
): string {
  const commandValue = input.command ?? input.cmd;
  const command = typeof commandValue === "string" ? commandValue : undefined;
  if (command && command.trim().length > 0) {
    return `${toolName}: ${command.trim().slice(0, 400).trimEnd()}`;
  }
  if (serializedInput.length <= 400) {
    return `${toolName}: ${serializedInput}`;
  }
  return `${toolName}: ${serializedInput.slice(0, 397)}...`;
}

export function isClientSurfacedClaudeTool(toolName: string): boolean {
  return toolName === "AskUserQuestion";
}

export function toolLifecycleEventData(
  context: Pick<ClaudeSessionContext, "subagentToolUseIdByAgentId">,
  tool: Pick<ToolInFlight, "itemId" | "toolName" | "input">,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    toolCallId: tool.itemId,
    callId: tool.itemId,
    toolName: tool.toolName,
    input: tool.input,
    ...(isClaudeSubagentTool(tool.toolName) ? subagentReceiverData(tool) : {}),
    ...(tool.toolName === "SendMessage" ? resumedSubagentData(context, tool) : {}),
    ...extra,
  };
}

// Claude reads an image file with its generic Read tool and gets the image back as a block that is
// stripped at ingress, so the file it named is what the transcript can show.
export function viewedImagePath(
  tool: Pick<ToolInFlight, "input">,
  result: Record<string, unknown>,
): string | undefined {
  const path = tool.input.file_path;
  return typeof path === "string" &&
    isSupportedLocalImagePath(path) &&
    Array.isArray(result.content) &&
    result.content.some((block) => asRecord(block)?.type === "image")
    ? path
    : undefined;
}

// SendMessage addresses a subagent by its agent id; naming the Task call that launched it puts the
// follow-up on the subagent's existing child thread instead of a new one.
function resumedSubagentData(
  context: Pick<ClaudeSessionContext, "subagentToolUseIdByAgentId">,
  tool: Pick<ToolInFlight, "input">,
): Record<string, unknown> {
  const agentId = tool.input.to;
  const toolUseId =
    typeof agentId === "string" ? context.subagentToolUseIdByAgentId.get(agentId) : undefined;
  return toolUseId
    ? { tool: "sendInput", receiverThreadId: toolUseId, nickname: subagentName(toolUseId) }
    : { tool: "sendInput" };
}

function subagentReceiverData(
  tool: Pick<ToolInFlight, "itemId" | "input">,
): Record<string, unknown> {
  const {
    subagent_type: subagentType,
    prompt,
    model,
    run_in_background: runInBackground,
  } = tool.input;
  return {
    receiverThreadId: tool.itemId,
    ...(typeof subagentType === "string" ? { agentType: subagentType } : {}),
    nickname: subagentName(tool.itemId),
    ...(typeof prompt === "string" ? { prompt } : {}),
    ...(typeof model === "string" ? { model } : {}),
    ...(runInBackground === true ? { background: true } : {}),
  };
}

export function titleForTool(itemType: CanonicalItemType): string {
  switch (itemType) {
    case "plan":
      return "Plan";
    case "command_execution":
      return "Command run";
    case "file_change":
      return "File change";
    case "mcp_tool_call":
      return "MCP tool call";
    case "collab_agent_tool_call":
      return "Subagent task";
    case "web_search":
      return "Web search";
    case "image_view":
      return "Image view";
    case "image_generation":
      return "Image generation";
    case "dynamic_tool_call":
      return "Tool call";
    default:
      return "Item";
  }
}

export function toolInputFingerprint(input: Record<string, unknown>): string | undefined {
  try {
    return JSON.stringify(input);
  } catch {
    return undefined;
  }
}

export function toolResultStreamKind(
  itemType: CanonicalItemType,
): ClaudeToolResultStreamKind | undefined {
  switch (itemType) {
    case "command_execution":
      return "command_output";
    case "file_change":
      return "file_change_output";
    default:
      return undefined;
  }
}

export function toolResultBlocksFromUserMessage(message: SDKMessage): Array<{
  readonly toolUseId: string;
  readonly block: Record<string, unknown>;
  readonly text: string;
  readonly isError: boolean;
  readonly structuredResult: unknown;
}> {
  if (message.type !== "user") {
    return [];
  }

  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const blocks: Array<{
    readonly toolUseId: string;
    readonly block: Record<string, unknown>;
    readonly text: string;
    readonly isError: boolean;
    readonly structuredResult: unknown;
  }> = [];

  for (const entry of content) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const block = entry as Record<string, unknown>;
    if (block.type !== "tool_result") {
      continue;
    }

    const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
    if (!toolUseId) {
      continue;
    }

    blocks.push({
      toolUseId,
      block,
      text: extractTextContent(block.content),
      isError: block.is_error === true,
      structuredResult: message.tool_use_result,
    });
  }

  return blocks;
}
