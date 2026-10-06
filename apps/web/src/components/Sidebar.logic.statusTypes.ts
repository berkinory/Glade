import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { resolveThreadEnvironmentMode } from "@glade/shared/threads/threadEnvironment";
import { resolveRestorableThreadRoute, type LastThreadRoute } from "../chatRouteRestore";
import type { ChatMessage, Project, SidebarThreadSummary, Thread } from "../types";
import { formatWorktreePathForDisplay } from "../worktreeCleanup";

const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";

export const SIDEBAR_THREAD_PREWARM_LIMIT = 10;

export const DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY = "glade:show-debug-feature-flags-menu";

export type SidebarActionBadge = {
  readonly text: string;
  readonly accessibleLabel: string;
};

export function isProjectsSidebarSurface(input: { readonly isOnSettings: boolean }): boolean {
  return !input.isOnSettings;
}

export function resolveSidebarThreadPullRequest<
  T extends { readonly headBranch: string; readonly state: "open" | "closed" | "merged" },
>(input: {
  readonly threadBranch: string | null;
  readonly liveBranch: string | null;
  readonly hasLiveStatus: boolean;
  readonly hasDedicatedWorktree: boolean;
  readonly livePullRequest: T | null;
  readonly persistedPullRequest: T | null;
}): T | null {
  // A shared local checkout can move because another thread is working in the same project root. Its
  // live PR must never overwrite the durable PR explicitly associated with this thread.
  if (!input.hasDedicatedWorktree) {
    return input.persistedPullRequest;
  }

  // A settled (merged/closed) PR is the thread's outcome, not a claim about the current checkout, so
  // it stays visible after the checkout moves on — e.g. switching back to main after merging must
  // flip the badge to "merged", not drop it and let stale metadata elsewhere keep it "open".
  const settledPersistedPullRequest =
    input.persistedPullRequest !== null && input.persistedPullRequest.state !== "open"
      ? input.persistedPullRequest
      : null;
  const persistedValidationBranch = input.hasLiveStatus ? input.liveBranch : input.threadBranch;
  const persistedPullRequest =
    input.persistedPullRequest !== null &&
    (persistedValidationBranch === null ||
      input.persistedPullRequest.headBranch === persistedValidationBranch)
      ? input.persistedPullRequest
      : settledPersistedPullRequest;
  if (!input.hasLiveStatus) {
    return persistedPullRequest;
  }
  if (input.liveBranch === null) {
    return settledPersistedPullRequest;
  }
  if (input.livePullRequest !== null) {
    return input.livePullRequest;
  }
  return persistedPullRequest !== null && persistedPullRequest.headBranch === input.liveBranch
    ? persistedPullRequest
    : settledPersistedPullRequest;
}

export type SidebarProject = {
  id: string;
  name: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};

export type SidebarThreadSortInput = {
  createdAt: string;
  updatedAt?: string | undefined;
  latestUserMessageAt?: string | null | undefined;
  messages?: ReadonlyArray<Pick<ChatMessage, "role" | "createdAt">> | undefined;
};

function nonEmptyDisplayValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function differentDisplayValue(
  value: string | null | undefined,
  existing: string | null,
): string | null {
  const normalized = nonEmptyDisplayValue(value);
  if (!normalized) {
    return null;
  }
  return existing !== null && normalized === existing ? null : normalized;
}

// Single rule shared by the Activity rows, pinned-row suffixes, and thread hover cards, so a chat's
// auto-generated slug folder never leaks into the UI as a fake "project name".
export function resolveThreadProjectLabel(
  project: Pick<Project, "kind" | "name" | "folderName"> | null | undefined,
): string {
  if (!project || project.kind !== "project") {
    return "Chat";
  }
  return nonEmptyDisplayValue(project.name) ?? project.folderName;
}

export function resolveSidebarProjectRowLabel(
  project: Pick<Project, "name" | "folderName">,
): string {
  return nonEmptyDisplayValue(project.name) ?? project.folderName;
}

