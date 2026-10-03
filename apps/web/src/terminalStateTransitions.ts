import {
  type TerminalActivityState,
  type TerminalCliKind,
} from "@glade/shared/threads/terminalThreads";
import {
  DEFAULT_THREAD_TERMINAL_ID,
  type ThreadTerminalPresentationMode,
  type ThreadTerminalWorkspaceLayout,
  type ThreadTerminalWorkspaceTab,
} from "./types";
import {
  ThreadTerminalState,
  clearTerminalReviewState,
  createUniqueTerminalTitle,
  createDefaultThreadTerminalState,
  normalizeThreadTerminalState,
  isValidTerminalId,
} from "./terminalStateNormalization";
export function setThreadTerminalOpen(
  state: ThreadTerminalState,
  open: boolean,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (normalized.terminalOpen === open) return normalized;
  return { ...normalized, terminalOpen: open };
}

export function openThreadChatPage(state: ThreadTerminalState): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  const nextWorkspaceState =
    normalized.terminalOpen && normalized.presentationMode === "workspace"
      ? {
          workspaceLayout: "both" as const,
          workspaceActiveTab: "chat" as const,
        }
      : null;
  if (normalized.entryPoint === "chat" && nextWorkspaceState === null) {
    return normalized;
  }
  if (nextWorkspaceState === null) {
    return {
      ...normalized,
      entryPoint: "chat",
    };
  }
  return {
    ...normalized,
    entryPoint: "chat",
    ...nextWorkspaceState,
  };
}

export function openThreadTerminalPage(
  state: ThreadTerminalState,
  options?: { terminalOnly?: boolean },
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  const shouldUseTerminalOnlyLayout =
    options?.terminalOnly ??
    (normalized.entryPoint === "terminal" ? normalized.workspaceLayout === "terminal-only" : true);
  const nextWorkspaceLayout = shouldUseTerminalOnlyLayout
    ? "terminal-only"
    : normalized.workspaceLayout;
  if (
    normalized.entryPoint === "terminal" &&
    normalized.terminalOpen &&
    normalized.presentationMode === "workspace" &&
    normalized.workspaceActiveTab === "terminal" &&
    normalized.workspaceLayout === nextWorkspaceLayout
  ) {
    return normalized;
  }
  return {
    ...normalized,
    entryPoint: "terminal",
    terminalOpen: true,
    presentationMode: "workspace",
    workspaceLayout: nextWorkspaceLayout,
    workspaceActiveTab: "terminal",
    terminalAttentionStatesById: clearTerminalReviewState(
      normalized.terminalAttentionStatesById,
      normalized.activeTerminalId,
    ),
  };
}

export function setThreadTerminalPresentationMode(
  state: ThreadTerminalState,
  mode: ThreadTerminalPresentationMode,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (normalized.presentationMode === mode) {
    return normalized;
  }
  return {
    ...normalized,
    terminalOpen: true,
    presentationMode: mode,
    workspaceLayout: normalized.workspaceLayout,
    workspaceActiveTab: mode === "workspace" ? "terminal" : normalized.workspaceActiveTab,
  };
}

export function setThreadTerminalWorkspaceTab(
  state: ThreadTerminalState,
  tab: ThreadTerminalWorkspaceTab,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  const nextWorkspaceLayout = tab === "chat" ? "both" : normalized.workspaceLayout;
  if (normalized.workspaceActiveTab === tab && normalized.workspaceLayout === nextWorkspaceLayout) {
    return normalized;
  }
  return {
    ...normalized,
    workspaceLayout: nextWorkspaceLayout,
    workspaceActiveTab: tab,
    terminalAttentionStatesById:
      tab === "terminal"
        ? clearTerminalReviewState(
            normalized.terminalAttentionStatesById,
            normalized.activeTerminalId,
          )
        : normalized.terminalAttentionStatesById,
  };
}

export function setThreadTerminalWorkspaceLayout(
  state: ThreadTerminalState,
  layout: ThreadTerminalWorkspaceLayout,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  const nextActiveTab =
    layout === "terminal-only"
      ? "terminal"
      : normalized.workspaceActiveTab === "chat"
        ? "chat"
        : "terminal";
  if (normalized.workspaceLayout === layout && normalized.workspaceActiveTab === nextActiveTab) {
    return normalized;
  }
  return {
    ...normalized,
    workspaceLayout: layout,
    workspaceActiveTab: nextActiveTab,
  };
}

export function setThreadTerminalHeight(
  state: ThreadTerminalState,
  height: number,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!Number.isFinite(height) || height <= 0 || normalized.terminalHeight === height) {
    return normalized;
  }
  return { ...normalized, terminalHeight: height };
}

