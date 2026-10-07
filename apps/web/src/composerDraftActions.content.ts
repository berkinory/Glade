import type { StateCreator } from "zustand";
import type { ComposerDraftStoreState } from "./composerDraftDomain";
import {
  deleteDraftComposerImageBlobs,
  revokeDraftComposerImagePreviewUrls,
} from "./composerDraftAttachments";
import { type ComposerThreadDraftState, putComposerDraft } from "./composerDraftDomain";

type DraftSet = Parameters<StateCreator<ComposerDraftStoreState>>[0];
type DraftGet = Parameters<StateCreator<ComposerDraftStoreState>>[1];

export function createContentActions(
  set: DraftSet,
  get: DraftGet,
): Pick<ComposerDraftStoreState, "clearComposerContent"> {
  return {
    clearComposerContent: (threadId, options) => {
      if (threadId.length === 0) {
        return;
      }
      const clearedDraft = get().draftsByThreadId[threadId];
      const consumed = options?.consumedDraft;
      if (options?.preservePreviewUrls !== true) {
        revokeDraftComposerImagePreviewUrls(consumed ?? clearedDraft);
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          prompt: !consumed || current.prompt === consumed.prompt ? "" : current.prompt,
          promptHistorySavedDraft: null,
          images: consumed ? current.images.filter((item) => !consumed.images.includes(item)) : [],
          files: consumed ? current.files.filter((item) => !consumed.files.includes(item)) : [],
          nonPersistedImageIds: consumed
            ? current.nonPersistedImageIds.filter(
                (id) => !consumed.nonPersistedImageIds.includes(id),
              )
            : [],
          persistedAttachments: consumed
            ? current.persistedAttachments.filter(
                (item) => !consumed.persistedAttachments.some((sent) => sent.id === item.id),
              )
            : [],
          assistantSelections: consumed
            ? current.assistantSelections.filter(
                (item) => !consumed.assistantSelections.includes(item),
              )
            : [],
          terminalContexts: consumed
            ? current.terminalContexts.filter((item) => !consumed.terminalContexts.includes(item))
            : [],
          fileComments: consumed
            ? current.fileComments.filter((item) => !consumed.fileComments.includes(item))
            : [],
          pastedTexts: consumed
            ? current.pastedTexts.filter((item) => !consumed.pastedTexts.includes(item))
            : [],
          pullRequestContexts: consumed
            ? current.pullRequestContexts.filter(
                (item) => !consumed.pullRequestContexts.includes(item),
              )
            : [],
          skills: consumed ? current.skills.filter((item) => !consumed.skills.includes(item)) : [],
          mentions: consumed
            ? current.mentions.filter((item) => !consumed.mentions.includes(item))
            : [],
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
      deleteDraftComposerImageBlobs(consumed ?? clearedDraft, () => get().draftsByThreadId);
    },
  };
}
