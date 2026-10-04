import type { StateCreator } from "zustand";
import type { ComposerDraftStoreState } from "./composerDraftDomain";
import { createDraftThreadsActions } from "./composerDraftActions.draftThreads";
import { createPromptAndModelsActions } from "./composerDraftActions.promptAndModels";
import { createAttachmentsActions } from "./composerDraftActions.attachments";
import { createContextActions } from "./composerDraftActions.context";
import { createContentActions } from "./composerDraftActions.content";

export const createComposerDraftStoreState =
  (flushPersistStorage: () => void): StateCreator<ComposerDraftStoreState> =>
  (set, get) => ({
    ...createDraftThreadsActions(set, get),
    ...createPromptAndModelsActions(set, get, flushPersistStorage),
    ...createAttachmentsActions(set, get),
    ...createContextActions(set, get, flushPersistStorage),
    ...createContentActions(set, get),
  });
