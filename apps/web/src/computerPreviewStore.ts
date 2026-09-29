import type { ThreadComputerState, ThreadId } from "@glade/contracts";
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

interface ComputerPreviewStore {
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
  clear: () => void;
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
  current: ComputerPreviewStore,
  threadId: ThreadId,
  nextPhase: (phase: ComputerPreviewPhase | undefined) => ComputerPreviewPhase | undefined,
): ComputerPreviewStore {
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

export const useComputerPreviewStore = create<ComputerPreviewStore>()((set) => ({
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
      const next: ComputerPreviewStore = {
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
  clear: () =>
    set({
      sessionsByThreadId: {},
      agentActiveByThreadId: {},
      previewLayoutByThreadId: {},
      floatingByThreadId: {},
    }),
}));

export function selectThreadComputerPreviewSession(
  threadId: ThreadId,
): (store: ComputerPreviewStore) => ComputerPreviewSession | undefined {
  return (store) => store.sessionsByThreadId[threadId];
}

export function selectThreadComputerPreviewLayout(
  threadId: ThreadId,
): (store: ComputerPreviewStore) => ComputerPreviewLayout | undefined {
  return (store) => store.previewLayoutByThreadId[threadId];
}

export function selectThreadComputerPreviewFloating(
  threadId: ThreadId,
): (store: ComputerPreviewStore) => ComputerPreviewFloatingPosition | undefined {
  return (store) => store.floatingByThreadId[threadId];
}
