import { pluralize } from "@glade/shared/text/text";
import {
  isFileChangeWorkLogEntry,
  type WorkLogEntry,
  type WorkLogToolKind,
} from "../../workLog.types";
import { deriveReadableCommandDisplay } from "../../lib/toolCallLabel.commands";

export const MIN_COLLAPSIBLE_TOOL_GROUP_SIZE = 2;

export function workEntryRowCount(entry: WorkLogEntry): number {
  return isFileChangeWorkLogEntry(entry) ? Math.max(1, entry.changedFiles?.length ?? 0) : 1;
}

type ToolCallSummaryCategory = WorkLogToolKind | "other";

export interface ToolCallGroupSummary {
  label: string;
  entryCount: number;
  // A group with in-flight work must never present itself as settled.
  hasRunningEntry: boolean;

  // The group wears its activity's glyph, or "mixed" when it spans several. Generic tool groups keep
  // the first entry's icon.
  activity: ToolCallGroupActivity | "mixed";
  iconEntry: WorkLogEntry;
  // A browser or computer run names its latest step, such as `Clicked "Sign in" · github.com`.
  latestStep: string | null;
}

// Thinking is not a tool call: it splits the run and gets its own row.
export function isGroupableWorkEntry(entry: WorkLogEntry): boolean {
  return (
    entry.tone === "tool" &&
    !entry.reasoning &&
    !entry.gladeThreadCreation &&
    !entry.subagentAction &&
    (entry.subagents?.length ?? 0) === 0
  );
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

// The title names what the agent did, not every tool it touched: reading, listing and searching are
// all exploring, and fetching and web search are both browsing.
export type ToolCallGroupActivity =
  | "edit"
  | "command"
  | "explore"
  | "browse"
  | "computer"
  | "agent"
  | "image_view"
  | "image_generation"
  | "tools";

const ACTIVITY_OF: Record<ToolCallSummaryCategory, ToolCallGroupActivity> = {
  edit: "edit",
  command: "command",
  read: "explore",
  list: "explore",
  search: "explore",
  fetch: "browse",
  web_search: "browse",
  browser: "browse",
  computer: "computer",
  agent: "agent",
  image_view: "image_view",
  image_generation: "image_generation",
  mcp: "tools",
  tool: "tools",
  other: "tools",
};

const ACTIVITY_ORDER: ReadonlyArray<ToolCallGroupActivity> = [
  "edit",
  "command",
  "explore",
  "browse",
  "computer",
  "agent",
  "image_view",
  "image_generation",
  "tools",
];

const MAX_TITLE_PARTS = 2;

function timesLabel(verb: string, count: number): string {
  return count === 1 ? `${verb} once` : `${verb} ${count} times`;
}

function activityLabel(
  activity: ToolCallGroupActivity,
  counts: ReadonlyMap<ToolCallSummaryCategory, number>,
): string {
  const count = (category: ToolCallSummaryCategory) => counts.get(category) ?? 0;
  switch (activity) {
    case "edit":
      return `edited ${count("edit")} ${pluralize(count("edit"), "file")}`;
    case "command":
      return `ran ${count("command")} ${pluralize(count("command"), "command")}`;
    case "explore": {
      if (count("read") > 0) return `explored ${count("read")} ${pluralize(count("read"), "file")}`;
      if (count("list") === 0) return timesLabel("searched", count("search"));
      if (count("search") === 0) {
        return `listed ${count("list")} ${pluralize(count("list"), "folder")}`;
      }
      return "explored the project";
    }
    case "browse": {
      const fetched = count("fetch");
      const total = fetched + count("web_search") + count("browser");
      return fetched === total
        ? `fetched ${fetched} ${pluralize(fetched, "page")}`
        : timesLabel("browsed the web", total);
    }
    case "computer":
      return timesLabel("used the computer", count("computer"));
    case "agent":
      return `ran ${count("agent")} agent ${pluralize(count("agent"), "task")}`;
    case "image_view":
      return `viewed ${count("image_view")} ${pluralize(count("image_view"), "image")}`;
    case "image_generation":
      return `generated ${count("image_generation")} ${pluralize(count("image_generation"), "image")}`;
    case "tools": {
      const total = count("mcp") + count("tool") + count("other");
      return `used ${total} ${pluralize(total, "tool")}`;
    }
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
  const countByCategory = new Map<ToolCallSummaryCategory, number>();
  const distinctFilesByCategory = new Map<ToolCallSummaryCategory, Set<string>>();
  let hasRunningEntry = false;

  for (const entry of groupable) {
    if (entry.toolStatus === "running") {
      hasRunningEntry = true;
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

  const callsByActivity = new Map<ToolCallGroupActivity, number>();
  for (const [category, count] of countByCategory) {
    const activity = ACTIVITY_OF[category];
    callsByActivity.set(activity, (callsByActivity.get(activity) ?? 0) + count);
  }
  const activities = ACTIVITY_ORDER.filter((activity) => callsByActivity.has(activity));
  const shown = activities.slice(0, MAX_TITLE_PARTS);
  const hiddenCalls = activities
    .slice(MAX_TITLE_PARTS)
    .reduce((total, activity) => total + (callsByActivity.get(activity) ?? 0), 0);
  const label = [
    ...shown.map((activity) => activityLabel(activity, countByCategory)),
    ...(hiddenCalls > 0 ? [`+${hiddenCalls} more`] : []),
  ].join(" · ");
  const isStepRun =
    countByCategory.size > 0 &&
    [...countByCategory.keys()].every(
      (category) => category === "browser" || category === "computer",
    );

  return {
    label: capitalize(label),
    entryCount: groupable.length,
    hasRunningEntry,
    activity: activities.length > 1 ? "mixed" : activities[0]!,
    iconEntry: groupable[0]!,
    latestStep: isStepRun ? latestStepText(groupable) : null,
  };
}

function latestStepText(entries: ReadonlyArray<WorkLogEntry>): string | null {
  const last = entries.at(-1);
  const latest =
    last?.toolStatus === "running" ? last : (entries.findLast((entry) => entry.preview) ?? last);
  if (!latest?.toolTitle) return null;
  return latest.preview ? `${latest.toolTitle} ${latest.preview}` : latest.toolTitle;
}
