import { type TerminalCliKind } from "@glade/shared/threads/terminalThreads";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  DEFAULT_THREAD_TERMINAL_HEIGHT,
  DEFAULT_THREAD_TERMINAL_ID,
  type ThreadPrimarySurface,
  type ThreadTerminalPresentationMode,
  type ThreadTerminalWorkspaceLayout,
  type ThreadTerminalWorkspaceTab,
} from "./types";
export interface ThreadTerminalState {
  entryPoint: ThreadPrimarySurface;
  terminalOpen: boolean;
  presentationMode: ThreadTerminalPresentationMode;
  workspaceLayout: ThreadTerminalWorkspaceLayout;
  workspaceActiveTab: ThreadTerminalWorkspaceTab;
  terminalHeight: number;
  terminalIds: string[];
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
  terminalCliKindsById: Record<string, TerminalCliKind>;
  terminalAttentionStatesById: Record<string, "attention" | "review">;
  runningTerminalIds: string[];
  activeTerminalId: string;
}

function normalizeTerminalIds(terminalIds: string[]): string[] {
  const ids = [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  return ids.length > 0 ? ids : [DEFAULT_THREAD_TERMINAL_ID];
}

function normalizeRunningTerminalIds(
  runningTerminalIds: string[],
  terminalIds: string[],
): string[] {
  if (runningTerminalIds.length === 0) return [];
  const validTerminalIdSet = new Set(terminalIds);
  return [...new Set(runningTerminalIds)]
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && validTerminalIdSet.has(id));
}

function normalizeTerminalLabels(
  terminalLabelsById: Record<string, string> | null | undefined,
  terminalIds: string[],
): Record<string, string> {
  const validTerminalIdSet = new Set(terminalIds);
  const normalizedEntries = Object.entries(terminalLabelsById ?? {})
    .map(([terminalId, label]) => [terminalId.trim(), label.trim()] as const)
    .filter(([terminalId, label]) => terminalId.length > 0 && label.length > 0)
    .filter(([terminalId]) => validTerminalIdSet.has(terminalId))
    .toSorted(([leftId], [rightId]) => leftId.localeCompare(rightId));
  return Object.fromEntries(normalizedEntries);
}

function normalizeTerminalTitleOverrides(
  terminalTitleOverridesById: Record<string, string> | null | undefined,
  terminalIds: string[],
): Record<string, string> {
  const validTerminalIdSet = new Set(terminalIds);
  const normalizedEntries = Object.entries(terminalTitleOverridesById ?? {})
    .map(([terminalId, titleOverride]) => [terminalId.trim(), titleOverride.trim()] as const)
    .filter(
      ([terminalId, titleOverride]) =>
        terminalId.length > 0 && titleOverride.length > 0 && validTerminalIdSet.has(terminalId),
    )
    .toSorted(([leftId], [rightId]) => leftId.localeCompare(rightId));
  return Object.fromEntries(normalizedEntries);
}

function normalizeTerminalCliKinds(
  terminalCliKindsById: Record<string, TerminalCliKind> | null | undefined,
  terminalIds: string[],
): Record<string, TerminalCliKind> {
  const validTerminalIdSet = new Set(terminalIds);
  const normalizedEntries = Object.entries(terminalCliKindsById ?? {})
    .map(([terminalId, cliKind]) => [terminalId.trim(), cliKind] as const)
    .filter(
      ([terminalId, cliKind]) =>
        terminalId.length > 0 && (cliKind === "codex" || cliKind === "claude"),
    )
    .filter(([terminalId]) => validTerminalIdSet.has(terminalId))
    .toSorted(([leftId], [rightId]) => leftId.localeCompare(rightId));
  return Object.fromEntries(normalizedEntries);
}

function normalizeTerminalAttentionStates(
  terminalAttentionStatesById: Record<string, "attention" | "review"> | null | undefined,
  terminalIds: string[],
): Record<string, "attention" | "review"> {
  const validTerminalIdSet = new Set(terminalIds);
  const normalizedEntries = Object.entries(terminalAttentionStatesById ?? {})
    .map(([terminalId, state]) => [terminalId.trim(), state] as const)
    .filter(
      ([terminalId, state]) =>
        terminalId.length > 0 && (state === "attention" || state === "review"),
    )
    .filter(([terminalId]) => validTerminalIdSet.has(terminalId))
    .toSorted(([leftId], [rightId]) => leftId.localeCompare(rightId));
  return Object.fromEntries(normalizedEntries);
}

