import type {
  ContentBlock,
  PlanEntry,
  SessionUpdate,
  ToolCall,
  ToolCallContent,
  ToolCallStatus,
  ToolCallUpdate,
  ToolKind,
} from "@agentclientprotocol/sdk";
import { RuntimeItemId } from "@glade/contracts/core/baseSchemas";
import type { CanonicalItemType } from "@glade/contracts/provider/runtimeMetadata";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";

import type { AcpInnerToolCall } from "./acpProviderProfile.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// An event before the session stamps its identity, time, provider and turn.
export type AcpRuntimeEventDraft = DistributiveOmit<
  ProviderRuntimeEvent,
  "eventId" | "createdAt" | "provider" | "threadId" | "turnId" | "lifecycleGeneration"
>;

interface TrackedToolCall {
  itemType: CanonicalItemType;
  title: string;
  kind: ToolKind | undefined;
  rawInput: unknown;
  completed: boolean;
}

export interface AcpTurnProjection {
  readonly project: (update: SessionUpdate) => ReadonlyArray<AcpRuntimeEventDraft>;
  // Closes items still open when the turn ends, so the transcript never shows a running row.
  readonly finish: (failed: boolean) => ReadonlyArray<AcpRuntimeEventDraft>;
  // Some agents restart tool-call ids every turn, so outward ids carry the turn.
  readonly toolItemId: (toolCallId: string) => string;
}

export function acpToolItemType(kind: ToolKind | undefined): CanonicalItemType {
  switch (kind) {
    case "execute":
      return "command_execution";
    case "edit":
    case "delete":
    case "move":
      return "file_change";
    case "fetch":
      return "web_search";
    default:
      return "dynamic_tool_call";
  }
}

function textOf(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "resource_link":
      return block.uri;
    default:
      return "";
  }
}

function toolCallDetail(content: ReadonlyArray<ToolCallContent> | null | undefined): string {
  if (!content) return "";
  return content
    .map((entry) => {
      switch (entry.type) {
        case "content":
          return textOf(entry.content);
        case "diff":
          return `${entry.path}\n${entry.newText}`;
        default:
          return "";
      }
    })
    .filter((part) => part.length > 0)
    .join("\n");
}

function changedPaths(content: ReadonlyArray<ToolCallContent> | null | undefined): string[] {
  return (content ?? []).flatMap((entry) => (entry.type === "diff" ? [entry.path] : []));
}

function itemStatus(status: ToolCallStatus | null | undefined) {
  return status === "completed" ? "completed" : status === "failed" ? "failed" : "inProgress";
}

function planDetail(entries: ReadonlyArray<PlanEntry>): string {
  return entries
    .map((entry) => `${entry.status === "completed" ? "[x]" : "[ ]"} ${entry.content}`)
    .join("\n");
}

