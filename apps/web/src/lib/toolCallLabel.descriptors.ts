import {
  GLADE_MCP_TOOL_PRESENTATIONS,
  GLADE_MCP_TOOL_PRESENTATION_ENTRIES,
  extractGladeMcpToolName,
  fallbackGladeMcpToolPresentation,
  humanizeMcpServerTool,
  humanizeMcpToken,
  humanizeMcpToolIdentifier,
  normalizeCompactToolLabel,
  normalizeGladeMcpIdentifier,
} from "./toolCallLabel.presentations";
import type {
  GladeMcpToolPresentation,
  ReadableToolTitleInput,
} from "./toolCallLabel.presentations";

function resolveGladeMcpToolPresentation(
  candidates: ReadonlyArray<string | null | undefined>,
): GladeMcpToolPresentation | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const normalizedCandidate = normalizeGladeMcpIdentifier(candidate);
    for (const entry of GLADE_MCP_TOOL_PRESENTATION_ENTRIES) {
      if (
        normalizedCandidate === entry.normalizedRunning ||
        normalizedCandidate === entry.normalizedCompleted ||
        normalizedCandidate === entry.normalizedFailed
      ) {
        return entry.presentation;
      }
    }
    const toolName = extractGladeMcpToolName(normalizedCandidate);
    const knownPresentation = toolName
      ? (GLADE_MCP_TOOL_PRESENTATIONS[toolName as keyof typeof GLADE_MCP_TOOL_PRESENTATIONS] as
          | GladeMcpToolPresentation
          | undefined)
      : undefined;
    if (knownPresentation) {
      return knownPresentation;
    }

    if (/\s/.test(candidate.trim())) {
      continue;
    }
    if (normalizedCandidate.startsWith("glade_is_handling_")) {
      return fallbackGladeMcpToolPresentation(
        `glade_${normalizedCandidate.slice("glade_is_handling_".length)}`,
      );
    }
    if (normalizedCandidate.startsWith("glade_handled_")) {
      return fallbackGladeMcpToolPresentation(
        `glade_${normalizedCandidate.slice("glade_handled_".length)}`,
      );
    }
    if (normalizedCandidate.startsWith("glade_couldn_t_handle_")) {
      return fallbackGladeMcpToolPresentation(
        `glade_${normalizedCandidate.slice("glade_couldn_t_handle_".length)}`,
      );
    }
    if (!toolName) {
      continue;
    }
    return fallbackGladeMcpToolPresentation(toolName);
  }
  return null;
}

export type GladeMcpToolStatus = "running" | "completed" | "failed" | "cancelled";

export interface GladeMcpToolTitleInput {
  readonly toolName?: string | null | undefined;
  readonly title?: string | null | undefined;
  readonly fallbackLabel?: string | null | undefined;
  readonly status?: GladeMcpToolStatus | undefined;
}

export function isGladeVisualToolCall(input: GladeMcpToolTitleInput): boolean {
  const presentation = resolveGladeMcpToolPresentation([
    input.toolName,
    input.title,
    input.fallbackLabel,
  ]);
  return (
    presentation === GLADE_MCP_TOOL_PRESENTATIONS.glade_html_preview ||
    presentation === GLADE_MCP_TOOL_PRESENTATIONS.glade_html_render
  );
}

export function deriveGladeMcpToolTitle(input: GladeMcpToolTitleInput): string | null {
  const presentation = resolveGladeMcpToolPresentation([
    input.toolName,
    input.title,
    input.fallbackLabel,
  ]);
  if (!presentation) {
    return null;
  }
  switch (input.status ?? "completed") {
    case "running":
      return presentation.running;
    case "completed":
      return presentation.completed;
    case "failed":
      return presentation.failed;
    case "cancelled":
      return presentation.running.startsWith("Glade is ")
        ? `Glade stopped ${presentation.running.slice("Glade is ".length)}`
        : `Cancelled ${presentation.running}`;
  }
}

export function sanitizeGladeMcpToolPreview(input: {
  readonly preview?: string | null | undefined;
  readonly heading: string;
  readonly status?: GladeMcpToolStatus | undefined;
}): string | null {
  const preview = input.preview?.trim();
  if (!preview) return null;
  const previewTitle = deriveGladeMcpToolTitle({ title: preview, status: input.status });
  if (
    previewTitle &&
    normalizeGladeMcpIdentifier(previewTitle) === normalizeGladeMcpIdentifier(input.heading)
  ) {
    return null;
  }
  return preview;
}

