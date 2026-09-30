import type { ProjectId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { ThreadEnvironmentMode } from "@glade/contracts/orchestration/orchestration";
import { resolveThreadWorkspaceCwd } from "@glade/shared/threadEnvironment";

import type { ChatRightPanel, DiffRouteSearch } from "../diffRouteSearch";

export interface ChatPanelStateSnapshot {
  panel: ChatRightPanel | null;
  diffTurnId: TurnId | null;
  diffFilePath: string | null;
}

export interface ChatPanelStatePatch {
  panel?: ChatRightPanel | null;
  diffTurnId?: TurnId | null;
  diffFilePath?: string | null;
}

export interface RoutePanelBootstrapResult {
  nextAppliedSearchKey: string | null;
  panelPatch: ChatPanelStatePatch | null;
}

export interface SplitPaneMaximizeDecision {
  splitViewIdToRemove: string;
  threadId: ThreadId;
  panelState: ChatPanelStateSnapshot | null;
}

export function resolveThreadPickerTitle(title: string | null): string {
  return title || "New chat";
}

export function resolveFilePreviewWorkspaceRoot(input: {
  projectCwd?: string | null | undefined;
  threadEnvMode?: ThreadEnvironmentMode | null | undefined;
  threadWorktreePath?: string | null | undefined;
  threadWorkingDirectory?: string | null | undefined;
}): string | null {
  return resolveThreadWorkspaceCwd({
    projectCwd: input.projectCwd,
    envMode: input.threadEnvMode,
    worktreePath: input.threadWorktreePath,
    workingDirectory: input.threadWorkingDirectory,
  });
}

export function resolveSingleProjectId(input: {
  threadProjectId: ProjectId | null;
  draftProjectId: ProjectId | null;
}): ProjectId | null {
  return input.threadProjectId ?? input.draftProjectId ?? null;
}

export function normalizeSingleSearchFromPane(
  panelState: Pick<ChatPanelStateSnapshot, "panel" | "diffTurnId" | "diffFilePath">,
): DiffRouteSearch {
  if (panelState.panel === "browser") {
    return { panel: "browser" };
  }
  if (panelState.panel === "diff") {
    return {
      panel: "diff",
      diff: "1",
      ...(panelState.diffTurnId ? { diffTurnId: panelState.diffTurnId } : {}),
      ...(panelState.diffFilePath ? { diffFilePath: panelState.diffFilePath } : {}),
    };
  }
  return {};
}

function createRoutePanelSearchKey(input: {
  scopeId: string;
  search: DiffRouteSearch;
}): string | null {
  const { scopeId, search } = input;
  if (
    search.panel === undefined &&
    search.diff === undefined &&
    search.diffTurnId === undefined &&
    search.diffFilePath === undefined
  ) {
    return null;
  }

  return JSON.stringify({
    scopeId,
    panel: search.panel ?? (search.diff ? "diff" : null),
    diffTurnId: search.diffTurnId ?? null,
    diffFilePath: search.diffFilePath ?? null,
  });
}

export function resolveRoutePanelBootstrap(input: {
  scopeId: string;
  search: DiffRouteSearch;
  lastAppliedSearchKey: string | null;
}): RoutePanelBootstrapResult {
  const nextAppliedSearchKey = createRoutePanelSearchKey({
    scopeId: input.scopeId,
    search: input.search,
  });

  if (nextAppliedSearchKey === null) {
    return {
      nextAppliedSearchKey: null,
      panelPatch: null,
    };
  }

  if (input.lastAppliedSearchKey === nextAppliedSearchKey) {
    return {
      nextAppliedSearchKey,
      panelPatch: null,
    };
  }

  return {
    nextAppliedSearchKey,
    panelPatch: {
      panel: input.search.panel ?? (input.search.diff ? "diff" : null),
      diffTurnId: input.search.diffTurnId ?? null,
      diffFilePath: input.search.diffFilePath ?? null,
    },
  };
}

export function resolveToggledChatPanelPatch(
  previousState: ChatPanelStateSnapshot,
  panel: ChatRightPanel,
): ChatPanelStatePatch {
  return {
    panel: previousState.panel === panel ? null : panel,
    diffTurnId: previousState.diffTurnId,
    diffFilePath: previousState.diffFilePath,
  };
}

export function resolveSplitPaneMaximizeDecision(input: {
  splitViewId: string;
  focusedThreadId: ThreadId | null | undefined;
  focusedPanelState: ChatPanelStateSnapshot | null | undefined;
}): SplitPaneMaximizeDecision | null {
  if (!input.focusedThreadId) {
    return null;
  }

  return {
    splitViewIdToRemove: input.splitViewId,
    threadId: input.focusedThreadId,
    panelState: input.focusedPanelState ?? null,
  };
}
