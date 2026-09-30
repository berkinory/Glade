import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { isWorkspaceRootWithin, workspaceRootsEqual } from "@glade/shared/threads/threadWorkspace";
import type { SidebarThreadSummary, Thread } from "../types";
import { cn } from "../lib/utils";
import {
  SIDEBAR_ROW_ACTIVE_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
  SIDEBAR_THREAD_ROW_BASE_CLASS_NAME,
} from "../sidebarRowStyles";
import { isDuplicateProjectCreateError } from "../lib/projectCreateRecovery";
import { canSessionAnswerPendingRequests, hasLiveLatestTurn } from "../session-logic";
import {
  THREAD_STATUS_PRIORITY,
  createCompletedDismissalKey,
  createThreadStatusDismissalKey,
  hasUnseenCompletion,
} from "./Sidebar.logic.statusTypes";
import type {
  SidebarProjectEntry,
  ThreadStatusInput,
  ThreadStatusPill,
} from "./Sidebar.logic.statusTypes";

export type SidebarDerivedProjectData = {
  allProjectThreadCount: number;
  projectThreads: SidebarThreadSummary[];
  orderedProjectThreadIds: ThreadId[];
  visibleEntries: SidebarProjectEntry[];

  threadListExtraPages: number;
  canShowMoreThreads: boolean;
  activeEntryId: ThreadId | null;
  projectStatus: ReturnType<typeof resolveProjectStatusIndicator>;
};

// Reserve space only for visible row affordances. Tailwind requires complete literal classes.
export function resolveThreadRowTrailingReserveClass(input: {
  metaChipCount: number;
  hasTrailingGlyph: boolean;
}): string {
  const hoverReserve =
    "transition-[padding] duration-120 ease-out group-hover/thread-row:pr-[4.75rem] group-focus-within/thread-row:pr-[4.75rem]";
  const { metaChipCount, hasTrailingGlyph } = input;
  if (metaChipCount <= 0) {
    return cn(hasTrailingGlyph ? "pr-[1.75rem]" : "pr-2", hoverReserve);
  }
  if (metaChipCount === 1) {
    return cn(hasTrailingGlyph ? "pr-[3rem]" : "pr-[1.75rem]", hoverReserve);
  }
  if (metaChipCount === 2) {
    return cn(hasTrailingGlyph ? "pr-[4rem]" : "pr-[3rem]", hoverReserve);
  }
  return cn(hasTrailingGlyph ? "pr-[4.5rem]" : "pr-[4.25rem]", hoverReserve);
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName = SIDEBAR_THREAD_ROW_BASE_CLASS_NAME;
  if (input.isSelected || input.isActive) {
    return cn(baseClassName, SIDEBAR_ROW_ACTIVE_CLASS_NAME);
  }
  return cn(baseClassName, SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME, SIDEBAR_ROW_HOVER_CLASS_NAME);
}

export function isThreadActivelyWorking(thread: {
  hasLiveTailWork?: boolean | undefined;
  session?: Thread["session"] | undefined;
  latestTurn?: Thread["latestTurn"] | undefined;
}): boolean {
  if (thread.hasLiveTailWork === true) {
    return true;
  }
  const session = thread.session ?? null;
  return (
    session?.status === "running" &&
    (thread.latestTurn == null || hasLiveLatestTurn(thread.latestTurn, session))
  );
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
}): ThreadStatusPill | null {
  const { thread } = input;

  const canAnswerPendingRequests = canSessionAnswerPendingRequests(thread.session);
  const hasPendingApprovals = input.hasPendingApprovals && canAnswerPendingRequests;
  const hasPendingUserInput = input.hasPendingUserInput && canAnswerPendingRequests;

  if (hasPendingApprovals) {
    const dismissalKey = createThreadStatusDismissalKey("Pending Approval", thread);
    if (thread.dismissedStatusKey === dismissalKey) {
      return null;
    }
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
      dismissible: true,
      dismissalKey,
    };
  }

  if (hasPendingUserInput) {
    const dismissalKey = createThreadStatusDismissalKey("Awaiting Input", thread);
    if (thread.dismissedStatusKey === dismissalKey) {
      return null;
    }
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
      dismissible: true,
      dismissalKey,
    };
  }

  if (isThreadActivelyWorking(thread)) {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
      dismissible: false,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
      dismissible: false,
    };
  }

  if (!thread.hasLiveTailWork && hasUnseenCompletion(thread)) {
    const dismissalKey = createCompletedDismissalKey(thread);
    if (dismissalKey && thread.dismissedStatusKey === dismissalKey) {
      return null;
    }
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
      dismissible: true,
      ...(dismissalKey ? { dismissalKey } : {}),
    };
  }

  return null;
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}

export function findWorkspaceRootMatch<T>(
  items: readonly T[],
  targetWorkspaceRoot: string,
  getWorkspaceRoot: (item: T) => string,
): T | undefined {
  return items.find((item) => workspaceRootsEqual(getWorkspaceRoot(item), targetWorkspaceRoot));
}

export function findDeepestWorkspaceRootMatch<T>(
  items: readonly T[],
  targetPath: string,
  getWorkspaceRoot: (item: T) => string,
): T | undefined {
  let best: T | undefined;
  let bestRootLength = -1;
  for (const item of items) {
    const root = getWorkspaceRoot(item);
    if (!isWorkspaceRootWithin(targetPath, root)) {
      continue;
    }
    if (root.length > bestRootLength) {
      best = item;
      bestRootLength = root.length;
    }
  }
  return best;
}

