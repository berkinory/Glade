import type {
  ComputerEvent,
  ComputerWindow,
  ThreadComputerState,
} from "@glade/contracts/computer/computer";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { create } from "zustand";
import {
  computerPreviewAgentActive,
  computerPreviewPhaseOnAgentEdge,
  computerPreviewPhaseOnHide,
  computerPreviewPhaseOnSurfaceRequest,
  computerPreviewPhaseOnViewed,
  type ComputerPreviewPhase,
  type ComputerPreviewSession,
} from "./components/chat/ComputerPreviewPopover.logic";

import { useShallow } from "zustand/react/shallow";

interface ComputerPreviewState {
  sessionsByThreadId: Record<string, ComputerPreviewSession | undefined>;

  agentActiveByThreadId: Record<string, boolean | undefined>;

  previewLayoutByThreadId: Record<string, ComputerPreviewLayout | undefined>;

  floatingByThreadId: Record<string, ComputerPreviewFloatingPosition | undefined>;

  requestPreviewSurface: (threadId: ThreadId) => void;

  noteThreadComputerState: (state: ThreadComputerState) => void;

  noteThreadActionLabel: (threadId: ThreadId, label: string) => void;

  markPreviewLive: (threadId: ThreadId) => void;

  hidePreviewForTask: (threadId: ThreadId) => void;

  notePreviewLayout: (threadId: ThreadId, layout: ComputerPreviewLayout) => void;

  setPreviewFloating: (
    threadId: ThreadId,
    position: ComputerPreviewFloatingPosition | null,
  ) => void;

  movePreviewFloating: (threadId: ThreadId, position: ComputerPreviewFloatingPosition) => void;
  removePreviewSession: (threadId: ThreadId) => void;
  clearPreview: () => void;
}

export interface ComputerPreviewLayout {
  readonly hasFrame: boolean;

  readonly hasVisibleStatus?: boolean | undefined;
  readonly width: number;

  readonly floating?: boolean | undefined;
}

export interface ComputerPreviewFloatingPosition {
  readonly x: number;
  readonly y: number;
}

type ComputerActionEvent = Extract<ComputerEvent, { type: "computer.action" }>;

interface ComputerStateStore extends ComputerPreviewState {
  threadStatesByThreadId: Record<string, ThreadComputerState | undefined>;

  lastActionByThreadId: Record<string, ComputerActionEvent | undefined>;
  // Kept beside the per-thread states because the press belongs to no thread — a conversation with no
  // pane state still has to see input is stopped.
  inputStopped: boolean;
  upsertThreadState: (state: ThreadComputerState) => void;
  applyWindowsChanged: (windows: readonly ComputerWindow[]) => void;
  setInputStopped: (stopped: boolean) => void;
  recordAction: (action: ComputerActionEvent) => void;
  removeThreadState: (threadId: ThreadId) => void;
  clear: () => void;
}

function sessionWithPhase(
  session: ComputerPreviewSession | undefined,
  threadId: ThreadId,
  phase: ComputerPreviewPhase,
): ComputerPreviewSession {
  if (!session) {
    return { threadId, phase };
  }
  return { ...session, phase };
}

function updateSessionPhase(
  current: ComputerStateStore,
  threadId: ThreadId,
  nextPhase: (phase: ComputerPreviewPhase | undefined) => ComputerPreviewPhase | undefined,
): ComputerStateStore {
  const session = current.sessionsByThreadId[threadId];
  const phase = nextPhase(session?.phase);
  if (phase === undefined || phase === session?.phase) {
    return current;
  }
  return {
    ...current,
    sessionsByThreadId: {
      ...current.sessionsByThreadId,
      [threadId]: sessionWithPhase(session, threadId, phase),
    },
  };
}

