import type { StateCreator } from "zustand";
import type { ComposerDraftStoreState } from "./composerDraftDomain";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@glade/contracts/orchestration/threadEntities";
import {
  composerFileDedupKey,
  deletePersistedComposerImageBlobs,
  mergeComposerImages,
  revokeObjectPreviewUrl,
  revokeQueuedTurnPreviewUrls,
} from "./composerDraftAttachments";
import {
  type ComposerFileAttachment,
  type ComposerThreadDraftState,
  assistantSelectionDedupKey,
  createEmptyThreadDraft,
  normalizeAssistantSelection,
  shouldRemoveDraft,
} from "./composerDraftDomain";
import {
  availableComposerAttachmentSlots,
  composerImageConsumesAttachmentSlot,
  effectiveComposerAttachmentCount,
} from "./lib/composerAttachmentCapacity";

type DraftSet = Parameters<StateCreator<ComposerDraftStoreState>>[0];
type DraftGet = Parameters<StateCreator<ComposerDraftStoreState>>[1];

export function createAttachmentsActions(
  set: DraftSet,
  get: DraftGet,
): Pick<
  ComposerDraftStoreState,
  | "enqueueQueuedTurn"
  | "insertQueuedTurn"
  | "removeQueuedTurn"
  | "addImage"
  | "addImages"
  | "removeImage"
  | "addFiles"
  | "removeFile"
  | "addAssistantSelection"
  | "removeAssistantSelection"
  | "clearAssistantSelections"
> {
  return {
    enqueueQueuedTurn: (threadId, queuedTurn) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              queuedTurns: [...existing.queuedTurns, queuedTurn],
            },
          },
        };
      });
    },
    insertQueuedTurn: (threadId, queuedTurn, index) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const boundedIndex = Math.max(0, Math.min(existing.queuedTurns.length, index));
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              queuedTurns: [
                ...existing.queuedTurns.slice(0, boundedIndex),
                queuedTurn,
                ...existing.queuedTurns.slice(boundedIndex),
              ],
            },
          },
        };
      });
    },
    removeQueuedTurn: (threadId, queuedTurnId) => {
      if (threadId.length === 0 || queuedTurnId.length === 0) {
        return;
      }
      const removedQueuedTurn = get().draftsByThreadId[threadId]?.queuedTurns.find(
        (entry) => entry.id === queuedTurnId,
      );
      if (removedQueuedTurn) {
        revokeQueuedTurnPreviewUrls(removedQueuedTurn);
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.queuedTurns.every((entry) => entry.id !== queuedTurnId)) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          queuedTurns: current.queuedTurns.filter((entry) => entry.id !== queuedTurnId),
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
    addImage: (threadId, image) => {
      if (threadId.length === 0) {
        revokeObjectPreviewUrl(image.previewUrl);
        return false;
      }
      return get().addImages(threadId, [image]) === 1;
    },
    addImages: (threadId, images) => {
      if (threadId.length === 0 || images.length === 0) {
        for (const image of images) revokeObjectPreviewUrl(image.previewUrl);
        return 0;
      }
      let insertedCount = 0;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        let mergedImages = existing.images;
        let attachmentCount = effectiveComposerAttachmentCount(existing);
        for (const image of images) {
          const consumesSlot = composerImageConsumesAttachmentSlot(existing, image.id);
          if (consumesSlot && attachmentCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
            revokeObjectPreviewUrl(image.previewUrl);
            continue;
          }
          const nextImages = mergeComposerImages(mergedImages, [image]);
          if (!nextImages) continue;
          mergedImages = nextImages;
          insertedCount += 1;
          if (consumesSlot) attachmentCount += 1;
        }
        if (insertedCount === 0) return state;
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              images: mergedImages,
            },
          },
        };
      });
      return insertedCount;
    },
    removeImage: (threadId, imageId) => {
      if (threadId.length === 0) {
        return;
      }
      const existing = get().draftsByThreadId[threadId];
      if (!existing) {
        return;
      }
      const removedImage = existing.images.find((image) => image.id === imageId);
      const removedPersistedAttachment = existing.persistedAttachments.find(
        (attachment) => attachment.id === imageId,
      );
      if (removedImage) {
        revokeObjectPreviewUrl(removedImage.previewUrl);
      }
      if (removedPersistedAttachment) {
        deletePersistedComposerImageBlobs(
          [removedPersistedAttachment],
          () => get().draftsByThreadId,
        );
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          images: current.images.filter((image) => image.id !== imageId),
          nonPersistedImageIds: current.nonPersistedImageIds.filter((id) => id !== imageId),
          persistedAttachments: current.persistedAttachments.filter(
            (attachment) => attachment.id !== imageId,
          ),
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
    addFiles: (threadId, files) => {
      if (threadId.length === 0 || files.length === 0) {
        return 0;
      }
      let insertedCount = 0;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        let availableSlots = availableComposerAttachmentSlots(existing);
        const existingIds = new Set(existing.files.map((file) => file.id));
        const existingDedupKeys = new Set(existing.files.map((file) => composerFileDedupKey(file)));
        const dedupedIncoming: ComposerFileAttachment[] = [];
        for (const file of files) {
          if (availableSlots === 0) break;
          const dedupKey = composerFileDedupKey(file);
          if (existingIds.has(file.id) || existingDedupKeys.has(dedupKey)) {
            continue;
          }
          dedupedIncoming.push(file);
          availableSlots -= 1;
          existingIds.add(file.id);
          existingDedupKeys.add(dedupKey);
        }
        if (dedupedIncoming.length === 0) {
          return state;
        }
        insertedCount = dedupedIncoming.length;
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              files: [...existing.files, ...dedupedIncoming],
            },
          },
        };
      });
      return insertedCount;
    },
    removeFile: (threadId, fileId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          files: current.files.filter((file) => file.id !== fileId),
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
    addAssistantSelection: (threadId, selection) => {
      if (threadId.length === 0) {
        return false;
      }
      let inserted = false;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const normalizedSelection = normalizeAssistantSelection(selection);
        if (!normalizedSelection) {
          return state;
        }
        const dedupKey = assistantSelectionDedupKey(normalizedSelection);
        if (
          existing.assistantSelections.some((entry) => entry.id === normalizedSelection.id) ||
          existing.assistantSelections.some(
            (entry) => assistantSelectionDedupKey(entry) === dedupKey,
          )
        ) {
          return state;
        }
        if (availableComposerAttachmentSlots(existing) === 0) {
          return state;
        }
        inserted = true;
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              assistantSelections: [...existing.assistantSelections, normalizedSelection],
            },
          },
        };
      });
      return inserted;
    },
    removeAssistantSelection: (threadId, selectionId) => {
      if (threadId.length === 0 || selectionId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          assistantSelections: current.assistantSelections.filter(
            (selection) => selection.id !== selectionId,
          ),
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
    clearAssistantSelections: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.assistantSelections.length === 0) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          assistantSelections: [],
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