export async function runExclusiveProjectAddition<T>(
  lock: { current: boolean },
  operation: () => Promise<T>,
): Promise<T> {
  if (lock.current) {
    throw new Error("Another project is already being added.");
  }

  lock.current = true;
  try {
    return await operation();
  } finally {
    lock.current = false;
  }
}

export async function runProjectProvisionWithCancellationRecovery<T>(input: {
  readonly signal: AbortSignal;
  readonly provision: () => Promise<T>;
  readonly recoverCommittedProject: () => Promise<boolean>;
}): Promise<
  { readonly status: "completed"; readonly result: T } | { readonly status: "recovered" }
> {
  try {
    return { status: "completed", result: await input.provision() };
  } catch (error) {
    if (!input.signal.aborted || !(await input.recoverCommittedProject())) {
      throw error;
    }
    return { status: "recovered" };
  }
}

export async function recoverExistingAddProjectTarget(input: {
  readonly existingProjectId: ProjectId | null | undefined;
  readonly workspaceRoot: string;
  readonly recoverByProjectId: (projectId: ProjectId) => Promise<boolean>;
  readonly recoverByWorkspaceRoot: (workspaceRoot: string) => Promise<boolean>;
}): Promise<"recovered" | "create"> {
  if (!input.existingProjectId) {
    return "create";
  }

  if (await input.recoverByProjectId(input.existingProjectId)) {
    return "recovered";
  }

  if (await input.recoverByWorkspaceRoot(input.workspaceRoot)) {
    return "recovered";
  }

  return "create";
}

export function describeAddProjectError(message: string): string | null {
  if (isDuplicateProjectCreateError(message)) {
    return "This usually means the folder is already linked to an existing project. On Windows, the same folder can arrive with a different path format, so it looks new even when it is not.";
  }

  if (
    message.startsWith("Failed to create project directory: /") ||
    message.startsWith("Project directory does not exist: /")
  ) {
    return "This is an absolute path from the filesystem root. If the folder is in your home directory, use ~/Developer/... or the full /Users/<name>/Developer/... path.";
  }

  return null;
}

export type SidebarThreadListPaging = {
  effectiveExtraPages: number;

  previewLimit: number;
  canShowMore: boolean;
  canShowLess: boolean;
};

export function resolveSidebarThreadListPaging(input: {
  totalCount: number;
  baseLimit: number;
  pageSize: number;
  requestedExtraPages: number;
}): SidebarThreadListPaging {
  const { baseLimit, pageSize, totalCount } = input;
  const hiddenBeyondBase = Math.max(0, totalCount - baseLimit);
  const maxExtraPages = pageSize > 0 ? Math.ceil(hiddenBeyondBase / pageSize) : 0;
  const requestedExtraPages = Number.isFinite(input.requestedExtraPages)
    ? Math.floor(input.requestedExtraPages)
    : 0;
  const effectiveExtraPages = Math.min(Math.max(0, requestedExtraPages), maxExtraPages);
  const previewLimit = baseLimit + effectiveExtraPages * pageSize;

  return {
    effectiveExtraPages,
    previewLimit,
    canShowMore: totalCount > previewLimit,
    canShowLess: effectiveExtraPages > 0,
  };
}

export interface SidebarThreadTreeRow<
  T extends Pick<SidebarThreadSummary, "id" | "parentThreadId">,
> {
  thread: T;
  depth: number;
  rootThreadId: T["id"];
}

function collectActiveThreadAncestorIds<
  T extends Pick<SidebarThreadSummary, "id" | "parentThreadId">,
>(threadById: Map<T["id"], T>, forceVisibleThreadId: T["id"] | undefined): Set<T["id"]> {
  const ancestorIds = new Set<T["id"]>();
  let currentThreadId = forceVisibleThreadId;

  while (currentThreadId) {
    const parentThreadId = threadById.get(currentThreadId)?.parentThreadId ?? undefined;
    if (!parentThreadId) {
      break;
    }
    ancestorIds.add(parentThreadId);
    currentThreadId = parentThreadId;
  }

  return ancestorIds;
}

export function buildProjectThreadTree<
  T extends Pick<SidebarThreadSummary, "id" | "parentThreadId">,
>(input: {
  threads: readonly T[];
  forceVisibleThreadId?: T["id"] | undefined;
}): SidebarThreadTreeRow<T>[] {
  const { forceVisibleThreadId, threads } = input;
  const threadById = new Map(threads.map((thread) => [thread.id, thread] as const));
  const childrenByParentId = new Map<T["id"], T[]>();
  const roots: T[] = [];

  for (const thread of threads) {
    const parentThreadId = thread.parentThreadId ?? null;
    if (!parentThreadId) {
      roots.push(thread);
      continue;
    }

    if (!threadById.has(parentThreadId)) {
      continue;
    }
    const siblings = childrenByParentId.get(parentThreadId) ?? [];
    siblings.push(thread);
    childrenByParentId.set(parentThreadId, siblings);
  }

  const activeThreadAncestorIds = collectActiveThreadAncestorIds(threadById, forceVisibleThreadId);
  const orderedRows: SidebarThreadTreeRow<T>[] = [];

  const visit = (thread: T, depth: number, rootThreadId: T["id"]) => {
    const childThreads = childrenByParentId.get(thread.id) ?? [];
    const revealsActiveDescendant =
      childThreads.length > 0 && activeThreadAncestorIds.has(thread.id);

    orderedRows.push({
      thread,
      depth,
      rootThreadId,
    });

    if (!revealsActiveDescendant) {
      return;
    }

    for (const child of childThreads) {
      visit(child, depth + 1, rootThreadId);
    }
  };

  for (const root of roots) {
    visit(root, 0, root.id);
  }

  return orderedRows;
}
