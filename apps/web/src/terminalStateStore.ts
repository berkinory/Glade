import type { TerminalSplitDirection } from "./terminalLayout";
import {
  type TerminalActivityState,
  type TerminalCliKind,
} from "@glade/shared/threads/terminalThreads";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createDeferredPersistStorage, flushStorageBeforePageHide } from "./lib/storage";
import {
  type ThreadTerminalPresentationMode,
  type ThreadTerminalWorkspaceLayout,
  type ThreadTerminalWorkspaceTab,
} from "./types";
import {
  createDefaultThreadTerminalState,
  getDefaultThreadTerminalState,
  isDefaultThreadTerminalState,
  sanitizePersistedTerminalStateByThreadId,
  type ThreadTerminalState,
} from "./terminalStateNormalization";
import {
  setThreadTerminalOpen,
  openThreadChatPage,
  openThreadTerminalPage,
  setThreadTerminalPresentationMode,
  setThreadTerminalWorkspaceTab,
  setThreadTerminalWorkspaceLayout,
  setThreadTerminalHeight,
  setThreadTerminalMetadata,
  setThreadTerminalCliKind,
  setThreadTerminalTitleOverride,
  newThreadTerminal,
  splitThreadTerminal,
  setThreadActiveTerminal,
  closeThreadTerminal,
  closeThreadTerminalAndEnsureReplacement,
  type TerminalExitDisposition,
  closeExitedThreadTerminal,
  openThreadTerminalFullWidth,
  closeThreadWorkspaceChat,
  setThreadTerminalActivity,
} from "./terminalStateTransitions";
const TERMINAL_STATE_STORAGE_KEY = "glade:terminal-state:v1";
export function selectThreadTerminalState(
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>,
  threadId: ThreadId,
): ThreadTerminalState {
  if (threadId.length === 0) {
    return getDefaultThreadTerminalState();
  }
  return terminalStateByThreadId[threadId] ?? getDefaultThreadTerminalState();
}

function updateTerminalStateByThreadId(
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>,
  threadId: ThreadId,
  updater: (state: ThreadTerminalState) => ThreadTerminalState,
): Record<ThreadId, ThreadTerminalState> {
  if (threadId.length === 0) {
    return terminalStateByThreadId;
  }

  const current = selectThreadTerminalState(terminalStateByThreadId, threadId);
  const next = updater(current);
  if (next === current) {
    return terminalStateByThreadId;
  }

  if (isDefaultThreadTerminalState(next)) {
    if (terminalStateByThreadId[threadId] === undefined) {
      return terminalStateByThreadId;
    }
    const { [threadId]: _removed, ...rest } = terminalStateByThreadId;
    return rest as Record<ThreadId, ThreadTerminalState>;
  }

  return {
    ...terminalStateByThreadId,
    [threadId]: next,
  };
}

interface TerminalStateStoreState {
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>;
  openChatThreadPage: (threadId: ThreadId) => void;
  openTerminalThreadPage: (threadId: ThreadId, options?: { terminalOnly?: boolean }) => void;
  setTerminalOpen: (threadId: ThreadId, open: boolean) => void;
  setTerminalPresentationMode: (threadId: ThreadId, mode: ThreadTerminalPresentationMode) => void;
  setTerminalWorkspaceLayout: (threadId: ThreadId, layout: ThreadTerminalWorkspaceLayout) => void;
  setTerminalWorkspaceTab: (threadId: ThreadId, tab: ThreadTerminalWorkspaceTab) => void;
  setTerminalHeight: (threadId: ThreadId, height: number) => void;
  setTerminalMetadata: (
    threadId: ThreadId,
    terminalId: string,
    metadata: { cliKind: TerminalCliKind | null; label: string },
  ) => void;
  setTerminalCliKind: (
    threadId: ThreadId,
    terminalId: string,
    cliKind: TerminalCliKind | null,
  ) => void;
  setTerminalTitleOverride: (
    threadId: ThreadId,
    terminalId: string,
    titleOverride: string | null | undefined,
  ) => void;
  newTerminal: (threadId: ThreadId, terminalId: string) => void;
  splitTerminal: (
    threadId: ThreadId,
    terminalId: string,
    direction: TerminalSplitDirection,
  ) => void;
  openNewFullWidthTerminal: (threadId: ThreadId, terminalId: string) => void;
  closeWorkspaceChat: (threadId: ThreadId) => void;
  setActiveTerminal: (threadId: ThreadId, terminalId: string) => void;
  closeTerminal: (threadId: ThreadId, terminalId: string) => void;
  closeTerminalAndEnsureReplacement: (
    threadId: ThreadId,
    terminalId: string,
    replacementTerminalId: string,
  ) => void;
  closeExitedTerminal: (threadId: ThreadId, terminalId: string) => TerminalExitDisposition;
  setTerminalActivity: (
    threadId: ThreadId,
    terminalId: string,
    activity: { agentState: TerminalActivityState | null; hasRunningSubprocess: boolean },
  ) => void;
  clearTerminalState: (threadId: ThreadId) => void;
  removeOrphanedTerminalStates: (activeThreadIds: Set<ThreadId>) => void;
}