export function makeAcpTurnProjection(
  turnKey: string,
  innerToolCall?: AcpInnerToolCall,
): AcpTurnProjection {
  const tools = new Map<string, TrackedToolCall>();
  let segment = 0;
  let assistantItemId: string | undefined;
  let reasoningItemId: string | undefined;
  let planItemId: string | undefined;

  const nextItemId = (kind: string) => `${turnKey}:${kind}:${++segment}`;
  const toolItemId = (toolCallId: string) => `${turnKey}:tool:${toolCallId}`;

  const closeText = (): AcpRuntimeEventDraft[] => {
    const drafts: AcpRuntimeEventDraft[] = [];
    if (reasoningItemId) {
      drafts.push({
        type: "item.completed",
        itemId: RuntimeItemId.makeUnsafe(reasoningItemId),
        payload: { itemType: "reasoning", status: "completed" },
      });
      reasoningItemId = undefined;
    }
    if (assistantItemId) {
      drafts.push({
        type: "item.completed",
        itemId: RuntimeItemId.makeUnsafe(assistantItemId),
        payload: { itemType: "assistant_message", status: "completed" },
      });
      assistantItemId = undefined;
    }
    return drafts;
  };

  const textDelta = (
    block: ContentBlock,
    streamKind: "assistant_text" | "reasoning_text",
  ): AcpRuntimeEventDraft[] => {
    const delta = textOf(block);
    if (delta.length === 0) return [];
    const drafts: AcpRuntimeEventDraft[] = [];
    if (streamKind === "assistant_text") {
      if (reasoningItemId) drafts.push(...closeText());
      if (!assistantItemId) {
        assistantItemId = nextItemId("message");
        drafts.push({
          type: "item.started",
          itemId: RuntimeItemId.makeUnsafe(assistantItemId),
          payload: { itemType: "assistant_message", status: "inProgress" },
        });
      }
      drafts.push({
        type: "content.delta",
        itemId: RuntimeItemId.makeUnsafe(assistantItemId),
        payload: { streamKind, delta },
      });
      return drafts;
    }
    if (!reasoningItemId) {
      reasoningItemId = nextItemId("reasoning");
      drafts.push({
        type: "item.started",
        itemId: RuntimeItemId.makeUnsafe(reasoningItemId),
        payload: { itemType: "reasoning", status: "inProgress", title: "Thinking" },
      });
    }
    drafts.push({
      type: "content.delta",
      itemId: RuntimeItemId.makeUnsafe(reasoningItemId),
      payload: { streamKind, delta },
    });
    return drafts;
  };

  const toolData = (toolCallId: string, tool: TrackedToolCall, extra?: Record<string, unknown>) => {
    const itemId = toolItemId(toolCallId);
    return {
      toolCallId: itemId,
      callId: itemId,
      toolName: tool.title,
      ...(tool.kind ? { toolKind: tool.kind } : {}),
      input: tool.rawInput ?? {},
      ...extra,
    };
  };

  const startTool = (call: ToolCall): AcpRuntimeEventDraft[] => {
    const tool: TrackedToolCall = {
      itemType: acpToolItemType(call.kind ?? undefined),
      title: call.title,
      kind: call.kind ?? undefined,
      rawInput: call.rawInput,
      completed: false,
    };
    tools.set(call.toolCallId, tool);
    const drafts: AcpRuntimeEventDraft[] = [
      ...closeText(),
      {
        type: "item.started",
        itemId: RuntimeItemId.makeUnsafe(toolItemId(call.toolCallId)),
        payload: {
          itemType: tool.itemType,
          status: itemStatus(call.status),
          title: tool.title,
          data: toolData(call.toolCallId, tool),
        },
      },
    ];
    if (call.status === "completed" || call.status === "failed") {
      drafts.push(...updateTool(call));
    }
    return drafts;
  };

  const updateTool = (update: ToolCallUpdate): AcpRuntimeEventDraft[] => {
    const tool = tools.get(update.toolCallId);
    if (!tool) {
      return startTool({
        toolCallId: update.toolCallId,
        title: update.title ?? "Tool",
        ...(update.kind ? { kind: update.kind } : {}),
        ...(update.status ? { status: update.status } : {}),
        ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
        ...(update.content ? { content: update.content } : {}),
      });
    }
    if (tool.completed) return [];
    if (update.title) tool.title = update.title;
    // Some agents announce a call before they classify it; the first known kind decides its row.
    if (update.kind && tool.kind === undefined) tool.itemType = acpToolItemType(update.kind);
    if (update.kind) tool.kind = update.kind;
    if (update.rawInput !== undefined) tool.rawInput = update.rawInput;
    const inner = update.rawOutput !== undefined ? innerToolCall?.(update.rawOutput) : undefined;
    if (inner) {
      tool.title = inner.name;
      tool.rawInput = inner.input;
    }
    const detail = toolCallDetail(update.content);
    const paths = changedPaths(update.content);
    const done = update.status === "completed" || update.status === "failed";
    if (done) tool.completed = true;
    return [
      {
        type: done ? "item.completed" : "item.updated",
        itemId: RuntimeItemId.makeUnsafe(toolItemId(update.toolCallId)),
        payload: {
          itemType: tool.itemType,
          status: itemStatus(update.status),
          title: tool.title,
          ...(detail ? { detail } : {}),
          data: toolData(update.toolCallId, tool, {
            ...(update.rawOutput !== undefined ? { output: update.rawOutput } : {}),
            ...(paths.length > 0 ? { changedPaths: paths } : {}),
          }),
        },
      },
    ];
  };

  return {
    toolItemId,
    project: (update) => {
      switch (update.sessionUpdate) {
        case "agent_message_chunk":
          return textDelta(update.content, "assistant_text");
        case "agent_thought_chunk":
          return textDelta(update.content, "reasoning_text");
        case "tool_call":
          return startTool(update);
        case "tool_call_update":
          return updateTool(update);
        case "plan": {
          const started = planItemId === undefined;
          planItemId ??= nextItemId("plan");
          return [
            {
              type: started ? "item.started" : "item.updated",
              itemId: RuntimeItemId.makeUnsafe(planItemId),
              payload: {
                itemType: "plan",
                status: "inProgress",
                title: "Plan",
                detail: planDetail(update.entries),
                data: { entries: update.entries },
              },
            },
          ];
        }
        default:
          return [];
      }
    },
    finish: (failed) => {
      const drafts = closeText();
      for (const [toolCallId, tool] of tools) {
        if (tool.completed) continue;
        tool.completed = true;
        drafts.push({
          type: "item.completed",
          itemId: RuntimeItemId.makeUnsafe(toolItemId(toolCallId)),
          payload: {
            itemType: tool.itemType,
            status: failed ? "failed" : "completed",
            title: tool.title,
            data: toolData(toolCallId, tool),
          },
        });
      }
      if (planItemId) {
        drafts.push({
          type: "item.completed",
          itemId: RuntimeItemId.makeUnsafe(planItemId),
          payload: { itemType: "plan", status: "completed", title: "Plan" },
        });
        planItemId = undefined;
      }
      return drafts;
    },
  };
}
