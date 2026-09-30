import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { SidebarThreadSummary } from "../types";
import { hasUnseenCompletion, isThreadActivelyWorking } from "./Sidebar.logic";

function isThreadRunningForActivity(
  thread: Pick<SidebarThreadSummary, "hasLiveTailWork" | "session" | "latestTurn">,
): boolean {
  return isThreadActivelyWorking(thread) || thread.session?.status === "connecting";
}

function isActivityThread(thread: SidebarThreadSummary): boolean {
  if (thread.archivedAt != null) return false;
  if (thread.parentThreadId) return false;
  return thread.latestTurn !== null || isThreadRunningForActivity(thread);
}

export function isThreadSettledForActivity(
  thread: Pick<SidebarThreadSummary, "id" | "settledAt" | "latestHumanMessageAt">,
  settledOverrideByThreadId?: ReadonlyMap<ThreadId, boolean>,
): boolean {
  const override = settledOverrideByThreadId?.get(thread.id);
  if (override !== undefined) return override;
  return (
    thread.settledAt != null &&
    parseTimestampMs(thread.latestHumanMessageAt) <= parseTimestampMs(thread.settledAt)
  );
}

function parseTimestampMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

type ActivityRecencyInput = Pick<SidebarThreadSummary, "createdAt" | "latestHumanMessageAt">;

function resolveActivityRecencyIso(thread: ActivityRecencyInput): string {
  return thread.latestHumanMessageAt && parseTimestampMs(thread.latestHumanMessageAt) > 0
    ? thread.latestHumanMessageAt
    : thread.createdAt;
}

function resolveActivityRecencyMs(thread: ActivityRecencyInput): number {
  return parseTimestampMs(resolveActivityRecencyIso(thread));
}

function compareThreadIds(
  left: Pick<SidebarThreadSummary, "id">,
  right: Pick<SidebarThreadSummary, "id">,
): number {
  return left.id.localeCompare(right.id);
}

export interface ActivityViewModel {
  pinned: SidebarThreadSummary[];
  active: SidebarThreadSummary[];
  settled: SidebarThreadSummary[];
}

export function buildActivityViewModel(input: {
  threads: readonly SidebarThreadSummary[];
  pinnedThreadIdSet: ReadonlySet<ThreadId>;
  settledOverrideByThreadId?: ReadonlyMap<ThreadId, boolean>;

  projectFilterIds?: ReadonlySet<ProjectId> | null;
}): ActivityViewModel {
  const projectFilterIds = input.projectFilterIds ?? null;
  const pinned: SidebarThreadSummary[] = [];
  const active: SidebarThreadSummary[] = [];
  const settled: SidebarThreadSummary[] = [];

  for (const thread of input.threads) {
    if (!isActivityThread(thread)) continue;
    if (projectFilterIds !== null && !projectFilterIds.has(thread.projectId)) continue;
    if (input.pinnedThreadIdSet.has(thread.id)) {
      pinned.push(thread);
      continue;
    }
    if (isThreadSettledForActivity(thread, input.settledOverrideByThreadId)) {
      settled.push(thread);
    } else {
      active.push(thread);
    }
  }

  const compareRecency = (left: SidebarThreadSummary, right: SidebarThreadSummary) =>
    resolveActivityRecencyMs(right) - resolveActivityRecencyMs(left) ||
    compareThreadIds(left, right);
  pinned.sort(compareRecency);
  active.sort(compareRecency);
  settled.sort((left, right) => {
    const leftSettledMs = parseTimestampMs(left.settledAt) || resolveActivityRecencyMs(left);
    const rightSettledMs = parseTimestampMs(right.settledAt) || resolveActivityRecencyMs(right);
    return rightSettledMs - leftSettledMs || compareThreadIds(left, right);
  });

  return { pinned, active, settled };
}

export type ActivityDateBucket = "today" | "yesterday" | "earlier";

