import { usePendingTurnDispatchStore } from "./pendingTurnDispatch";
import type { StateCreator } from "zustand";
import type { ComposerDraftStoreState } from "./composerDraftDomain";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { deleteDraftComposerImageBlobs, revokeDraftPreviewUrls } from "./composerDraftAttachments";
import {
  type ComposerThreadDraftState,
  type DraftThreadState,
  buildDraftThreadState,
  createEmptyThreadDraft,
  draftThreadStatesEqual,
  removeProjectDraftMappingsForThread,
} from "./composerDraftDomain";
import { DEFAULT_RUNTIME_MODE } from "./types";

type DraftSet = Parameters<StateCreator<ComposerDraftStoreState>>[0];
type DraftGet = Parameters<StateCreator<ComposerDraftStoreState>>[1];

function removeDraftThreadIfUnmapped(input: {
  threadId: ThreadId | undefined;
  projectDraftThreadIdByProjectId: Record<string, ThreadId>;
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  draftsByThreadId: Record<ThreadId, ComposerThreadDraftState>;
  getDraftsByThreadId: () => Record<ThreadId, ComposerThreadDraftState>;
}): {
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  draftsByThreadId: Record<ThreadId, ComposerThreadDraftState>;
} {
  if (
    !input.threadId ||
    usePendingTurnDispatchStore.getState().submittingThreadIds.has(input.threadId) ||
    Object.values(input.projectDraftThreadIdByProjectId).includes(input.threadId)
  ) {
    return {
      draftThreadsByThreadId: input.draftThreadsByThreadId,
      draftsByThreadId: input.draftsByThreadId,
    };
  }

  const nextDraftThreadsByThreadId = { ...input.draftThreadsByThreadId };
  delete nextDraftThreadsByThreadId[input.threadId];
  const removedDraft = input.draftsByThreadId[input.threadId];
  if (!removedDraft) {
    return {
      draftThreadsByThreadId: nextDraftThreadsByThreadId,
      draftsByThreadId: input.draftsByThreadId,
    };
  }

  revokeDraftPreviewUrls(removedDraft);
  deleteDraftComposerImageBlobs(removedDraft, input.getDraftsByThreadId);
  const nextDraftsByThreadId = { ...input.draftsByThreadId };
  delete nextDraftsByThreadId[input.threadId];
  return {
    draftThreadsByThreadId: nextDraftThreadsByThreadId,
    draftsByThreadId: nextDraftsByThreadId,
  };
}

export function createDraftThreadsActions(
  set: DraftSet,
  get: DraftGet,
): Pick<
  ComposerDraftStoreState,
  | "focusRequestsByThreadId"
  | "requestFocus"
  | "draftsByThreadId"
  | "draftThreadsByThreadId"
  | "projectDraftThreadIdByProjectId"
  | "stickyModelSelectionByProvider"
  | "stickyActiveProvider"
  | "getDraftThreadByProjectId"
  | "getDraftThread"
  | "setProjectDraftThreadId"
  | "registerDraftThread"
  | "setDraftThreadContext"
  | "moveDraftThreadToProject"
  | "clearProjectDraftThreadId"
  | "clearProjectDraftThreads"
  | "clearProjectDraftThreadById"
  | "markDraftThreadPromoting"
  | "finalizePromotedDraftThread"
  | "clearDraftThread"