const terminalPersistStorage = createDeferredPersistStorage<
  TerminalStateStoreState,
  Pick<TerminalStateStoreState, "terminalStateByThreadId">
>({
  getStorage: () => localStorage,
  partialize: (state) => ({
    terminalStateByThreadId: sanitizePersistedTerminalStateByThreadId(
      state.terminalStateByThreadId,
    ),
  }),
});

flushStorageBeforePageHide(() => terminalPersistStorage.flush());

export const useTerminalStateStore = create<TerminalStateStoreState>()(
  persist(
    (set) => {
      const updateTerminal = (
        threadId: ThreadId,
        updater: (state: ThreadTerminalState) => ThreadTerminalState,
      ) => {
        set((state) => {
          const nextTerminalStateByThreadId = updateTerminalStateByThreadId(
            state.terminalStateByThreadId,
            threadId,
            updater,
          );
          if (nextTerminalStateByThreadId === state.terminalStateByThreadId) {
            return state;
          }
          return {
            terminalStateByThreadId: nextTerminalStateByThreadId,
          };
        });
      };

      return {
        terminalStateByThreadId: {},
        openChatThreadPage: (threadId) =>
          updateTerminal(threadId, (state) => openThreadChatPage(state)),
        openTerminalThreadPage: (threadId, options) =>
          updateTerminal(threadId, (state) => openThreadTerminalPage(state, options)),
        setTerminalOpen: (threadId, open) =>
          updateTerminal(threadId, (state) => setThreadTerminalOpen(state, open)),
        setTerminalPresentationMode: (threadId, mode) =>
          updateTerminal(threadId, (state) => setThreadTerminalPresentationMode(state, mode)),
        setTerminalWorkspaceLayout: (threadId, layout) =>
          updateTerminal(threadId, (state) => setThreadTerminalWorkspaceLayout(state, layout)),
        setTerminalWorkspaceTab: (threadId, tab) =>
          updateTerminal(threadId, (state) => setThreadTerminalWorkspaceTab(state, tab)),
        setTerminalHeight: (threadId, height) =>
          updateTerminal(threadId, (state) => setThreadTerminalHeight(state, height)),
        setTerminalMetadata: (threadId, terminalId, metadata) =>
          updateTerminal(threadId, (state) =>
            setThreadTerminalMetadata(state, terminalId, metadata),
          ),
        setTerminalCliKind: (threadId, terminalId, cliKind) =>
          updateTerminal(threadId, (state) => setThreadTerminalCliKind(state, terminalId, cliKind)),
        setTerminalTitleOverride: (threadId, terminalId, titleOverride) =>
          updateTerminal(threadId, (state) =>
            setThreadTerminalTitleOverride(state, terminalId, titleOverride),
          ),
        newTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => newThreadTerminal(state, terminalId)),
        splitTerminal: (threadId, terminalId, direction) =>
          updateTerminal(threadId, (state) => splitThreadTerminal(state, terminalId, direction)),
        openNewFullWidthTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => openThreadTerminalFullWidth(state, terminalId)),
        closeWorkspaceChat: (threadId) =>
          updateTerminal(threadId, (state) => closeThreadWorkspaceChat(state)),
        setActiveTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => setThreadActiveTerminal(state, terminalId)),
        closeTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => closeThreadTerminal(state, terminalId)),
        closeTerminalAndEnsureReplacement: (threadId, terminalId, replacementTerminalId) =>
          updateTerminal(threadId, (state) =>
            closeThreadTerminalAndEnsureReplacement(state, terminalId, replacementTerminalId),
          ),
        closeExitedTerminal: (threadId, terminalId) => {
          let disposition: TerminalExitDisposition = "ignored";
          updateTerminal(threadId, (state) => {
            const transition = closeExitedThreadTerminal(state, terminalId);
            disposition = transition.disposition;
            return transition.state;
          });
          return disposition;
        },
        setTerminalActivity: (threadId, terminalId, activity) =>
          updateTerminal(threadId, (state) =>
            setThreadTerminalActivity(state, terminalId, activity),
          ),
        clearTerminalState: (threadId) =>
          updateTerminal(threadId, () => createDefaultThreadTerminalState()),
        removeOrphanedTerminalStates: (activeThreadIds) =>
          set((state) => {
            const orphanedIds = Object.keys(state.terminalStateByThreadId).filter(
              (id) => !activeThreadIds.has(id as ThreadId),
            );
            if (orphanedIds.length === 0) return state;
            const next = { ...state.terminalStateByThreadId };
            for (const id of orphanedIds) {
              delete next[id as ThreadId];
            }
            return { terminalStateByThreadId: next };
          }),
      };
    },
    {
      name: TERMINAL_STATE_STORAGE_KEY,
      version: 1,

      storage: terminalPersistStorage,
      merge: (persistedState, currentState) => ({
        ...currentState,
        terminalStateByThreadId: sanitizePersistedTerminalStateByThreadId(
          (persistedState as Partial<TerminalStateStoreState> | undefined)?.terminalStateByThreadId,
        ),
      }),
    },
  ),
);