export const useComputerStateStore = create<ComputerStateStore>()((set) => ({
  threadStatesByThreadId: {},
  lastActionByThreadId: {},
  inputStopped: false,
  sessionsByThreadId: {},
  agentActiveByThreadId: {},
  previewLayoutByThreadId: {},
  floatingByThreadId: {},
  requestPreviewSurface: (threadId) =>
    set((current) => updateSessionPhase(current, threadId, computerPreviewPhaseOnSurfaceRequest)),
  noteThreadComputerState: (state) =>
    set((current) => {
      const threadId = state.threadId;
      const active = computerPreviewAgentActive(state);
      const wasActive = current.agentActiveByThreadId[threadId] ?? false;
      if (active === wasActive) {
        return current;
      }
      const next: ComputerStateStore = {
        ...current,
        agentActiveByThreadId: { ...current.agentActiveByThreadId, [threadId]: active },
      };
      return updateSessionPhase(next, threadId, (phase) =>
        computerPreviewPhaseOnAgentEdge(phase, active ? "rose" : "fell"),
      );
    }),
  noteThreadActionLabel: (threadId, label) =>
    set((current) => {
      const session = current.sessionsByThreadId[threadId];
      if (session?.lastActionLabel === label) {
        return current;
      }
      const nextSession: ComputerPreviewSession = session
        ? { ...session, lastActionLabel: label }
        : { threadId, phase: "armed", lastActionLabel: label };
      return {
        ...current,
        sessionsByThreadId: { ...current.sessionsByThreadId, [threadId]: nextSession },
      };
    }),
  markPreviewLive: (threadId) =>
    set((current) => updateSessionPhase(current, threadId, computerPreviewPhaseOnViewed)),
  hidePreviewForTask: (threadId) =>
    set((current) => updateSessionPhase(current, threadId, computerPreviewPhaseOnHide)),
  notePreviewLayout: (threadId, layout) =>
    set((current) => {
      const previous = current.previewLayoutByThreadId[threadId];
      if (
        previous?.hasFrame === layout.hasFrame &&
        previous?.hasVisibleStatus === layout.hasVisibleStatus &&
        previous?.width === layout.width &&
        previous?.floating === layout.floating
      ) {
        return current;
      }
      return {
        ...current,
        previewLayoutByThreadId: { ...current.previewLayoutByThreadId, [threadId]: layout },
      };
    }),
  setPreviewFloating: (threadId, position) =>
    set((current) => {
      if (position === null) {
        if (!Object.hasOwn(current.floatingByThreadId, threadId)) {
          return current;
        }
        const floatingByThreadId = { ...current.floatingByThreadId };
        delete floatingByThreadId[threadId];
        return { ...current, floatingByThreadId };
      }
      const previous = current.floatingByThreadId[threadId];
      if (previous?.x === position.x && previous?.y === position.y) {
        return current;
      }
      return {
        ...current,
        floatingByThreadId: { ...current.floatingByThreadId, [threadId]: position },
      };
    }),
  movePreviewFloating: (threadId, position) =>
    set((current) => {
      const previous = current.floatingByThreadId[threadId];
      if (previous === undefined || (previous.x === position.x && previous.y === position.y)) {
        return current;
      }
      return {
        ...current,
        floatingByThreadId: { ...current.floatingByThreadId, [threadId]: position },
      };
    }),
  removePreviewSession: (threadId) =>
    set((current) => {
      const hasSession = Object.hasOwn(current.sessionsByThreadId, threadId);
      const hasActive = Object.hasOwn(current.agentActiveByThreadId, threadId);
      const hasLayout = Object.hasOwn(current.previewLayoutByThreadId, threadId);
      const hasFloating = Object.hasOwn(current.floatingByThreadId, threadId);
      if (!hasSession && !hasActive && !hasLayout && !hasFloating) {
        return current;
      }
      const sessionsByThreadId = { ...current.sessionsByThreadId };
      delete sessionsByThreadId[threadId];
      const agentActiveByThreadId = { ...current.agentActiveByThreadId };
      delete agentActiveByThreadId[threadId];
      const previewLayoutByThreadId = { ...current.previewLayoutByThreadId };
      delete previewLayoutByThreadId[threadId];
      const floatingByThreadId = { ...current.floatingByThreadId };
      delete floatingByThreadId[threadId];
      return {
        ...current,
        sessionsByThreadId,
        agentActiveByThreadId,
        previewLayoutByThreadId,
        floatingByThreadId,
      };
    }),
  clearPreview: () =>
    set({
      sessionsByThreadId: {},
      agentActiveByThreadId: {},
      previewLayoutByThreadId: {},
      floatingByThreadId: {},
    }),
  upsertThreadState: (state) =>
    set((current) => {
      const previousState = current.threadStatesByThreadId[state.threadId];
      if (previousState && previousState.version >= state.version) {
        return current;
      }
      return {
        ...current,
        threadStatesByThreadId: {
          ...current.threadStatesByThreadId,
          [state.threadId]: state,
        },
      };
    }),
  applyWindowsChanged: (windows) =>
    set((current) => {
      let changed = false;
      const nextStates = { ...current.threadStatesByThreadId };
      for (const [threadId, state] of Object.entries(current.threadStatesByThreadId)) {
        if (!state || state.windows === windows) {
          continue;
        }
        nextStates[threadId] = { ...state, windows };
        changed = true;
      }
      return changed ? { ...current, threadStatesByThreadId: nextStates } : current;
    }),
  setInputStopped: (stopped) =>
    set((current) => {
      if (current.inputStopped === stopped) return current;

      const nextStates: Record<string, ThreadComputerState | undefined> = {};
      for (const [threadId, state] of Object.entries(current.threadStatesByThreadId)) {
        nextStates[threadId] = state ? { ...state, inputStopped: stopped } : state;
      }
      return { ...current, inputStopped: stopped, threadStatesByThreadId: nextStates };
    }),
  recordAction: (action) =>
    set((current) => {
      const threadId = action.threadId;
      if (!threadId) {
        return current;
      }
      return {
        ...current,
        lastActionByThreadId: {
          ...current.lastActionByThreadId,
          [threadId]: action,
        },
      };
    }),
  removeThreadState: (threadId) =>
    set((current) => {
      const hasState = Object.hasOwn(current.threadStatesByThreadId, threadId);
      const hasAction = Object.hasOwn(current.lastActionByThreadId, threadId);
      if (!hasState && !hasAction) {
        return current;
      }
      const nextThreadStatesByThreadId = { ...current.threadStatesByThreadId };
      delete nextThreadStatesByThreadId[threadId];
      const nextLastActionByThreadId = { ...current.lastActionByThreadId };
      delete nextLastActionByThreadId[threadId];
      return {
        ...current,
        threadStatesByThreadId: nextThreadStatesByThreadId,
        lastActionByThreadId: nextLastActionByThreadId,
      };
    }),
  clear: () =>
    set({
      threadStatesByThreadId: {},
      lastActionByThreadId: {},
      sessionsByThreadId: {},
      agentActiveByThreadId: {},
      previewLayoutByThreadId: {},
      floatingByThreadId: {},
      // A wholesale reset (server restart) cannot inherit the old latch: the new server's own
      // `computer.input-stopped` state is the truth.
      inputStopped: false,
    }),
}));

export function selectThreadComputerState(
  threadId: ThreadId,
): (store: ComputerStateStore) => ThreadComputerState | undefined {
  return (store) => store.threadStatesByThreadId[threadId];
}

export function useThreadComputerAvailability(threadId: ThreadId) {
  return useComputerStateStore(
    useShallow((state) => state.threadStatesByThreadId[threadId]?.availability),
  );
}

export function useThreadComputerControlGeneration(threadId: ThreadId) {
  return useComputerStateStore(
    (state) => state.threadStatesByThreadId[threadId]?.controlGeneration,
  );
}

export function selectThreadComputerPreviewSession(
  threadId: ThreadId,
): (store: ComputerStateStore) => ComputerPreviewSession | undefined {
  return (store) => store.sessionsByThreadId[threadId];
}

export function selectThreadComputerPreviewLayout(
  threadId: ThreadId,
): (store: ComputerStateStore) => ComputerPreviewLayout | undefined {
  return (store) => store.previewLayoutByThreadId[threadId];
}

export function selectThreadComputerPreviewFloating(
  threadId: ThreadId,
): (store: ComputerStateStore) => ComputerPreviewFloatingPosition | undefined {
  return (store) => store.floatingByThreadId[threadId];
}