export interface ReadableCommandDisplay {
  readonly verb: string;
  readonly target: string;
  readonly fullCommand: string;
}

export type CommandVisualKind = "inspect" | "git" | "github" | "terminal";

export function humanizeRequestKind(
  requestKind: ReadableToolTitleInput["requestKind"],
  itemType: ReadableToolTitleInput["itemType"],
): string | null {
  if (requestKind === "file-read") return "Read";
  if (requestKind === "file-change" || itemType === "file_change") return "Edited";
  if (requestKind === "tool") return "Tool";

  if (itemType === "web_search") return "Searched the web";
  if (itemType === "image_generation") return "Generated image";
  if (itemType === "image_view") return "Viewed image";
  if (itemType === "collab_agent_tool_call") return "Agent task";
  return null;
}

export function isGenericToolTitle(value: string): boolean {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    normalized === "tool" ||
    normalized === "tool call" ||
    normalized === "dynamic tool call" ||
    normalized === "mcp tool call" ||
    normalized === "agent task" ||
    normalized === "subagent task" ||
    normalized === "task" ||
    normalized === "command run" ||
    normalized === "ran command" ||
    normalized === "running command" ||
    normalized === "command execution" ||
    normalized === "file change" ||
    normalized === "find" ||
    normalized === "read file"
  );
}

export function normalizeToolDescriptor(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const mcpIdentifier = humanizeMcpToolIdentifier(value);
  if (mcpIdentifier) {
    return mcpIdentifier;
  }
  const normalized = value.replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  const dedupedTokens: string[] = [];
  for (const token of normalized.split(" ")) {
    if (dedupedTokens.at(-1)?.toLowerCase() === token.toLowerCase()) {
      continue;
    }
    dedupedTokens.push(token);
  }
  const collapsed = dedupedTokens.join(" ").trim();
  if (!collapsed) {
    return null;
  }
  const lowerCollapsed = collapsed.toLowerCase();
  if (lowerCollapsed === "read") {
    return "Read";
  }
  if (lowerCollapsed === "search" || lowerCollapsed === "find" || lowerCollapsed === "searched") {
    return "Search";
  }
  const readable = /[_-]/.test(value) ? humanizeMcpToken(collapsed) : collapsed;
  return readable.length > 64 ? `${readable.slice(0, 61).trimEnd()}...` : readable;
}

export function extractToolDescriptorFromPayload(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  if (!payload) {
    return null;
  }
  const mcpServerTool = extractMcpServerToolDescriptor(payload, 0);
  if (mcpServerTool) {
    return mcpServerTool;
  }
  const descriptorKeys = ["kind", "name", "tool", "tool_name", "toolName", "title"];
  const candidates: string[] = [];
  collectDescriptorCandidates(payload, descriptorKeys, candidates, 0);
  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized) {
      continue;
    }
    if (isGenericToolTitle(normalizeCompactToolLabel(normalized))) {
      continue;
    }
    return normalized;
  }
  return null;
}

function extractMcpServerToolDescriptor(value: unknown, depth: number): string | null {
  if (depth > 4 || !value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractMcpServerToolDescriptor(entry, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.server === "string" && typeof record.tool === "string") {
    return humanizeMcpServerTool(record.server, record.tool);
  }
  for (const nestedKey of [
    "item",
    "data",
    "event",
    "payload",
    "result",
    "input",
    "call",
    "invocation",
    "source",
  ]) {
    const nested = extractMcpServerToolDescriptor(record[nestedKey], depth + 1);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function collectDescriptorCandidates(
  value: unknown,
  keys: ReadonlyArray<string>,
  target: string[],
  depth: number,
) {
  if (depth > 4 || target.length >= 24) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      target.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDescriptorCandidates(entry, keys, target, depth + 1);
      if (target.length >= 24) {
        return;
      }
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string") {
      const trimmed = (record[key] as string).trim();
      if (trimmed) {
        target.push(trimmed);
      }
    }
  }
  for (const nestedKey of ["item", "data", "event", "payload", "result", "input", "tool", "call"]) {
    if (nestedKey in record) {
      collectDescriptorCandidates(record[nestedKey], keys, target, depth + 1);
      if (target.length >= 24) {
        return;
      }
    }
  }
}