export type SidebarThreadHoverMetadata = {
  projectName: string;
  projectCwd: string | null;
  sourceProjectName: string | null;
  branch: string | null;
  worktreeName: string | null;
};

export function resolveThreadDisplayBranch(
  thread: Pick<
    SidebarThreadSummary,
    "envMode" | "branch" | "worktreePath" | "associatedWorktreeBranch"
  >,
): string | null {
  const currentBranch = nonEmptyDisplayValue(thread.branch);
  if (currentBranch !== null) return currentBranch;

  const isActiveWorktree =
    resolveThreadEnvironmentMode({
      envMode: thread.envMode,
      worktreePath: thread.worktreePath,
    }) === "worktree";
  return isActiveWorktree ? null : nonEmptyDisplayValue(thread.associatedWorktreeBranch);
}

export function resolveThreadHoverCardMetadata(input: {
  thread: Pick<
    SidebarThreadSummary,
    "envMode" | "branch" | "worktreePath" | "associatedWorktreePath" | "associatedWorktreeBranch"
  >;
  project: Pick<Project, "kind" | "name" | "folderName" | "cwd"> | null;
}): SidebarThreadHoverMetadata {
  const projectName = resolveThreadProjectLabel(input.project);
  const activeWorktreePath = nonEmptyDisplayValue(input.thread.worktreePath);
  const isWorktree =
    resolveThreadEnvironmentMode({
      envMode: input.thread.envMode,
      worktreePath: activeWorktreePath,
    }) === "worktree";
  const associatedWorktreePath = nonEmptyDisplayValue(input.thread.associatedWorktreePath);
  const worktreePath = isWorktree ? (associatedWorktreePath ?? activeWorktreePath) : null;

  return {
    projectName,
    projectCwd: input.project?.cwd ?? null,
    sourceProjectName: isWorktree
      ? differentDisplayValue(input.project?.folderName, projectName)
      : null,
    branch: resolveThreadDisplayBranch(input.thread),
    worktreeName: worktreePath ? formatWorktreePathForDisplay(worktreePath) : null,
  };
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.$/, "");

  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1" ||
    normalizedHostname === "[::1]"
  );
}

export function shouldShowDebugFeatureFlagsMenu(input: {
  readonly isDev: boolean;
  readonly hostname: string;
  readonly storageValue: string | null;
}): boolean {
  return input.isDev && isLoopbackHostname(input.hostname) && input.storageValue === "true";
}

export type SidebarProjectEntry = {
  kind: "thread";
  rowId: ThreadId;
  rootRowId: ThreadId;
  thread: SidebarThreadSummary;
  depth: number;
};

export type SidebarThreadHoverAnchorScope = "pinned" | "chat" | "project" | "activity";

export function createSidebarThreadHoverAnchorId(input: {
  scope: SidebarThreadHoverAnchorScope;
  threadId: ThreadId;
}): string {
  return `${input.scope}:${input.threadId}`;
}

export interface ThreadStatusPill {
  label:
    | "Background failed"
    | "Background"
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
  dismissible?: boolean;
  dismissalKey?: string;
}

// Single owner of the visibility rule so the classic thread rows, the collapsed project rows and
// the Activity rows can never disagree about when a spinner or an unread-completion dot is on
// screen; only the surface-specific suppressions are passed in. - `slotOccupied`: another
// affordance owns the slot right now (e.g. the thread jump shortcut label), so the status stays
// hidden until it clears. - `isActive`: the row's thread is open, so a completion the user is
// already looking at is not advertised as unread. Every other status still asks something of the
// user (or is live work), so it survives even on a dimmed/settled row.
export function resolveThreadStatusTrailingIndicator(input: {
  status: ThreadStatusPill | null;
  slotOccupied?: boolean;
  isActive?: boolean;
}): ThreadStatusPill | null {
  const { status } = input;
  if (status === null || input.slotOccupied === true) {
    return null;
  }
  if (status.label === "Completed" && input.isActive === true) {
    return null;
  }
  return status;
}

