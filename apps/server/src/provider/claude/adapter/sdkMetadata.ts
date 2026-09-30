import { asNonBlankString } from "@glade/shared/text/text";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  type RuntimeTurnState,
  type RuntimeSessionState,
} from "@glade/contracts/provider/runtimeMetadata";
import { toolResultBlocksFromUserMessage } from "./toolPresentation";
import { ClaudeSessionContext, ClaudeSubagentRun } from "./sessionTypes";

interface ClaudeVcsStateChange {
  readonly kind?: string;
  readonly cwd?: string;
}

export function readClaudeVcsStateChange(message: unknown): ClaudeVcsStateChange | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const record = message as {
    type?: unknown;
    subtype?: unknown;
    kind?: unknown;
    cwd?: unknown;
  };
  if (record.type !== "system" || record.subtype !== "vcs_state_changed") {
    return undefined;
  }
  const kind = asNonBlankString(record.kind);
  const cwd = asNonBlankString(record.cwd);
  return {
    ...(kind !== undefined ? { kind } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
  };
}

function sdkMessageType(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { type?: unknown };
  return typeof record.type === "string" ? record.type : undefined;
}

function sdkMessageSubtype(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { subtype?: unknown };
  return typeof record.subtype === "string" ? record.subtype : undefined;
}

export function sdkNativeMethod(message: SDKMessage): string {
  const subtype = sdkMessageSubtype(message);
  if (subtype) {
    return `claude/${message.type}/${subtype}`;
  }

  if (message.type === "stream_event") {
    const streamType = sdkMessageType(message.event);
    if (streamType) {
      const deltaType =
        streamType === "content_block_delta"
          ? sdkMessageType((message.event as { delta?: unknown }).delta)
          : undefined;
      if (deltaType) {
        return `claude/${message.type}/${streamType}/${deltaType}`;
      }
      return `claude/${message.type}/${streamType}`;
    }
  }

  return `claude/${message.type}`;
}

export function sdkNativeItemId(message: SDKMessage): string | undefined {
  if (message.type === "assistant") {
    const maybeId = (message.message as { id?: unknown }).id;
    if (typeof maybeId === "string") {
      return maybeId;
    }
    return undefined;
  }

  if (message.type === "user") {
    return toolResultBlocksFromUserMessage(message)[0]?.toolUseId;
  }

  if (message.type === "stream_event") {
    const event = message.event as {
      type?: unknown;
      content_block?: { id?: unknown };
    };
    if (event.type === "content_block_start" && typeof event.content_block?.id === "string") {
      return event.content_block.id;
    }
  }

  return undefined;
}

function parentToolUseId(message: SDKMessage): string | undefined {
  if (
    message.type !== "assistant" &&
    message.type !== "user" &&
    message.type !== "stream_event" &&
    message.type !== "tool_progress"
  ) {
    return undefined;
  }
  return typeof message.parent_tool_use_id === "string" && message.parent_tool_use_id.length > 0
    ? message.parent_tool_use_id
    : undefined;
}

function isRecognizedSubagentToolUseId(context: ClaudeSessionContext, toolUseId: string): boolean {
  if (context.subagentRuns.has(toolUseId) || context.settledSubagentToolUseIds.has(toolUseId)) {
    return true;
  }
  for (const tool of context.inFlightTools.values()) {
    if (tool.itemId === toolUseId && tool.itemType === "collab_agent_tool_call") {
      return true;
    }
  }
  return false;
}

export function recognizedSubagentParentToolUseId(
  context: ClaudeSessionContext,
  message: SDKMessage,
): string | undefined {
  const toolUseId = parentToolUseId(message);
  return toolUseId && isRecognizedSubagentToolUseId(context, toolUseId) ? toolUseId : undefined;
}

export function claudeTaskTurnStatus(status: "completed" | "failed" | "stopped"): RuntimeTurnState {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "interrupted";
  }
}

export function runtimeSessionStateFromClaudeTaskStatus(
  status: string | undefined,
): RuntimeSessionState | undefined {
  switch (status) {
    case "pending":
      return "starting";
    case "running":
      return "running";
    case "paused":
      return "waiting";
    case "completed":
      return "ready";
    case "failed":
      return "error";
    case "killed":
      return "stopped";
    default:
      return undefined;
  }
}

export function subagentRunForTask(
  context: ClaudeSessionContext,
  toolUseId: string | undefined,
  taskId: string,
): ClaudeSubagentRun | undefined {
  const run = toolUseId ? context.subagentRuns.get(toolUseId) : undefined;
  if (run) {
    run.taskId ??= taskId;
    return run;
  }
  for (const candidate of context.subagentRuns.values()) {
    if (candidate.taskId === taskId) {
      return candidate;
    }
  }
  return undefined;
}
