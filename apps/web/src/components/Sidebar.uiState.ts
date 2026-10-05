import type { ProjectId } from "@glade/contracts/core/baseSchemas";
import {
  readActivityScope,
  writeActivityScope,
  subscribeVisitScope,
} from "../threadVisitPersistence";
import { normalizeWorkspaceRootForComparison } from "@glade/shared/threads/threadWorkspace";
import type { LastThreadRoute } from "../chatRouteRestore";

const SIDEBAR_UI_STATE_STORAGE_KEY = "glade:sidebar-ui:v1";

export type SidebarUiState = {
  chatSectionExpanded: boolean;
  projectThreadListExtraPagesByCwd: Record<string, number>;
  dismissedThreadStatusKeyByThreadId: Record<string, string>;
  lastThreadRoute: LastThreadRoute | null;

  activityViewEnabled: boolean;
  activityScope: ProjectId | "chats" | null;
};

const DEFAULT_SIDEBAR_UI_STATE: SidebarUiState = {
  chatSectionExpanded: true,
  projectThreadListExtraPagesByCwd: {},
  dismissedThreadStatusKeyByThreadId: {},
  lastThreadRoute: null,
  activityViewEnabled: false,
  activityScope: null,
};

const MAX_PERSISTED_THREAD_LIST_EXTRA_PAGES = 1000;

export function normalizeSidebarProjectThreadListCwd(cwd: string): string {
  return normalizeWorkspaceRootForComparison(cwd);
}

function sanitizeThreadListExtraPages(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(0, Math.floor(value)), MAX_PERSISTED_THREAD_LIST_EXTRA_PAGES);
}

function sanitizeProjectThreadListExtraPagesByCwd(
  value: Record<string, unknown> | undefined,
): Record<string, number> {
  const extraPagesByCwd: Record<string, number> = {};
  for (const [cwd, rawExtraPages] of Object.entries(value ?? {})) {
    if (typeof cwd !== "string") {
      continue;
    }
    const normalizedCwd = normalizeSidebarProjectThreadListCwd(cwd);
    const extraPages = sanitizeThreadListExtraPages(rawExtraPages);
    if (normalizedCwd.length === 0 || extraPages <= 0) {
      continue;
    }

    extraPagesByCwd[normalizedCwd] = Math.max(extraPagesByCwd[normalizedCwd] ?? 0, extraPages);
  }
  return extraPagesByCwd;
}

export function readSidebarUiState(): SidebarUiState {
  if (typeof window === "undefined") {
    return { ...DEFAULT_SIDEBAR_UI_STATE, activityScope: readActivityScope() };
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_UI_STATE_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SIDEBAR_UI_STATE, activityScope: readActivityScope() };
    }

    const parsed = JSON.parse(raw) as {
      chatSectionExpanded?: boolean;
      projectThreadListExtraPagesByCwd?: Record<string, unknown>;

      expandedProjectThreadListCwds?: string[];
      dismissedThreadStatusKeyByThreadId?: Record<string, string>;
      lastThreadRoute?: {
        threadId?: unknown;
        splitViewId?: unknown;
      } | null;
      activityViewEnabled?: boolean;
    };

    const lastThreadRoute =
      parsed.lastThreadRoute &&
      typeof parsed.lastThreadRoute.threadId === "string" &&
      parsed.lastThreadRoute.threadId.length > 0
        ? {
            threadId: parsed.lastThreadRoute.threadId,
            ...(typeof parsed.lastThreadRoute.splitViewId === "string" &&
            parsed.lastThreadRoute.splitViewId.length > 0
              ? { splitViewId: parsed.lastThreadRoute.splitViewId }
              : {}),
          }
        : null;

    const projectThreadListExtraPagesByCwd = sanitizeProjectThreadListExtraPagesByCwd(
      parsed.projectThreadListExtraPagesByCwd,
    );

    for (const legacyCwd of parsed.expandedProjectThreadListCwds ?? []) {
      if (typeof legacyCwd !== "string") {
        continue;
      }
      const normalizedCwd = normalizeSidebarProjectThreadListCwd(legacyCwd);
      if (normalizedCwd.length === 0 || projectThreadListExtraPagesByCwd[normalizedCwd]) {
        continue;
      }
      projectThreadListExtraPagesByCwd[normalizedCwd] = 1;
    }

    return {
      chatSectionExpanded:
        typeof parsed.chatSectionExpanded === "boolean"
          ? parsed.chatSectionExpanded
          : DEFAULT_SIDEBAR_UI_STATE.chatSectionExpanded,
      projectThreadListExtraPagesByCwd,
      dismissedThreadStatusKeyByThreadId: Object.fromEntries(
        Object.entries(parsed.dismissedThreadStatusKeyByThreadId ?? {}).filter(
          ([threadId, statusKey]) =>
            typeof threadId === "string" &&
            threadId.length > 0 &&
            typeof statusKey === "string" &&
            statusKey.length > 0,
        ),
      ),
      lastThreadRoute,
      activityViewEnabled: parsed.activityViewEnabled === true,
      activityScope: readActivityScope(),
    };
  } catch {
    return { ...DEFAULT_SIDEBAR_UI_STATE, activityScope: readActivityScope() };
  }
}

export function subscribeSidebarUiState(listener: (state: SidebarUiState) => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== SIDEBAR_UI_STATE_STORAGE_KEY && !event.key?.startsWith("glade:visits:"))
      return;
    listener(readSidebarUiState());
  };
  window.addEventListener("storage", handleStorage);
  const unsubscribe = subscribeVisitScope(() => listener(readSidebarUiState()));
  return () => {
    unsubscribe();
    window.removeEventListener("storage", handleStorage);
  };
}

export function persistSidebarUiState(input: SidebarUiState): void {
  if (typeof window === "undefined") {
    return;
  }

  writeActivityScope(input.activityScope);
  try {
    window.localStorage.setItem(
      SIDEBAR_UI_STATE_STORAGE_KEY,
      JSON.stringify({
        chatSectionExpanded: input.chatSectionExpanded,
        projectThreadListExtraPagesByCwd: sanitizeProjectThreadListExtraPagesByCwd(
          input.projectThreadListExtraPagesByCwd,
        ),
        dismissedThreadStatusKeyByThreadId: Object.fromEntries(
          Object.entries(input.dismissedThreadStatusKeyByThreadId).filter(
            ([threadId, statusKey]) => threadId.length > 0 && statusKey.length > 0,
          ),
        ),
        lastThreadRoute: input.lastThreadRoute
          ? {
              threadId: input.lastThreadRoute.threadId,
              ...(input.lastThreadRoute.splitViewId
                ? { splitViewId: input.lastThreadRoute.splitViewId }
                : {}),
            }
          : null,
        activityViewEnabled: input.activityViewEnabled,
      }),
    );
  } catch {}
}