> {
  return {
    focusRequestsByThreadId: {},
    requestFocus: (threadId) =>
      set((state) => ({
        focusRequestsByThreadId: {
          ...state.focusRequestsByThreadId,
          [threadId]: (state.focusRequestsByThreadId[threadId] ?? 0) + 1,
        },
      })),
    draftsByThreadId: {},
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
    getDraftThreadByProjectId: (projectId) => {
      if (projectId.length === 0) {
        return null;
      }
      const threadId = get().projectDraftThreadIdByProjectId[projectId];
      if (!threadId) {
        return null;
      }
      const draftThread = get().draftThreadsByThreadId[threadId];
      if (
        !draftThread ||
        draftThread.projectId !== projectId ||
        draftThread.promotedTo !== undefined
      ) {
        return null;
      }
      return {
        threadId,
        ...draftThread,
      };
    },
    getDraftThread: (threadId) => {
      if (threadId.length === 0) {
        return null;
      }
      return get().draftThreadsByThreadId[threadId] ?? null;
    },
    setProjectDraftThreadId: (projectId, threadId, options) => {
      if (projectId.length === 0 || threadId.length === 0) {
        return;
      }
      set((state) => {
        const existingThread = state.draftThreadsByThreadId[threadId];
        const nextDraftThread = buildDraftThreadState({
          projectId,
          existingThread,
          options,
          createdAtMode: "accept-empty",
        });
        const mappingKey = projectId;
        const previousThreadIdForProject = state.projectDraftThreadIdByProjectId[mappingKey];
        const hasSameProjectMapping = previousThreadIdForProject === threadId;
        if (hasSameProjectMapping && draftThreadStatesEqual(existingThread, nextDraftThread)) {
          return state;
        }
        const nextProjectDraftThreadIdByProjectId: Record<string, ThreadId> = {
          ...state.projectDraftThreadIdByProjectId,
          [mappingKey]: threadId,
        };
        const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
          ...state.draftThreadsByThreadId,
          [threadId]: nextDraftThread,
        };
        const cleanedDrafts =
          previousThreadIdForProject === threadId
            ? {
                draftThreadsByThreadId: nextDraftThreadsByThreadId,
                draftsByThreadId: state.draftsByThreadId,
              }
            : removeDraftThreadIfUnmapped({
                threadId: previousThreadIdForProject,
                projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
                draftThreadsByThreadId: nextDraftThreadsByThreadId,
                draftsByThreadId: state.draftsByThreadId,
                getDraftsByThreadId: () => get().draftsByThreadId,
              });
        return {
          draftsByThreadId: cleanedDrafts.draftsByThreadId,
          draftThreadsByThreadId: cleanedDrafts.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
        };
      });
    },
    registerDraftThread: (threadId, options) => {
      if (threadId.length === 0 || options.projectId.length === 0) {
        return;
      }
      set((state) => {
        if (state.draftThreadsByThreadId[threadId]) {
          return state;
        }
        const worktreePath = options.worktreePath ?? null;
        const nextDraftThread: DraftThreadState = {
          projectId: options.projectId,
          createdAt: options.createdAt ?? new Date().toISOString(),
          runtimeMode: options.runtimeMode ?? DEFAULT_RUNTIME_MODE,

          branch: options.branch ?? null,
          worktreePath,
          workingDirectory: options.workingDirectory ?? null,
          lastKnownPr: null,
          envMode: options.envMode ?? (worktreePath ? "worktree" : "local"),
        };
        return {
          draftThreadsByThreadId: {
            ...state.draftThreadsByThreadId,
            [threadId]: nextDraftThread,
          },
        };
      });
    },
    setDraftThreadContext: (threadId, options) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftThreadsByThreadId[threadId];
        if (!existing) {
          return state;
        }
        const nextProjectId = options.projectId ?? existing.projectId;
        if (nextProjectId.length === 0) {
          return state;
        }
        const nextDraftThread = buildDraftThreadState({
          projectId: nextProjectId,
          existingThread: existing,
          options,
          createdAtMode: "preserve-existing-on-empty",
        });
        if (draftThreadStatesEqual(existing, nextDraftThread)) {
          return state;
        }
        const nextProjectDraftThreadIdByProjectId: Record<string, ThreadId> = {
          ...removeProjectDraftMappingsForThread(state.projectDraftThreadIdByProjectId, threadId),
          [nextProjectId]: threadId,
        };
        return {
          draftThreadsByThreadId: {
            ...state.draftThreadsByThreadId,
            [threadId]: nextDraftThread,
          },
          projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
        };
      });
    },
    moveDraftThreadToProject: (threadId, projectId, options) => {
      if (threadId.length === 0 || projectId.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftThreadsByThreadId[threadId];
        if (!existing) {
          return state;
        }
        const nextDraftThread = buildDraftThreadState({
          projectId,
          existingThread: existing,
          options,
          createdAtMode: "preserve-existing-on-empty",
        });
        const targetMappingKey = projectId;
        const previousThreadIdForProject = state.projectDraftThreadIdByProjectId[targetMappingKey];
        const hasOnlyTargetMapping = Object.entries(state.projectDraftThreadIdByProjectId).every(
          ([mappingKey, mappedThreadId]) =>
            mappedThreadId !== threadId || mappingKey === targetMappingKey,
        );
        if (
          previousThreadIdForProject === threadId &&
          hasOnlyTargetMapping &&
          draftThreadStatesEqual(existing, nextDraftThread)
        ) {
          return state;
        }

        const nextProjectDraftThreadIdByProjectId: Record<string, ThreadId> = {
          ...removeProjectDraftMappingsForThread(state.projectDraftThreadIdByProjectId, threadId),
          [targetMappingKey]: threadId,
        };

        const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
          ...state.draftThreadsByThreadId,
          [threadId]: nextDraftThread,
        };
        const cleanedDrafts =
          previousThreadIdForProject === threadId
            ? {
                draftThreadsByThreadId: nextDraftThreadsByThreadId,
                draftsByThreadId: state.draftsByThreadId,
              }
            : removeDraftThreadIfUnmapped({
                threadId: previousThreadIdForProject,
                projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
                draftThreadsByThreadId: nextDraftThreadsByThreadId,
                draftsByThreadId: state.draftsByThreadId,
                getDraftsByThreadId: () => get().draftsByThreadId,
              });

        return {
          draftsByThreadId: cleanedDrafts.draftsByThreadId,
          draftThreadsByThreadId: cleanedDrafts.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
        };
      });
    },
    clearProjectDraftThreadId: (projectId) => {
      if (projectId.length === 0) {
        return;
      }
      set((state) => {
        const mappingKey = projectId;
        const threadId = state.projectDraftThreadIdByProjectId[mappingKey];
        if (threadId === undefined) {
          return state;
        }
        const { [mappingKey]: _removed, ...restProjectMappingsRaw } =
          state.projectDraftThreadIdByProjectId;
        const restProjectMappings = restProjectMappingsRaw as Record<string, ThreadId>;
        const cleanedDrafts = removeDraftThreadIfUnmapped({
          threadId,
          projectDraftThreadIdByProjectId: restProjectMappings,
          draftThreadsByThreadId: state.draftThreadsByThreadId,
          draftsByThreadId: state.draftsByThreadId,
          getDraftsByThreadId: () => get().draftsByThreadId,
        });
        return {
          draftsByThreadId: cleanedDrafts.draftsByThreadId,
          draftThreadsByThreadId: cleanedDrafts.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: restProjectMappings,
        };
      });
    },
    clearProjectDraftThreads: (projectId) => {
      if (projectId.length === 0) {
        return;
      }
      set((state) => {
        const nextProjectDraftThreadIdByProjectId: Record<string, ThreadId> = {};
        const removedThreadIds = new Set<ThreadId>();
        for (const [mappingKey, threadId] of Object.entries(
          state.projectDraftThreadIdByProjectId,
        )) {
          if (mappingKey === projectId) {
            removedThreadIds.add(threadId);
            continue;
          }
          nextProjectDraftThreadIdByProjectId[mappingKey] = threadId;
        }
        if (removedThreadIds.size === 0) {
          return state;
        }
        let cleanedDrafts = {
          draftThreadsByThreadId: state.draftThreadsByThreadId,
          draftsByThreadId: state.draftsByThreadId,
        };
        for (const threadId of removedThreadIds) {
          cleanedDrafts = removeDraftThreadIfUnmapped({
            threadId,
            projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
            draftThreadsByThreadId: cleanedDrafts.draftThreadsByThreadId,
            draftsByThreadId: cleanedDrafts.draftsByThreadId,
            getDraftsByThreadId: () => get().draftsByThreadId,
          });
        }
        return {
          draftsByThreadId: cleanedDrafts.draftsByThreadId,
          draftThreadsByThreadId: cleanedDrafts.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
        };
      });
    },
    clearProjectDraftThreadById: (projectId, threadId) => {
      if (projectId.length === 0 || threadId.length === 0) {
        return;
      }
      set((state) => {
        const matchingMappingKey = Object.entries(state.projectDraftThreadIdByProjectId).find(
          ([mappingKey, mappedThreadId]) => mappingKey === projectId && mappedThreadId === threadId,
        )?.[0];
        if (!matchingMappingKey) {
          return state;
        }
        const { [matchingMappingKey]: _removed, ...restProjectMappingsRaw } =
          state.projectDraftThreadIdByProjectId;
        const restProjectMappings = restProjectMappingsRaw as Record<string, ThreadId>;
        const cleanedDrafts = removeDraftThreadIfUnmapped({
          threadId,
          projectDraftThreadIdByProjectId: restProjectMappings,
          draftThreadsByThreadId: state.draftThreadsByThreadId,
          draftsByThreadId: state.draftsByThreadId,
          getDraftsByThreadId: () => get().draftsByThreadId,
        });
        return {
          draftsByThreadId: cleanedDrafts.draftsByThreadId,
          draftThreadsByThreadId: cleanedDrafts.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: restProjectMappings,
        };
      });
    },
    markDraftThreadPromoting: (threadId, promotedTo) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftThreadsByThreadId[threadId];
        if (!existing) {
          return state;
        }
        const nextPromotedTo = promotedTo ?? threadId;
        if (existing.promotedTo === nextPromotedTo) {
          return state;
        }
        return {
          draftThreadsByThreadId: {
            ...state.draftThreadsByThreadId,
            [threadId]: {
              ...existing,
              promotedTo: nextPromotedTo,
            },
          },
        };
      });
    },
    finalizePromotedDraftThread: (threadId) => {
      const draftThread = get().draftThreadsByThreadId[threadId];
      if (!draftThread?.promotedTo) {
        return;
      }

      if (draftThread.promotedTo === threadId) {
        // Promotion changes thread identity ownership, not the independently edited composer.
        set((state) => {
          const { [threadId]: _promoted, ...draftThreadsByThreadId } = state.draftThreadsByThreadId;
          return {
            draftThreadsByThreadId,
            projectDraftThreadIdByProjectId: Object.fromEntries(
              Object.entries(state.projectDraftThreadIdByProjectId).filter(
                ([, id]) => id !== threadId,
              ),
            ),
          };
        });
      } else get().clearDraftThread(threadId);
    },
    clearDraftThread: (threadId, options) => {
      if (threadId.length === 0) {
        return;
      }
      const removedDraft = get().draftsByThreadId[threadId];
      revokeDraftPreviewUrls(removedDraft);
      deleteDraftComposerImageBlobs(removedDraft, () => get().draftsByThreadId);
      set((state) => {
        const hasDraftThread = state.draftThreadsByThreadId[threadId] !== undefined;
        const hasProjectMapping = Object.values(state.projectDraftThreadIdByProjectId).includes(
          threadId,
        );
        const hasComposerDraft = state.draftsByThreadId[threadId] !== undefined;
        if (!hasDraftThread && !hasProjectMapping && !hasComposerDraft) {
          return state;
        }
        const nextProjectDraftThreadIdByProjectId = Object.fromEntries(
          Object.entries(state.projectDraftThreadIdByProjectId).filter(
            ([, draftThreadId]) => draftThreadId !== threadId,
          ),
        ) as Record<string, ThreadId>;
        const { [threadId]: _removedDraftThread, ...restDraftThreadsByThreadId } =
          state.draftThreadsByThreadId;
        const { [threadId]: _removedComposerDraft, ...restDraftsByThreadId } =
          state.draftsByThreadId;
        const computerControl = options?.preserveComputerControl
          ? _removedComposerDraft?.enableComputerControl
          : undefined;
        return {
          draftsByThreadId:
            computerControl === undefined
              ? restDraftsByThreadId
              : {
                  ...restDraftsByThreadId,
                  [threadId]: {
                    ...createEmptyThreadDraft(),
                    enableComputerControl: computerControl,
                    computerControlMode: _removedComposerDraft?.computerControlMode,
                    computerControlGeneration: _removedComposerDraft?.computerControlGeneration,
                  },
                },
          draftThreadsByThreadId: restDraftThreadsByThreadId,
          projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
        };
      });
    },
  };
}