export const THREAD_STATUS_PRIORITY: Record<ThreadStatusPill["label"], number> = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  Working: 3,
  Background: 3,
  "Background failed": 2,
  Connecting: 3,
  "Plan Ready": 2,
  Completed: 1,
};

export type ThreadStatusInput = Pick<
  Thread,
  "latestTurn" | "lastVisitedAt" | "session" | "updatedAt" | "backgroundWork"
> & {
  hasLiveTailWork?: boolean | undefined;
  dismissedStatusKey?: string | undefined;
};

export function createThreadStatusDismissalKey(
  label: Extract<ThreadStatusPill["label"], "Pending Approval" | "Awaiting Input" | "Plan Ready">,
  thread: ThreadStatusInput,
): string {
  return [
    label,
    thread.updatedAt ?? "",
    thread.latestTurn?.turnId ?? "",
    thread.latestTurn?.completedAt ?? "",
    thread.session?.updatedAt ?? "",
  ].join(":");
}

export function createCompletedDismissalKey(thread: ThreadStatusInput): string | null {
  if (!thread.latestTurn?.completedAt) {
    return null;
  }

  return ["Completed", thread.latestTurn.turnId, thread.latestTurn.completedAt].join(":");
}

export function hasUnseenCompletion(thread: Pick<Thread, "latestTurn" | "lastVisitedAt">): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export type SettingsBackTarget =
  | {
      kind: "thread";
      threadId: string;
      splitViewId?: string | undefined;
    }
  | {
      kind: "home";
    };

export function resolveSettingsBackTarget(input: {
  lastThreadRoute: LastThreadRoute | null;
  availableThreadIds: ReadonlySet<string>;
  latestThreadId: string | null;
  availableSplitViewIds?: ReadonlySet<string>;
}): SettingsBackTarget {
  const restorableRoute = resolveRestorableThreadRoute({
    lastThreadRoute: input.lastThreadRoute,
    availableThreadIds: input.availableThreadIds,
    ...(input.availableSplitViewIds ? { availableSplitViewIds: input.availableSplitViewIds } : {}),
  });

  if (restorableRoute) {
    return {
      kind: "thread",
      threadId: restorableRoute.threadId,
      splitViewId: restorableRoute.splitViewId,
    };
  }

  if (input.latestThreadId) {
    return {
      kind: "thread",
      threadId: input.latestThreadId,
    };
  }

  return { kind: "home" };
}

export function pruneProjectThreadListPagingForCollapsedProjects<
  T extends Pick<Project, "cwd" | "expanded">,
>(input: {
  threadListExtraPagesByProjectCwd: ReadonlyMap<string, number>;
  projects: readonly T[];
  normalizeProjectCwd: (cwd: string) => string;
}): ReadonlyMap<string, number> {
  const { normalizeProjectCwd, projects, threadListExtraPagesByProjectCwd } = input;
  const collapsedProjectCwds = new Set(
    projects
      .filter((project) => !project.expanded)
      .map((project) => normalizeProjectCwd(project.cwd))
      .filter((cwd) => cwd.length > 0),
  );

  if (collapsedProjectCwds.size === 0) {
    return threadListExtraPagesByProjectCwd;
  }

  let changed = false;
  const nextThreadListExtraPagesByProjectCwd = new Map<string, number>();
  for (const [cwd, extraPages] of threadListExtraPagesByProjectCwd) {
    if (collapsedProjectCwds.has(cwd)) {
      changed = true;
      continue;
    }
    nextThreadListExtraPagesByProjectCwd.set(cwd, extraPages);
  }

  return changed ? nextThreadListExtraPagesByProjectCwd : threadListExtraPagesByProjectCwd;
}
