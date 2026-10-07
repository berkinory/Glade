import { pluralize } from "@glade/shared/text/text";
import {
  isFileChangeWorkLogEntry,
  type WorkLogEntry,
  type WorkLogToolKind,
} from "../../workLog.types";
import { deriveReadableCommandDisplay } from "../../lib/toolCallLabel.commands";
import { isReasoningUpdateWorkEntry } from "./agentActivity.logic";

export const MIN_COLLAPSIBLE_TOOL_GROUP_SIZE = 2;

export function workEntryRowCount(entry: WorkLogEntry): number {
  return isFileChangeWorkLogEntry(entry) ? Math.max(1, entry.changedFiles?.length ?? 0) : 1;
}

type ToolCallSummaryCategory = WorkLogToolKind | "other";

interface ToolCallGroupSummaryPart {
  category: ToolCallSummaryCategory;
  count: number;
  label: string;
}

export interface ToolCallGroupSummary {
  label: string;
  parts: ReadonlyArray<ToolCallGroupSummaryPart>;
  entryCount: number;
  // A group with in-flight work must never present itself as settled.
  hasRunningEntry: boolean;
  failedCount: number;

  iconEntry: WorkLogEntry;
}

function isSummarizableToolCallEntry(entry: WorkLogEntry): boolean {
  return (
    entry.tone === "tool" &&
    !isReasoningUpdateWorkEntry(entry) &&
    !entry.gladeThreadCreation &&
    !entry.subagentAction &&
    (entry.subagents?.length ?? 0) === 0
  );
}

// Reasoning rides in the same fold as the tool calls around it instead of splitting the run.
export function isGroupableWorkEntry(entry: WorkLogEntry): boolean {
  return isSummarizableToolCallEntry(entry) || isReasoningUpdateWorkEntry(entry);
}

function entryFileKeys(entry: WorkLogEntry): ReadonlyArray<string> {
  if (entry.changedFiles && entry.changedFiles.length > 0) {
    return entry.changedFiles;
  }
  const detailFiles = entry.toolDetails?.files;
  if (detailFiles && detailFiles.length > 0) {
    return detailFiles;
  }
  const command = entry.command ?? entry.rawCommand;
  if (command) {
    const target = deriveReadableCommandDisplay(command).target.trim();
    if (target.length > 0) {
      return [target];
    }
  }
  if (entry.preview?.trim()) {
    return [entry.preview.trim()];
  }
  return [];
}

const FILE_COUNTED_CATEGORIES: ReadonlySet<ToolCallSummaryCategory> = new Set(["edit", "read"]);

const CATEGORY_ORDER: ReadonlyArray<ToolCallSummaryCategory> = [
  "command",
  "edit",
  "read",
  "list",
  "search",
  "fetch",
  "web_search",
  "browser",
  "agent",
  "image_view",
  "image_generation",
  "mcp",
  "tool",
  "other",
];

function timesLabel(verb: string, count: number): string {
  return count === 1 ? `${verb} once` : `${verb} ${count} times`;
}

function summaryPartLabel(
  category: ToolCallSummaryCategory,
  count: number,
  isSolePart: boolean,
): string {
  switch (category) {
    case "command":
      return `ran ${count} ${pluralize(count, "command")}`;
    case "edit":
      return `edited ${count} ${pluralize(count, "file")}`;
    case "read":
      return `read ${count} ${pluralize(count, "file")}`;
    case "list":
      return `listed ${count} ${pluralize(count, "folder")}`;
    case "search":
      return timesLabel("searched", count);
    case "fetch":
      return `fetched ${count} ${pluralize(count, "page")}`;
    case "web_search":
      return timesLabel("searched the web", count);
    case "browser":
      return timesLabel("used the browser", count);
    case "agent":
      return `ran ${count} agent ${pluralize(count, "task")}`;
    case "image_view":
      return `viewed ${count} ${pluralize(count, "image")}`;
    case "image_generation":
      return `generated ${count} ${pluralize(count, "image")}`;
    case "mcp":
    case "tool":
      return `used ${count} ${pluralize(count, "tool")}`;
    case "other":
      return isSolePart
        ? `ran ${count} tool ${pluralize(count, "call")}`
        : `${count} other tool ${pluralize(count, "call")}`;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function summarizeToolCallGroup(
  entries: ReadonlyArray<WorkLogEntry>,
  options?: { includeSingleEntry?: boolean },
): ToolCallGroupSummary | null {
  const groupable = entries.filter(isGroupableWorkEntry);
  const rowCount = groupable.reduce((total, entry) => total + workEntryRowCount(entry), 0);
  if (rowCount < (options?.includeSingleEntry ? 1 : MIN_COLLAPSIBLE_TOOL_GROUP_SIZE)) {
    return null;
  }
  const summarizable = groupable.filter(isSummarizableToolCallEntry);

  const countByCategory = new Map<ToolCallSummaryCategory, number>();
  const distinctFilesByCategory = new Map<ToolCallSummaryCategory, Set<string>>();
  let hasRunningEntry = false;
  let failedCount = 0;

  for (const entry of summarizable) {
    if (entry.toolStatus === "running") {
      hasRunningEntry = true;
    }
    if (entry.toolStatus === "failed") {
      failedCount += 1;
    }
    const category: ToolCallSummaryCategory = entry.toolKind ?? "other";
    const fileKeys = FILE_COUNTED_CATEGORIES.has(category) ? entryFileKeys(entry) : [];
    if (fileKeys.length === 0) {
      countByCategory.set(category, (countByCategory.get(category) ?? 0) + 1);
      continue;
    }
    const distinctFiles =
      distinctFilesByCategory.get(category) ??
      distinctFilesByCategory.set(category, new Set()).get(category)!;
    for (const fileKey of fileKeys) {
      distinctFiles.add(fileKey);
    }
  }

  for (const [category, distinctFiles] of distinctFilesByCategory) {
    countByCategory.set(category, (countByCategory.get(category) ?? 0) + distinctFiles.size);
  }

  const populated = CATEGORY_ORDER.filter((category) => (countByCategory.get(category) ?? 0) > 0);
  const parts = populated.map((category) => {
    const count = countByCategory.get(category)!;
    return {
      category,
      count,
      label: summaryPartLabel(category, count, populated.length === 1),
    };
  });
  const label = parts.map((part) => part.label).join(", ");

  return {
    label: label ? capitalize(label) : "Thought",
    parts,
    entryCount: groupable.length,
    hasRunningEntry,
    failedCount,
    iconEntry: summarizable[0] ?? groupable[0]!,
  };
}
