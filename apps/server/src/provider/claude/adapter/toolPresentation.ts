import {
  type CanonicalItemType,
  type CanonicalRequestType,
} from "@glade/contracts/provider/runtimeMetadata";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ToolInFlight, ClaudeToolResultStreamKind } from "./sessionTypes";
import { claudeWorkerEffortFromSubagentType } from "./promptPolicy";
import { extractTextContent } from "./messageContent";

export function classifyToolItemType(toolName: string): CanonicalItemType {
  const normalized = toolName.toLowerCase();
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
  if (normalized.includes("agent")) {
    return "collab_agent_tool_call";
  }
  if (
    normalized === "task" ||
    normalized === "agent" ||
    normalized.includes("subagent") ||
    normalized.includes("sub-agent")
  ) {
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

export // Tools whose result is surfaced through a dedicated runtime channel — AskUserQuestion via the
// user-input request flow, ExitPlanMode via the proposed-plan flow — must NOT also emit a generic
// tool-call lifecycle item, or the timeline shows a redundant "ToolName: {json}" row alongside the
// real interaction surface.
function isClientSurfacedClaudeTool(toolName: string): boolean {
  return toolName === "AskUserQuestion" || toolName === "ExitPlanMode";
}

export function toolLifecycleEventData(
  tool: Pick<ToolInFlight, "itemId" | "toolName" | "input">,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    toolCallId: tool.itemId,
    callId: tool.itemId,
    toolName: tool.toolName,
    input: tool.input,
    ...(tool.toolName === "Task" || tool.toolName === "Agent" ? subagentReceiverData(tool) : {}),
    ...extra,
  };
}

function subagentReceiverData(
  tool: Pick<ToolInFlight, "itemId" | "input">,
): Record<string, unknown> {
  const {
    subagent_type: subagentType,
    description,
    prompt,
    model,
    run_in_background: runInBackground,
  } = tool.input;
  const effort =
    typeof subagentType === "string" ? claudeWorkerEffortFromSubagentType(subagentType) : undefined;
  return {
    receiverThreadId: tool.itemId,
    ...(typeof subagentType === "string" ? { agentType: subagentType } : {}),
    ...(typeof description === "string" ? { nickname: description } : {}),
    ...(typeof prompt === "string" ? { prompt } : {}),
    ...(typeof model === "string" ? { model } : {}),
    ...(effort ? { effort } : {}),
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
    case "dynamic_tool_call":
      return "Tool call";
    default:
      return "Item";
  }
}

interface ParsedJsonRecord {
  readonly value: Record<string, unknown>;
  readonly serialized: string;
}

export function tryParseCompleteJsonRecord(value: string): ParsedJsonRecord | undefined {
  if (!value.trimEnd().endsWith("}")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return {
      value: parsed as Record<string, unknown>,
      serialized: JSON.stringify(parsed),
    };
  } catch {
    return undefined;
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