export function setThreadTerminalMetadata(
  state: ThreadTerminalState,
  terminalId: string,
  metadata: {
    cliKind: TerminalCliKind | null;
    label: string;
  },
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const currentLabel = normalized.terminalLabelsById[terminalId] ?? "";
  const currentTitleOverride = normalized.terminalTitleOverridesById[terminalId]?.trim() ?? "";
  const currentCliKind = normalized.terminalCliKindsById[terminalId] ?? null;
  const nextCliKind = metadata.cliKind;
  const nextLabel =
    currentTitleOverride.length > 0
      ? currentLabel
      : nextCliKind !== null
        ? createUniqueTerminalTitle({
            cliKind: nextCliKind,
            excludeTerminalId: terminalId,
            terminalLabelsById: normalized.terminalLabelsById,
            terminalTitleOverridesById: normalized.terminalTitleOverridesById,
          })
        : metadata.label.trim().length > 0
          ? metadata.label.trim()
          : currentLabel;
  if (currentLabel === nextLabel && currentCliKind === nextCliKind) {
    return normalized;
  }
  const nextCliKindsById = { ...normalized.terminalCliKindsById };
  if (nextCliKind === null) {
    delete nextCliKindsById[terminalId];
  } else {
    nextCliKindsById[terminalId] = nextCliKind;
  }
  return {
    ...normalized,
    terminalLabelsById: {
      ...normalized.terminalLabelsById,
      [terminalId]: nextLabel,
    },
    terminalCliKindsById: nextCliKindsById,
  };
}

export function setThreadTerminalCliKind(
  state: ThreadTerminalState,
  terminalId: string,
  cliKind: TerminalCliKind | null,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const currentCliKind = normalized.terminalCliKindsById[terminalId] ?? null;
  if (currentCliKind === cliKind) {
    return normalized;
  }

  const nextCliKindsById = { ...normalized.terminalCliKindsById };
  if (cliKind === null) {
    delete nextCliKindsById[terminalId];
  } else {
    nextCliKindsById[terminalId] = cliKind;
  }

  const currentTitleOverride = normalized.terminalTitleOverridesById[terminalId]?.trim() ?? "";
  const terminalLabelsById =
    cliKind !== null && currentTitleOverride.length === 0
      ? {
          ...normalized.terminalLabelsById,
          [terminalId]: createUniqueTerminalTitle({
            cliKind,
            excludeTerminalId: terminalId,
            terminalLabelsById: normalized.terminalLabelsById,
            terminalTitleOverridesById: normalized.terminalTitleOverridesById,
          }),
        }
      : normalized.terminalLabelsById;

  return {
    ...normalized,
    terminalLabelsById,
    terminalCliKindsById: nextCliKindsById,
  };
}

export function setThreadTerminalTitleOverride(
  state: ThreadTerminalState,
  terminalId: string,
  titleOverride: string | null | undefined,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const normalizedTitleOverride = titleOverride?.trim() ?? "";
  const currentTitleOverride = normalized.terminalTitleOverridesById[terminalId] ?? "";
  if (currentTitleOverride === normalizedTitleOverride) {
    return normalized;
  }
  const nextTitleOverridesById = { ...normalized.terminalTitleOverridesById };
  if (normalizedTitleOverride.length === 0) {
    delete nextTitleOverridesById[terminalId];
  } else {
    nextTitleOverridesById[terminalId] = normalizedTitleOverride;
  }
  return {
    ...normalized,
    terminalTitleOverridesById: nextTitleOverridesById,
  };
}
export function newThreadTerminal(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!isValidTerminalId(terminalId)) return normalized;
  return normalizeThreadTerminalState({
    ...normalized,
    terminalOpen: true,
    terminalIds: normalized.terminalIds.includes(terminalId)
      ? normalized.terminalIds
      : [...normalized.terminalIds, terminalId],
    activeTerminalId: terminalId,
  });
}

export function setThreadActiveTerminal(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) return normalized;
  if (
    normalized.activeTerminalId === terminalId &&
    normalized.terminalAttentionStatesById[terminalId] !== "review"
  )
    return normalized;
  return {
    ...normalized,
    activeTerminalId: terminalId,
    terminalAttentionStatesById: clearTerminalReviewState(
      normalized.terminalAttentionStatesById,
      terminalId,
    ),
  };
}