function resolveActivityDateBucket(
  thread: ActivityRecencyInput,
  nowMs: number,
): ActivityDateBucket {
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const recencyMs = resolveActivityRecencyMs(thread);
  if (recencyMs >= startOfToday.getTime()) return "today";
  if (recencyMs >= startOfYesterday.getTime()) return "yesterday";
  return "earlier";
}

export function splitActivityThreadsByDateBucket(
  threads: readonly SidebarThreadSummary[],
  nowMs: number,
): Record<ActivityDateBucket, SidebarThreadSummary[]> {
  const buckets: Record<ActivityDateBucket, SidebarThreadSummary[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };
  for (const thread of threads) {
    buckets[resolveActivityDateBucket(thread, nowMs)].push(thread);
  }
  return buckets;
}

export type ActivityGroupMode = "time" | "project";

export type ActivityProjectGroup =
  | {
      key: string;
      kind: "project";
      projectId: ProjectId;
      threads: SidebarThreadSummary[];
    }
  | {
      key: "chats";
      kind: "chats";
      projectIds: ProjectId[];
      threads: SidebarThreadSummary[];
    };

export function groupActivityThreadsByProject(
  threads: readonly SidebarThreadSummary[],
  isRealProject: (projectId: ProjectId) => boolean,
): ActivityProjectGroup[] {
  const groupByKey = new Map<string, ActivityProjectGroup>();
  for (const thread of threads) {
    const key = isRealProject(thread.projectId) ? `project:${thread.projectId}` : "chats";
    const group = groupByKey.get(key);
    if (group) {
      group.threads.push(thread);
      if (group.kind === "chats" && !group.projectIds.includes(thread.projectId)) {
        group.projectIds.push(thread.projectId);
      }
      continue;
    }
    groupByKey.set(
      key,
      isRealProject(thread.projectId)
        ? {
            key,
            kind: "project",
            projectId: thread.projectId,
            threads: [thread],
          }
        : {
            key: "chats",
            kind: "chats",
            projectIds: [thread.projectId],
            threads: [thread],
          },
    );
  }

  const recencyByKey = new Map<string, number>();
  for (const group of groupByKey.values()) {
    let recencyMs = 0;
    for (const thread of group.threads) {
      recencyMs = Math.max(recencyMs, resolveActivityRecencyMs(thread));
    }
    recencyByKey.set(group.key, recencyMs);
  }

  return Array.from(groupByKey.values()).toSorted((left, right) => {
    return (
      recencyByKey.get(right.key)! - recencyByKey.get(left.key)! ||
      left.key.localeCompare(right.key)
    );
  });
}

export type ActivityScopeOption =
  | { kind: "project"; projectId: ProjectId; threadCount: number }
  | { kind: "chats"; projectIds: ProjectId[]; threadCount: number };

export function collectActivityScopeOptions(
  threads: readonly SidebarThreadSummary[],
  isRealProject: (projectId: ProjectId) => boolean,
): ActivityScopeOption[] {
  const countByProjectId = new Map<ProjectId, number>();
  for (const thread of threads) {
    if (!isActivityThread(thread)) continue;
    countByProjectId.set(thread.projectId, (countByProjectId.get(thread.projectId) ?? 0) + 1);
  }

  const options: ActivityScopeOption[] = [];
  const chatProjectIds: ProjectId[] = [];
  let chatThreadCount = 0;
  for (const [projectId, threadCount] of countByProjectId) {
    if (isRealProject(projectId)) {
      options.push({ kind: "project", projectId, threadCount });
    } else {
      chatProjectIds.push(projectId);
      chatThreadCount += threadCount;
    }
  }
  if (chatProjectIds.length > 0) {
    options.push({ kind: "chats", projectIds: chatProjectIds, threadCount: chatThreadCount });
  }
  return options.toSorted((left, right) => right.threadCount - left.threadCount);
}

export type ActivityScopeSelection = ProjectId | "chats" | null;

