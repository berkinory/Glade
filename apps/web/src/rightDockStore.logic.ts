import { isRecord } from "@glade/shared/transport/payloadValues";
import type { TurnId } from "@glade/contracts/core/baseSchemas";
import { sanitizeStringKeyedRecord } from "./persistedRecord";

const RIGHT_DOCK_PANE_KINDS = ["browser", "explorer", "terminal", "git"] as const;

export type RightDockPaneKind = (typeof RIGHT_DOCK_PANE_KINDS)[number];
export type SourceControlView = "changes" | "history";

const RIGHT_DOCK_PANE_KIND_SET: ReadonlySet<string> = new Set(RIGHT_DOCK_PANE_KINDS);

export interface RightDockPane {
  id: string;
  kind: RightDockPaneKind;
  sourceControlView: SourceControlView;

  diffTurnId: TurnId | null;
  diffFilePath: string | null;
}

export interface RightDockThreadState {
  open: boolean;
  panes: RightDockPane[];
  activePaneId: string | null;
  filePaths: string[];
  activeFilePath: string | null;
}

export function createDefaultRightDockState(): RightDockThreadState {
  return {
    open: false,
    panes: [],
    activePaneId: null,
    filePaths: [],
    activeFilePath: null,
  };
}

function isRightDockPaneKind(value: unknown): value is RightDockPaneKind {
  return typeof value === "string" && RIGHT_DOCK_PANE_KIND_SET.has(value);
}

function sanitizePersistedPane(value: unknown): RightDockPane | null {
  if (!isRecord(value)) {
    return null;
  }
  const candidate = value;
  if (
    typeof candidate.id !== "string" ||
    (candidate.kind !== "diff" && candidate.kind !== "file" && !isRightDockPaneKind(candidate.kind))
  ) {
    return null;
  }
  return {
    id: candidate.id,
    kind:
      candidate.kind === "diff" ? "git" : candidate.kind === "file" ? "explorer" : candidate.kind,
    sourceControlView: candidate.sourceControlView === "history" ? "history" : "changes",
    diffTurnId: typeof candidate.diffTurnId === "string" ? (candidate.diffTurnId as TurnId) : null,
    diffFilePath: typeof candidate.diffFilePath === "string" ? candidate.diffFilePath : null,
  };
}

function sanitizeRightDockThreadState(value: unknown): RightDockThreadState {
  if (!isRecord(value)) {
    return createDefaultRightDockState();
  }
  const candidate = value;
  const sanitizedPanes = Array.isArray(candidate.panes)
    ? candidate.panes
        .map(sanitizePersistedPane)
        .filter((pane): pane is RightDockPane => pane !== null)
    : [];
  const persistedActivePaneId =
    typeof candidate.activePaneId === "string" ? candidate.activePaneId : null;
  const keptSingletonPaneIdByKind = new Map<RightDockPaneKind, string>();
  for (const pane of sanitizedPanes) {
    if (pane.id === persistedActivePaneId || !keptSingletonPaneIdByKind.has(pane.kind)) {
      keptSingletonPaneIdByKind.set(pane.kind, pane.id);
    }
  }
  const panes = sanitizedPanes.filter(
    (pane) => keptSingletonPaneIdByKind.get(pane.kind) === pane.id,
  );
  const rawPanes = Array.isArray(candidate.panes) ? candidate.panes : [];
  const legacyFiles = rawPanes.filter(isRecord).filter((pane) => pane.kind === "file");
  const filePaths = [
    ...new Set([
      ...(Array.isArray(candidate.filePaths)
        ? candidate.filePaths.filter(
            (path): path is string => typeof path === "string" && path.length > 0,
          )
        : []),
      ...legacyFiles
        .map((pane) => pane.filePath)
        .filter((path): path is string => typeof path === "string" && path.length > 0),
    ]),
  ];
  const legacyActiveFile = legacyFiles.find((pane) => pane.id === persistedActivePaneId)?.filePath;
  const requestedActiveFile =
    typeof legacyActiveFile === "string" ? legacyActiveFile : candidate.activeFilePath;
  const activeFilePath =
    typeof requestedActiveFile === "string" && filePaths.includes(requestedActiveFile)
      ? requestedActiveFile
      : (filePaths[0] ?? null);
  const activePaneId = legacyActiveFile
    ? (panes.find((pane) => pane.kind === "explorer")?.id ?? null)
    : persistedActivePaneId && panes.some((pane) => pane.id === persistedActivePaneId)
      ? persistedActivePaneId
      : (panes[0]?.id ?? null);
  return {
    open: candidate.open === true && panes.length > 0,
    panes,
    activePaneId,
    filePaths,
    activeFilePath,
  };
}

export function sanitizeRightDockStateByThreadId(
  value: unknown,
): Record<string, RightDockThreadState> {
  return sanitizeStringKeyedRecord(value, (raw) =>
    raw === undefined ? null : sanitizeRightDockThreadState(raw),
  );
}

