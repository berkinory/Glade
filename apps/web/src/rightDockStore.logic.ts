import { isRecord } from "@glade/shared/transport/payloadValues";
import type { ProjectId, TurnId } from "@glade/contracts/core/baseSchemas";
import { sanitizeStringKeyedRecord } from "./persistedRecord";

const RIGHT_DOCK_PANE_KINDS = [
  "browser",
  "device",
  "explorer",
  "file",
  "terminal",
  "git",
  "pullRequest",
] as const;

export type RightDockPaneKind = (typeof RIGHT_DOCK_PANE_KINDS)[number];
type PullRequestInitialTab = "summary" | "timeline" | "code";
export type SourceControlView = "changes" | "review" | "history";

const RIGHT_DOCK_PANE_KIND_SET: ReadonlySet<string> = new Set(RIGHT_DOCK_PANE_KINDS);

export interface RightDockPane {
  id: string;
  kind: RightDockPaneKind;
  sourceControlView: SourceControlView;

  diffTurnId: TurnId | null;
  diffFilePath: string | null;

  filePath: string | null;
  pullRequestProjectId: ProjectId | null;
  pullRequestRepository: string | null;
  pullRequestNumber: number | null;
  pullRequestInitialTab: PullRequestInitialTab | null;
}

export interface RightDockThreadState {
  open: boolean;
  panes: RightDockPane[];
  activePaneId: string | null;
}

const MULTI_INSTANCE_PANE_KINDS: ReadonlySet<RightDockPaneKind> = new Set(["file"]);

const SINGLETON_PANE_KINDS: ReadonlySet<RightDockPaneKind> = new Set(
  RIGHT_DOCK_PANE_KINDS.filter((kind) => !MULTI_INSTANCE_PANE_KINDS.has(kind)),
);

function isSingletonPaneKind(kind: RightDockPaneKind): boolean {
  return SINGLETON_PANE_KINDS.has(kind);
}

export function createDefaultRightDockState(): RightDockThreadState {
  return {
    open: false,
    panes: [],
    activePaneId: null,
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
    (candidate.kind !== "diff" && !isRightDockPaneKind(candidate.kind))
  ) {
    return null;
  }
  return {
    id: candidate.id,
    kind: candidate.kind === "diff" ? "git" : candidate.kind,
    sourceControlView:
      candidate.kind === "diff" || candidate.sourceControlView === "review"
        ? "review"
        : candidate.sourceControlView === "history"
          ? "history"
          : "changes",
    diffTurnId: typeof candidate.diffTurnId === "string" ? (candidate.diffTurnId as TurnId) : null,
    diffFilePath: typeof candidate.diffFilePath === "string" ? candidate.diffFilePath : null,
    filePath: typeof candidate.filePath === "string" ? candidate.filePath : null,
    pullRequestProjectId:
      typeof candidate.pullRequestProjectId === "string"
        ? (candidate.pullRequestProjectId as ProjectId)
        : null,
    pullRequestRepository:
      typeof candidate.pullRequestRepository === "string" ? candidate.pullRequestRepository : null,
    pullRequestNumber:
      typeof candidate.pullRequestNumber === "number" &&
      Number.isInteger(candidate.pullRequestNumber) &&
      candidate.pullRequestNumber > 0
        ? candidate.pullRequestNumber
        : null,
    pullRequestInitialTab:
      candidate.pullRequestInitialTab === "summary" ||
      candidate.pullRequestInitialTab === "timeline" ||
      candidate.pullRequestInitialTab === "code"
        ? candidate.pullRequestInitialTab
        : null,
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
    if (
      isSingletonPaneKind(pane.kind) &&
      (pane.id === persistedActivePaneId || !keptSingletonPaneIdByKind.has(pane.kind))
    ) {
      keptSingletonPaneIdByKind.set(pane.kind, pane.id);
    }
  }
  const panes = sanitizedPanes.filter(
    (pane) =>
      !isSingletonPaneKind(pane.kind) || keptSingletonPaneIdByKind.get(pane.kind) === pane.id,
  );
  const activePaneId =
    persistedActivePaneId && panes.some((pane) => pane.id === persistedActivePaneId)
      ? persistedActivePaneId
      : (panes[0]?.id ?? null);
  return {
    open: candidate.open === true,
    panes,
    activePaneId,
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
  filePath?: string | null;
  pullRequestProjectId?: ProjectId | null;
  pullRequestRepository?: string | null;
  pullRequestNumber?: number | null;
  pullRequestInitialTab?: PullRequestInitialTab | null;
}

function createPane(input: OpenPaneInput): RightDockPane {
  return {
    id: input.paneId,
    kind: input.kind,
    sourceControlView: input.sourceControlView ?? "changes",
    diffTurnId: input.diffTurnId ?? null,
    diffFilePath: input.diffFilePath ?? null,
    filePath: input.filePath ?? null,
    pullRequestProjectId: input.pullRequestProjectId ?? null,
    pullRequestRepository: input.pullRequestRepository ?? null,
    pullRequestNumber: input.pullRequestNumber ?? null,
    pullRequestInitialTab: input.pullRequestInitialTab ?? null,
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
  if (
    input.kind === "pullRequest" &&
    (input.pullRequestProjectId !== undefined ||
      input.pullRequestRepository !== undefined ||
      input.pullRequestNumber !== undefined ||
      input.pullRequestInitialTab !== undefined)
  ) {
    return {
      pullRequestProjectId: input.pullRequestProjectId ?? null,
      pullRequestRepository: input.pullRequestRepository ?? null,
      pullRequestNumber: input.pullRequestNumber ?? null,
      pullRequestInitialTab: input.pullRequestInitialTab ?? null,
    };
  }
  return null;
}

function findMatchingMultiInstancePane(
  state: RightDockThreadState,
  input: OpenPaneInput,
): RightDockPane | undefined {
  if (input.kind === "file") {
    const filePath = input.filePath ?? null;
    return state.panes.find((pane) => pane.kind === "file" && pane.filePath === filePath);
  }
  return undefined;
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
  if (isSingletonPaneKind(input.kind)) {
    const existing = findSingletonPane(state, input.kind);
    if (existing) {
      const patch = singletonPaneReopenPatch(input);
      const nextPanes = patch
        ? state.panes.map((pane) => (pane.id === existing.id ? { ...pane, ...patch } : pane))
        : state.panes;
      return { open: true, panes: nextPanes, activePaneId: existing.id };
    }
  } else {
    const existing = findMatchingMultiInstancePane(state, input);
    if (existing) {
      return { open: true, panes: state.panes, activePaneId: existing.id };
    }
  }

  const pane = createPane(input);
  return {
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
  patch: Partial<
    Pick<
      RightDockPane,
      | "sourceControlView"
      | "diffTurnId"
      | "diffFilePath"
      | "filePath"
      | "pullRequestProjectId"
      | "pullRequestRepository"
      | "pullRequestNumber"
      | "pullRequestInitialTab"
    >
  >,
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
      nextPane.diffFilePath !== pane.diffFilePath ||
      nextPane.filePath !== pane.filePath ||
      nextPane.pullRequestProjectId !== pane.pullRequestProjectId ||
      nextPane.pullRequestRepository !== pane.pullRequestRepository ||
      nextPane.pullRequestNumber !== pane.pullRequestNumber ||
      nextPane.pullRequestInitialTab !== pane.pullRequestInitialTab
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