export function resolveActivityScope(
  scopeSelection: ActivityScopeSelection,
  scopeOptions: readonly ActivityScopeOption[],
): { scope: ActivityScopeSelection; projectFilterIds: Set<ProjectId> | null } {
  if (scopeSelection === null) return { scope: null, projectFilterIds: null };
  if (scopeSelection === "chats") {
    const chats = scopeOptions.find((option) => option.kind === "chats");
    if (!chats) return { scope: null, projectFilterIds: null };
    return { scope: "chats", projectFilterIds: new Set(chats.projectIds) };
  }
  const isOffered = scopeOptions.some(
    (option) => option.kind === "project" && option.projectId === scopeSelection,
  );
  if (!isOffered) return { scope: null, projectFilterIds: null };
  return { scope: scopeSelection, projectFilterIds: new Set([scopeSelection]) };
}

const ACTIVITY_RECENT_LIMIT = 5;

const ACTIVITY_DAY_START_HOUR = 4;

function resolveActivityDayStartMs(nowMs: number): number {
  const dayStart = new Date(nowMs);
  dayStart.setHours(ACTIVITY_DAY_START_HOUR, 0, 0, 0);
  if (dayStart.getTime() > nowMs) dayStart.setDate(dayStart.getDate() - 1);
  return dayStart.getTime();
}

export function splitRecentActivityThreads(
  active: readonly SidebarThreadSummary[],
  options: { nowMs: number; limit?: number },
): { recent: SidebarThreadSummary[]; rest: SidebarThreadSummary[] } {
  const limit = options.limit ?? ACTIVITY_RECENT_LIMIT;
  const dayStartMs = resolveActivityDayStartMs(options.nowMs);
  const recent = active
    .filter((thread) => parseTimestampMs(thread.latestHumanMessageAt) >= dayStartMs)
    .toSorted(
      (left, right) =>
        parseTimestampMs(right.latestHumanMessageAt) -
          parseTimestampMs(left.latestHumanMessageAt) || compareThreadIds(left, right),
    )
    .slice(0, limit);
  const recentThreadIds = new Set(recent.map((thread) => thread.id));
  return {
    recent,
    rest: active.filter((thread) => !recentThreadIds.has(thread.id)),
  };
}

// The Sidebar consumes this same list for jump shortcuts, next/previous navigation, prewarming, and
// live PR refreshes so hidden classic-project state cannot leak into the Activity surface.
export function collectVisibleActivityThreadIds(input: {
  groupMode: ActivityGroupMode;
  pinnedOpen: boolean;
  pinned: readonly SidebarThreadSummary[];
  recent: readonly SidebarThreadSummary[];
  today: readonly SidebarThreadSummary[];
  yesterday: readonly SidebarThreadSummary[];
  earlierOpen: boolean;
  earlier: readonly SidebarThreadSummary[];
  projectGroups: readonly (readonly SidebarThreadSummary[])[];
  settledOpen: boolean;
  settled: readonly SidebarThreadSummary[];
}): ThreadId[] {
  const visible: SidebarThreadSummary[] = [];
  if (input.pinnedOpen) visible.push(...input.pinned);
  if (input.groupMode === "project") {
    for (const group of input.projectGroups) visible.push(...group);
  } else {
    visible.push(...input.recent, ...input.today, ...input.yesterday);
    if (input.earlierOpen) visible.push(...input.earlier);
  }
  if (input.settledOpen) visible.push(...input.settled);
  return [...new Set(visible.map((thread) => thread.id))];
}

export function collectUnreadActivityThreads(
  threads: readonly SidebarThreadSummary[],
): SidebarThreadSummary[] {
  return threads.filter((thread) => isActivityThread(thread) && hasUnseenCompletion(thread));
}

export function hasUnreadActivity(
  threads: readonly SidebarThreadSummary[],
  activeThreadId: ThreadId | null,
): boolean {
  return collectUnreadActivityThreads(threads).some((thread) => thread.id !== activeThreadId);
}
