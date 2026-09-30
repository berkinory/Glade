import type { StateCreator } from "zustand";
import type { ComposerDraftStoreState } from "./composerDraftDomain";
import * as Equal from "effect/Equal";
import {
  deleteDraftComposerImageBlobs,
  revokeDraftComposerImagePreviewUrls,
} from "./composerDraftAttachments";
import {
  type ComposerThreadDraftState,
  buildTransferredComposerDraft,
  createEmptyThreadDraft,
  shouldRemoveDraft,
} from "./composerDraftDomain";

type DraftSet = Parameters<StateCreator<ComposerDraftStoreState>>[0];
type DraftGet = Parameters<StateCreator<ComposerDraftStoreState>>[1];

export function createTransferActions(
  set: DraftSet,
  get: DraftGet,
): Pick<
  ComposerDraftStoreState,
  "copyTransferableComposerState" | "setRestoredSourceProposedPlan" | "clearComposerContent"
> {
  return {
    copyTransferableComposerState: (sourceThreadId, targetThreadId) => {
      if (sourceThreadId.length === 0 || targetThreadId.length === 0) {
        return;
      }
      set((state) => {
        const sourceDraft = state.draftsByThreadId[sourceThreadId];
        if (!sourceDraft) {
          return state;
        }
        const nextDraft = buildTransferredComposerDraft({
          sourceDraft,
          targetDraft: state.draftsByThreadId[targetThreadId],
          targetThreadId,
        });
        const currentTargetDraft = state.draftsByThreadId[targetThreadId];
        if (Equal.equals(currentTargetDraft, nextDraft)) {
          return state;
        }
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) {
          delete nextDraftsByThreadId[targetThreadId];
        } else {
          nextDraftsByThreadId[targetThreadId] = nextDraft;
        }
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
    setRestoredSourceProposedPlan: (threadId, source) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          restoredSourceProposedPlan: source,
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) {
          delete nextDraftsByThreadId[threadId];
        } else {
          nextDraftsByThreadId[threadId] = nextDraft;
        }
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
    clearComposerContent: (threadId, options) => {
      if (threadId.length === 0) {
        return;
      }
      const clearedDraft = get().draftsByThreadId[threadId];
      deleteDraftComposerImageBlobs(clearedDraft, () => get().draftsByThreadId);
      if (options?.preservePreviewUrls !== true) {
        revokeDraftComposerImagePreviewUrls(clearedDraft);
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          prompt: "",
          promptHistorySavedDraft: null,
          images: [],
          files: [],
          nonPersistedImageIds: [],
          persistedAttachments: [],
          assistantSelections: [],
          browserAnnotations: [],
          terminalContexts: [],
          fileComments: [],
          pastedTexts: [],
          pullRequestContexts: [],
          skills: [],
          mentions: [],
          restoredSourceProposedPlan: null,
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) {
          delete nextDraftsByThreadId[threadId];
        } else {
          nextDraftsByThreadId[threadId] = nextDraft;
        }
        return { draftsByThreadId: nextDraftsByThreadId };
      });
    },
  };
}