export interface OpenPaneInput {
  paneId: string;
  kind: RightDockPaneKind;
  sourceControlView?: SourceControlView;
  diffTurnId?: TurnId | null;
  diffFilePath?: string | null;
}

function createPane(input: OpenPaneInput): RightDockPane {
  return {
    id: input.paneId,
    kind: input.kind,
    sourceControlView: input.sourceControlView ?? "changes",
    diffTurnId: input.diffTurnId ?? null,
    diffFilePath: input.diffFilePath ?? null,
  };
}

function singletonPaneReopenPatch(input: OpenPaneInput): Partial<RightDockPane> | null {
  if (input.kind === "git" && input.sourceControlView !== undefined) {
    return {
      sourceControlView: input.sourceControlView,
      ...(input.diffTurnId !== undefined ? { diffTurnId: input.diffTurnId } : {}),
      ...(input.diffFilePath !== undefined ? { diffFilePath: input.diffFilePath } : {}),
    };
  }
  return null;
}

function findSingletonPane(
  state: RightDockThreadState,
  kind: RightDockPaneKind,
): RightDockPane | undefined {
  return state.panes.find((pane) => pane.kind === kind);
}

export function openPaneInState(
  state: RightDockThreadState,
  input: OpenPaneInput,
): RightDockThreadState {
  const existing = findSingletonPane(state, input.kind);
  if (existing) {
    const patch = singletonPaneReopenPatch(input);
    const panes = patch
      ? state.panes.map((pane) => (pane.id === existing.id ? { ...pane, ...patch } : pane))
      : state.panes;
    return { ...state, open: true, panes, activePaneId: existing.id };
  }

  const pane = createPane(input);
  return {
    ...state,
    open: true,
    panes: [...state.panes, pane],
    activePaneId: pane.id,
  };
}

function resolveActiveAfterRemoval(
  panes: RightDockPane[],
  removedIndex: number,
  previousActiveId: string | null,
  removedId: string,
): string | null {
  if (previousActiveId !== removedId) {
    return previousActiveId;
  }
  if (panes.length === 0) {
    return null;
  }
  const neighborIndex = Math.min(removedIndex, panes.length - 1);
  return panes[neighborIndex]?.id ?? null;
}

export function closePaneInState(
  state: RightDockThreadState,
  paneId: string,
): RightDockThreadState {
  const removedIndex = state.panes.findIndex((pane) => pane.id === paneId);
  if (removedIndex === -1) {
    return state;
  }
  const nextPanes = state.panes.filter((pane) => pane.id !== paneId);
  const nextActiveId = resolveActiveAfterRemoval(
    nextPanes,
    removedIndex,
    state.activePaneId,
    paneId,
  );
  return {
    ...state,
    open: nextPanes.length > 0 && state.open,
    panes: nextPanes,
    activePaneId: nextActiveId,
  };
}

export function setActivePaneInState(
  state: RightDockThreadState,
  paneId: string,
): RightDockThreadState {
  if (!state.panes.some((pane) => pane.id === paneId)) {
    return state;
  }
  return { ...state, open: true, activePaneId: paneId };
}

export function setDockOpenInState(
  state: RightDockThreadState,
  open: boolean,
): RightDockThreadState {
  if (state.open === open) {
    return state;
  }
  return { ...state, open };
}

export function updatePaneInState(
  state: RightDockThreadState,
  paneId: string,
  patch: Partial<Pick<RightDockPane, "sourceControlView" | "diffTurnId" | "diffFilePath">>,
): RightDockThreadState {
  let changed = false;
  const nextPanes = state.panes.map((pane) => {
    if (pane.id !== paneId) {
      return pane;
    }
    const nextPane = { ...pane, ...patch };
    if (
      nextPane.sourceControlView !== pane.sourceControlView ||
      nextPane.diffTurnId !== pane.diffTurnId ||
      nextPane.diffFilePath !== pane.diffFilePath
    ) {
      changed = true;
      return nextPane;
    }
    return pane;
  });
  return changed ? { ...state, panes: nextPanes } : state;
}

// Header toggles behave like a visibility switch for a singleton kind: if that kind is the active
// visible pane, collapse the dock (preserving tabs); otherwise open/focus it.
export function toggleSingletonPaneInState(
  state: RightDockThreadState,
  input: OpenPaneInput,
): RightDockThreadState {
  const existing = findSingletonPane(state, input.kind);
  if (existing && state.open && state.activePaneId === existing.id) {
    return { ...state, open: false };
  }
  return openPaneInState(state, input);
}

export function resolveActivePane(state: RightDockThreadState): RightDockPane | null {
  if (!state.open || state.activePaneId === null) {
    return null;
  }
  return state.panes.find((pane) => pane.id === state.activePaneId) ?? null;
}