export function closeThreadTerminal(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }

  const remainingTerminalIds = normalized.terminalIds.filter((id) => id !== terminalId);
  if (remainingTerminalIds.length === 0) {
    if (normalized.entryPoint === "terminal") {
      return normalizeThreadTerminalState({
        ...createDefaultThreadTerminalState(),
        entryPoint: "terminal",
        terminalOpen: false,
        presentationMode: normalized.presentationMode,
        workspaceLayout: normalized.workspaceLayout,
        workspaceActiveTab: "terminal",
        terminalHeight: normalized.terminalHeight,
      });
    }
    return createDefaultThreadTerminalState();
  }

  const closedTerminalIndex = normalized.terminalIds.indexOf(terminalId);
  const nextActiveTerminalId =
    normalized.activeTerminalId === terminalId
      ? (remainingTerminalIds[Math.min(closedTerminalIndex, remainingTerminalIds.length - 1)] ??
        DEFAULT_THREAD_TERMINAL_ID)
      : normalized.activeTerminalId;
  return normalizeThreadTerminalState({
    entryPoint: normalized.entryPoint,
    terminalOpen: normalized.terminalOpen,
    presentationMode: normalized.presentationMode,
    workspaceLayout: normalized.workspaceLayout,
    workspaceActiveTab: normalized.workspaceActiveTab,
    terminalHeight: normalized.terminalHeight,
    terminalIds: remainingTerminalIds,
    terminalLabelsById: Object.fromEntries(
      Object.entries(normalized.terminalLabelsById).filter(([id]) => id !== terminalId),
    ),
    terminalTitleOverridesById: Object.fromEntries(
      Object.entries(normalized.terminalTitleOverridesById).filter(([id]) => id !== terminalId),
    ),
    terminalCliKindsById: Object.fromEntries(
      Object.entries(normalized.terminalCliKindsById).filter(([id]) => id !== terminalId),
    ),
    terminalAttentionStatesById: Object.fromEntries(
      Object.entries(normalized.terminalAttentionStatesById).filter(([id]) => id !== terminalId),
    ),
    runningTerminalIds: normalized.runningTerminalIds.filter((id) => id !== terminalId),
    activeTerminalId: nextActiveTerminalId,
  });
}

export function closeThreadTerminalAndEnsureReplacement(
  state: ThreadTerminalState,
  terminalId: string,
  replacementTerminalId: string,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  if (normalized.terminalIds.length > 1) {
    return closeThreadTerminal(normalized, terminalId);
  }

  const withReplacement = newThreadTerminal(normalized, replacementTerminalId);
  if (!withReplacement.terminalIds.includes(replacementTerminalId)) {
    return normalized;
  }
  return closeThreadTerminal(withReplacement, terminalId);
}

export type TerminalExitDisposition = "ignored" | "remaining" | "final";

export function closeExitedThreadTerminal(
  state: ThreadTerminalState,
  terminalId: string,
): { state: ThreadTerminalState; disposition: TerminalExitDisposition } {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return { state: normalized, disposition: "ignored" };
  }
  return {
    state: closeThreadTerminal(normalized, terminalId),
    disposition: normalized.terminalIds.length === 1 ? "final" : "remaining",
  };
}

export function openThreadTerminalFullWidth(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  const nextState = newThreadTerminal(state, terminalId);
  return normalizeThreadTerminalState({
    ...nextState,
    terminalOpen: true,
    presentationMode: "workspace",
    workspaceLayout: "terminal-only",
    workspaceActiveTab: "terminal",
    activeTerminalId: terminalId,
  });
}

export function closeThreadWorkspaceChat(state: ThreadTerminalState): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (normalized.workspaceLayout === "terminal-only") {
    return normalized;
  }
  return {
    ...normalized,
    workspaceLayout: "terminal-only",
    workspaceActiveTab: "terminal",
  };
}

export function setThreadTerminalActivity(
  state: ThreadTerminalState,
  terminalId: string,
  activity: { agentState: TerminalActivityState | null; hasRunningSubprocess: boolean },
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const alreadyRunning = normalized.runningTerminalIds.includes(terminalId);
  const nextTerminalAttentionState =
    activity.agentState === "attention" || activity.agentState === "review"
      ? activity.agentState
      : null;
  const currentTerminalAttentionState = normalized.terminalAttentionStatesById[terminalId] ?? null;
  if (
    activity.hasRunningSubprocess === alreadyRunning &&
    nextTerminalAttentionState === currentTerminalAttentionState
  ) {
    return normalized;
  }
  const runningTerminalIds = new Set(normalized.runningTerminalIds);
  if (activity.hasRunningSubprocess) {
    runningTerminalIds.add(terminalId);
  } else {
    runningTerminalIds.delete(terminalId);
  }
  const terminalAttentionStatesById = { ...normalized.terminalAttentionStatesById };
  if (nextTerminalAttentionState === null) {
    delete terminalAttentionStatesById[terminalId];
  } else {
    terminalAttentionStatesById[terminalId] = nextTerminalAttentionState;
  }
  return {
    ...normalized,
    terminalAttentionStatesById,
    runningTerminalIds: [...runningTerminalIds],
  };
}
