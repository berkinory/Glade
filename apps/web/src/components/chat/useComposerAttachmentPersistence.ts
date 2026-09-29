import { ThreadId } from "@glade/contracts";
import { useEffect } from "react";
import {
  type ComposerImageAttachment,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
} from "../../composerDraftStore";

import { readFileAsDataUrl } from "../../lib/composerSend";

async function stagePersistedComposerImageAttachments(input: {
  threadId: ThreadId;
  images: ReadonlyArray<ComposerImageAttachment>;
  getPersistedAttachments: () => PersistedComposerImageAttachment[];
}): Promise<PersistedComposerImageAttachment[]> {
  try {
    const existingPersistedById = new Map(
      input.getPersistedAttachments().map((attachment) => [attachment.id, attachment]),
    );
    const stagedAttachmentById = new Map<string, PersistedComposerImageAttachment>();
    await Promise.all(
      input.images.map(async (image) => {
        try {
          const dataUrl = await readFileAsDataUrl(image.file);
          stagedAttachmentById.set(image.id, {
            id: image.id,
            name: image.name,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            dataUrl,
          });
        } catch {
          const existingPersisted = existingPersistedById.get(image.id);
          if (existingPersisted) {
            stagedAttachmentById.set(image.id, existingPersisted);
          }
        }
      }),
    );
    return Array.from(stagedAttachmentById.values());
  } catch {
    const currentImageIds = new Set(input.images.map((image) => image.id));
    return input
      .getPersistedAttachments()
      .filter((attachment) => currentImageIds.has(attachment.id));
  }
}
interface ComposerAttachmentPersistenceInput {
  threadId: ThreadId;
  composerImages: readonly ComposerImageAttachment[];
  composerPromptHistorySavedDraftImages: readonly ComposerImageAttachment[] | null;
}

export function useComposerAttachmentPersistence({
  threadId,
  composerImages,
  composerPromptHistorySavedDraftImages,
}: ComposerAttachmentPersistenceInput) {
  const clearComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.clearPersistedAttachments,
  );
  const syncComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.syncPersistedAttachments,
  );
  const syncComposerDraftPromptHistorySavedDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.syncPromptHistorySavedDraftPersistedAttachments,
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (composerImages.length === 0) {
        const hasDeferredBlobAttachment =
          useComposerDraftStore
            .getState()
            .draftsByThreadId[threadId]?.persistedAttachments.some(
              (attachment) => attachment.blobKey,
            ) ?? false;
        if (hasDeferredBlobAttachment) {
          return;
        }
        clearComposerDraftPersistedAttachments(threadId);
        return;
      }
      const staged = await stagePersistedComposerImageAttachments({
        threadId,
        images: composerImages,
        getPersistedAttachments: () =>
          useComposerDraftStore.getState().draftsByThreadId[threadId]?.persistedAttachments ?? [],
      });
      if (cancelled) {
        return;
      }

      void syncComposerDraftPersistedAttachments(threadId, staged);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    clearComposerDraftPersistedAttachments,
    composerImages,
    syncComposerDraftPersistedAttachments,
    threadId,
  ]);

  useEffect(() => {
    if (
      !composerPromptHistorySavedDraftImages ||
      composerPromptHistorySavedDraftImages.length === 0
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const staged = await stagePersistedComposerImageAttachments({
        threadId,
        images: composerPromptHistorySavedDraftImages,
        getPersistedAttachments: () =>
          useComposerDraftStore.getState().draftsByThreadId[threadId]?.promptHistorySavedDraft
            ?.persistedAttachments ?? [],
      });
      if (cancelled) {
        return;
      }
      void syncComposerDraftPromptHistorySavedDraftPersistedAttachments(threadId, staged);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    composerPromptHistorySavedDraftImages,
    syncComposerDraftPromptHistorySavedDraftPersistedAttachments,
    threadId,
  ]);
}