export function clearTerminalReviewState(
  terminalAttentionStatesById: Record<string, "attention" | "review">,
  terminalId: string,
): Record<string, "attention" | "review"> {
  if (terminalAttentionStatesById[terminalId] !== "review") {
    return terminalAttentionStatesById;
  }
  const nextAttentionStatesById = { ...terminalAttentionStatesById };
  delete nextAttentionStatesById[terminalId];
  return nextAttentionStatesById;
}

function generatedTerminalTitleBase(cliKind: TerminalCliKind | null): string {
  if (cliKind === "codex") return "Codex";
  if (cliKind === "claude") return "Claude";
  return "Terminal";
}

function resolveTerminalDisplayTitle(options: {
  terminalId: string;
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
}): string {
  return (
    options.terminalTitleOverridesById[options.terminalId]?.trim() ||
    options.terminalLabelsById[options.terminalId]?.trim() ||
    ""
  );
}

export function createUniqueTerminalTitle(options: {
  cliKind: TerminalCliKind | null;
  excludeTerminalId?: string | undefined;
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById?: Record<string, string> | undefined;
}): string {
  const baseTitle = generatedTerminalTitleBase(options.cliKind);
  const takenTitles = new Set(
    Object.keys(options.terminalLabelsById)
      .filter((terminalId) => terminalId !== options.excludeTerminalId)
      .map((terminalId) =>
        resolveTerminalDisplayTitle({
          terminalId,
          terminalLabelsById: options.terminalLabelsById,
          terminalTitleOverridesById: options.terminalTitleOverridesById ?? {},
        }),
      )
      .filter((title) => title.length > 0),
  );
  let index = 1;
  while (true) {
    const candidate = `${baseTitle} ${index}`;
    if (!takenTitles.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

function ensureTerminalLabels(options: {
  terminalCliKindsById: Record<string, TerminalCliKind>;
  terminalIds: string[];
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
}): Record<string, string> {
  const nextLabelsById = { ...options.terminalLabelsById };
  for (const terminalId of options.terminalIds) {
    const existingLabel = nextLabelsById[terminalId]?.trim();
    if (existingLabel && existingLabel.length > 0) {
      continue;
    }
    nextLabelsById[terminalId] = createUniqueTerminalTitle({
      cliKind: options.terminalCliKindsById[terminalId] ?? null,
      excludeTerminalId: terminalId,
      terminalLabelsById: nextLabelsById,
      terminalTitleOverridesById: options.terminalTitleOverridesById,
    });
  }
  return nextLabelsById;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function threadTerminalStateEqual(left: ThreadTerminalState, right: ThreadTerminalState): boolean {
  return (
    left.entryPoint === right.entryPoint &&
    left.terminalOpen === right.terminalOpen &&
    left.presentationMode === right.presentationMode &&
    left.workspaceLayout === right.workspaceLayout &&
    left.workspaceActiveTab === right.workspaceActiveTab &&
    left.terminalHeight === right.terminalHeight &&
    left.activeTerminalId === right.activeTerminalId &&
    arraysEqual(left.terminalIds, right.terminalIds) &&
    JSON.stringify(left.terminalLabelsById) === JSON.stringify(right.terminalLabelsById) &&
    JSON.stringify(left.terminalTitleOverridesById) ===
      JSON.stringify(right.terminalTitleOverridesById) &&
    JSON.stringify(left.terminalCliKindsById) === JSON.stringify(right.terminalCliKindsById) &&
    JSON.stringify(left.terminalAttentionStatesById) ===
      JSON.stringify(right.terminalAttentionStatesById) &&
    arraysEqual(left.runningTerminalIds, right.runningTerminalIds)
  );
}

const DEFAULT_THREAD_TERMINAL_STATE: ThreadTerminalState = Object.freeze({
  entryPoint: "chat",
  terminalOpen: false,
  presentationMode: "drawer",
  workspaceLayout: "both",
  workspaceActiveTab: "terminal",
  terminalHeight: DEFAULT_THREAD_TERMINAL_HEIGHT,
  terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
  terminalLabelsById: { [DEFAULT_THREAD_TERMINAL_ID]: "Terminal 1" },
  terminalTitleOverridesById: {},
  terminalCliKindsById: {},
  terminalAttentionStatesById: {},
  runningTerminalIds: [],
  activeTerminalId: DEFAULT_THREAD_TERMINAL_ID,
});

export function createDefaultThreadTerminalState(): ThreadTerminalState {
  return {
    ...DEFAULT_THREAD_TERMINAL_STATE,
    terminalIds: [...DEFAULT_THREAD_TERMINAL_STATE.terminalIds],
    terminalLabelsById: { ...DEFAULT_THREAD_TERMINAL_STATE.terminalLabelsById },
    terminalTitleOverridesById: { ...DEFAULT_THREAD_TERMINAL_STATE.terminalTitleOverridesById },
    terminalCliKindsById: { ...DEFAULT_THREAD_TERMINAL_STATE.terminalCliKindsById },
    terminalAttentionStatesById: { ...DEFAULT_THREAD_TERMINAL_STATE.terminalAttentionStatesById },
    runningTerminalIds: [...DEFAULT_THREAD_TERMINAL_STATE.runningTerminalIds],
  };
}

export function getDefaultThreadTerminalState(): ThreadTerminalState {
  return DEFAULT_THREAD_TERMINAL_STATE;
}

export function normalizeThreadTerminalState(state: ThreadTerminalState): ThreadTerminalState {
  const terminalIds = normalizeTerminalIds(state.terminalIds);
  const nextTerminalIds = terminalIds.length > 0 ? terminalIds : [DEFAULT_THREAD_TERMINAL_ID];
  const terminalLabelsById = normalizeTerminalLabels(
    (state as Partial<ThreadTerminalState>).terminalLabelsById,
    nextTerminalIds,
  );
  const terminalTitleOverridesById = normalizeTerminalTitleOverrides(
    (state as Partial<ThreadTerminalState>).terminalTitleOverridesById,
    nextTerminalIds,
  );
  const terminalCliKindsById = normalizeTerminalCliKinds(
    (state as Partial<ThreadTerminalState>).terminalCliKindsById,
    nextTerminalIds,
  );
  const terminalAttentionStatesById = normalizeTerminalAttentionStates(
    (state as Partial<ThreadTerminalState>).terminalAttentionStatesById,
    nextTerminalIds,
  );
  const ensuredTerminalLabelsById = ensureTerminalLabels({
    terminalCliKindsById,
    terminalIds: nextTerminalIds,
    terminalLabelsById,
    terminalTitleOverridesById,
  });
  const runningTerminalIds = normalizeRunningTerminalIds(state.runningTerminalIds, nextTerminalIds);
  const activeTerminalId = nextTerminalIds.includes(state.activeTerminalId)
    ? state.activeTerminalId
    : (nextTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);
  const normalized: ThreadTerminalState = {
    entryPoint: state.entryPoint === "terminal" ? "terminal" : "chat",
    terminalOpen: state.terminalOpen,
    presentationMode: state.presentationMode === "workspace" ? "workspace" : "drawer",
    workspaceLayout: state.workspaceLayout === "terminal-only" ? "terminal-only" : "both",
    workspaceActiveTab: state.workspaceActiveTab === "chat" ? "chat" : "terminal",
    terminalHeight:
      Number.isFinite(state.terminalHeight) && state.terminalHeight > 0
        ? state.terminalHeight
        : DEFAULT_THREAD_TERMINAL_HEIGHT,
    terminalIds: nextTerminalIds,
    terminalLabelsById: ensuredTerminalLabelsById,
    terminalTitleOverridesById,
    terminalCliKindsById,
    terminalAttentionStatesById,
    runningTerminalIds,
    activeTerminalId,
  };
  return Object.keys(state).length === Object.keys(normalized).length &&
    threadTerminalStateEqual(state, normalized)
    ? state
    : normalized;
}

export function isDefaultThreadTerminalState(state: ThreadTerminalState): boolean {
  const normalized = normalizeThreadTerminalState(state);
  return threadTerminalStateEqual(normalized, DEFAULT_THREAD_TERMINAL_STATE);
}

function stripVolatileTerminalRuntimeState(state: ThreadTerminalState): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (
    normalized.runningTerminalIds.length === 0 &&
    Object.keys(normalized.terminalAttentionStatesById).length === 0
  ) {
    return normalized;
  }

  return {
    ...normalized,
    terminalAttentionStatesById: {},
    runningTerminalIds: [],
  };
}

export function sanitizePersistedTerminalStateByThreadId(
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState> | null | undefined,
): Record<ThreadId, ThreadTerminalState> {
  const next: Record<ThreadId, ThreadTerminalState> = {};
  for (const [threadId, state] of Object.entries(terminalStateByThreadId ?? {})) {
    if (threadId.startsWith("workspace:")) {
      continue;
    }
    const sanitized = stripVolatileTerminalRuntimeState(state);
    if (!isDefaultThreadTerminalState(sanitized)) {
      next[threadId as ThreadId] = sanitized;
    }
  }
  return next;
}

export function isValidTerminalId(terminalId: string): boolean {
  return terminalId.trim().length > 0;
}
