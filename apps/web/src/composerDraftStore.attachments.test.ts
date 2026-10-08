import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@glade/contracts/orchestration/threadEntities";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureComposerPromptHistorySavedDraft,
  COMPOSER_DRAFT_STORAGE_KEY,
  COMPOSER_DRAFT_STORAGE_VERSION,
  type ComposerImageAttachment,
} from "./composerDraftDomain";
import { useComposerDraftStore } from "./composerDraftStore";
import {
  makeFile,
  makeImage,
  makeTerminalContext,
  mergePersistedComposerDraftState,
  persistComposerDraftState,
  persistedAttachmentFor,
  resetComposerDraftStore,
  stubRevokeObjectUrl,
} from "./composerDraftStoreTestFixtures";
import { removeLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

describe("composerDraftStore addImages", () => {
  const threadId = ThreadId.makeUnsafe("thread-dedupe");
  const revokeSpy = stubRevokeObjectUrl();

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it.each([
    {
      name: "in one batch",
      add: (first: ComposerImageAttachment, duplicate: ComposerImageAttachment) =>
        useComposerDraftStore.getState().addImages(threadId, [first, duplicate]),
    },
    {
      name: "against existing images across calls",
      add: (first: ComposerImageAttachment, duplicate: ComposerImageAttachment) => {
        useComposerDraftStore.getState().addImage(threadId, first);
        useComposerDraftStore.getState().addImage(threadId, duplicate);
      },
    },
  ])("deduplicates identical images $name by file signature", ({ add }) => {
    const signature = { name: "same.png", mimeType: "image/png", sizeBytes: 12 };
    add(
      makeImage({ id: "img-1", previewUrl: "blob:first", ...signature, lastModified: 12345 }),
      makeImage({ id: "img-2", previewUrl: "blob:duplicate", ...signature, lastModified: 99999 }),
    );

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.images.map((image) => image.id)).toEqual(["img-1"]);
    expect(revokeSpy).toHaveBeenCalledWith("blob:duplicate");
  });

  it("does not revoke blob URLs that are still used by an accepted duplicate image", () => {
    const first = makeImage({
      id: "img-shared",
      previewUrl: "blob:shared",
    });
    const duplicateSameUrl = makeImage({
      id: "img-shared",
      previewUrl: "blob:shared",
    });

    useComposerDraftStore.getState().addImages(threadId, [first, duplicateSameUrl]);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.images.map((image) => image.id)).toEqual(["img-shared"]);
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:shared");
  });

  it("enforces the attachment limit atomically when another reference wins the last slot", () => {
    const store = useComposerDraftStore.getState();
    const initialImages = Array.from(
      { length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1 },
      (_, index) =>
        makeImage({
          id: `img-${index}`,
          name: `image-${index}.png`,
          sizeBytes: index + 1,
          previewUrl: `blob:image-${index}`,
        }),
    );
    expect(store.addImages(threadId, initialImages)).toBe(PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1);
    expect(store.addFiles(threadId, [makeFile({ id: "last-slot" })])).toBe(1);

    const lateImage = makeImage({
      id: "late-image",
      name: "late-image.png",
      previewUrl: "blob:late-image",
    });
    expect(store.addImage(threadId, lateImage)).toBe(false);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect((draft?.images.length ?? 0) + (draft?.files.length ?? 0)).toBe(
      PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
    );
    expect(revokeSpy).toHaveBeenCalledWith("blob:late-image");
  });

  it("allows persisted-image hydration without consuming a second slot", async () => {
    const store = useComposerDraftStore.getState();
    const persistedImage = makeImage({
      id: "persisted-image",
      name: "persisted.png",
      previewUrl: "blob:persisted",
    });
    await store.syncPersistedAttachments(threadId, [persistedAttachmentFor(persistedImage)]);

    expect(useComposerDraftStore.getState().addImage(threadId, persistedImage)).toBe(true);
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.images.map((image) => image.id),
    ).toEqual(["persisted-image"]);
  });
});

describe("composerDraftStore prompt history saved draft", () => {
  const threadId = ThreadId.makeUnsafe("thread-prompt-history-attachments");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("moves composer attachments into the prompt-history snapshot and restores them", async () => {
    const store = useComposerDraftStore.getState();
    const image = makeImage({ id: "img-history", previewUrl: "blob:history" });
    const file = makeFile({ id: "file-history" });

    store.setPrompt(threadId, "draft with attachments");
    store.addImage(threadId, image);
    store.addFiles(threadId, [file]);
    await store.syncPersistedAttachments(threadId, [persistedAttachmentFor(image)]);
    const draftBeforeBrowse = useComposerDraftStore.getState().draftsByThreadId[threadId]!;
    store.setPromptHistorySavedDraft(
      threadId,
      captureComposerPromptHistorySavedDraft({
        threadId,
        draft: draftBeforeBrowse,
        prompt: draftBeforeBrowse.prompt,
      }),
    );

    const browsingDraft = useComposerDraftStore.getState().draftsByThreadId[threadId]!;
    expect(browsingDraft.images).toHaveLength(0);
    expect(browsingDraft.files).toHaveLength(0);
    expect(browsingDraft.persistedAttachments).toHaveLength(0);
    const saved = browsingDraft.promptHistorySavedDraft;
    expect(saved?.prompt).toBe("draft with attachments");
    expect(saved?.images.map((entry) => entry.id)).toEqual(["img-history"]);
    expect(saved?.files.map((entry) => entry.id)).toEqual(["file-history"]);
    expect(saved?.persistedAttachments.map((entry) => entry.id)).toEqual(["img-history"]);

    store.setPrompt(threadId, "recalled history prompt");
    store.restorePromptHistorySavedDraft(threadId);

    const restoredDraft = useComposerDraftStore.getState().draftsByThreadId[threadId]!;
    expect(restoredDraft.prompt).toBe("draft with attachments");
    expect(restoredDraft.promptHistorySavedDraft).toBeNull();
    expect(restoredDraft.images.map((entry) => entry.id)).toEqual(["img-history"]);
    expect(restoredDraft.files.map((entry) => entry.id)).toEqual(["file-history"]);
  });

  it("moves and restores structured composer context with the prompt-history snapshot", () => {
    const store = useComposerDraftStore.getState();
    const assistantSelection = {
      type: "assistant-selection" as const,
      id: "sel-history",
      assistantMessageId: "assistant-1",
      text: "Use this assistant answer",
    };
    const terminalContext = makeTerminalContext({
      id: "ctx-history",
      text: "bun run check",
    });
    const fileComment = {
      id: "comment-history",
      path: "apps/web/src/App.tsx",
      startLine: 4,
      endLine: 6,
      text: "Please update this range.",
    };
    const pastedText = {
      id: "paste-history",
      createdAt: "2026-03-13T12:00:00.000Z",
      text: "large pasted content",
      lineCount: 1,
      charCount: "large pasted content".length,
    };
    const selectedSkill = { name: "check-code", path: "/skills/check-code" };
    const selectedMention = { name: "linear", path: "plugin://linear" };

    store.setPrompt(threadId, "draft with structured context");
    store.addAssistantSelection(threadId, assistantSelection);
    store.addTerminalContext(threadId, terminalContext);
    store.addFileComment(threadId, fileComment);
    store.addPastedTexts(threadId, [pastedText]);
    store.setSkills(threadId, [selectedSkill]);
    store.setMentions(threadId, [selectedMention]);
    const draftBeforeBrowse = useComposerDraftStore.getState().draftsByThreadId[threadId]!;

    store.setPromptHistorySavedDraft(
      threadId,
      captureComposerPromptHistorySavedDraft({
        threadId,
        draft: draftBeforeBrowse,
        prompt: draftBeforeBrowse.prompt,
      }),
    );

    const browsingDraft = useComposerDraftStore.getState().draftsByThreadId[threadId]!;
    expect(browsingDraft.assistantSelections).toHaveLength(0);
    expect(browsingDraft.terminalContexts).toHaveLength(0);
    expect(browsingDraft.fileComments).toHaveLength(0);
    expect(browsingDraft.pastedTexts).toHaveLength(0);
    expect(browsingDraft.skills).toHaveLength(0);
    expect(browsingDraft.mentions).toHaveLength(0);
    expect(
      browsingDraft.promptHistorySavedDraft?.assistantSelections.map((entry) => entry.id),
    ).toEqual(["sel-history"]);
    expect(
      browsingDraft.promptHistorySavedDraft?.terminalContexts.map((entry) => entry.id),
    ).toEqual(["ctx-history"]);
    expect(browsingDraft.promptHistorySavedDraft?.fileComments.map((entry) => entry.id)).toEqual([
      "comment-history",
    ]);
    expect(browsingDraft.promptHistorySavedDraft?.pastedTexts.map((entry) => entry.id)).toEqual([
      "paste-history",
    ]);
    expect(browsingDraft.promptHistorySavedDraft?.skills).toEqual([selectedSkill]);
    expect(browsingDraft.promptHistorySavedDraft?.mentions).toEqual([selectedMention]);

    store.setPrompt(threadId, "recalled history prompt");
    store.restorePromptHistorySavedDraft(threadId);

    const restoredDraft = useComposerDraftStore.getState().draftsByThreadId[threadId]!;
    expect(restoredDraft.prompt).toBe(draftBeforeBrowse.prompt);
    expect(restoredDraft.assistantSelections.map((entry) => entry.id)).toEqual(["sel-history"]);
    expect(restoredDraft.terminalContexts.map((entry) => entry.id)).toEqual(["ctx-history"]);
    expect(restoredDraft.fileComments.map((entry) => entry.id)).toEqual(["comment-history"]);
    expect(restoredDraft.pastedTexts.map((entry) => entry.id)).toEqual(["paste-history"]);
    expect(restoredDraft.skills).toEqual([selectedSkill]);
    expect(restoredDraft.mentions).toEqual([selectedMention]);
  });

  it("persists and hydrates prompt-history snapshot images and structured context", async () => {
    const store = useComposerDraftStore.getState();
    const image = makeImage({ id: "img-persist-history", previewUrl: "blob:persist-history" });
    const persistedAttachment = persistedAttachmentFor(image);
    const terminalContext = makeTerminalContext({
      id: "ctx-persist-history",
      text: "bun run test",
    });
    const pastedText = {
      id: "paste-persist-history",
      createdAt: "2026-03-13T12:00:00.000Z",
      text: "persisted paste",
      lineCount: 1,
      charCount: "persisted paste".length,
    };
    const selectedSkill = { name: "check-code", path: "/skills/check-code" };

    store.setPrompt(threadId, "persist me before history");
    store.addImage(threadId, image);
    await store.syncPersistedAttachments(threadId, [persistedAttachment]);
    store.addTerminalContext(threadId, terminalContext);
    store.addPastedTexts(threadId, [pastedText]);
    store.setSkills(threadId, [selectedSkill]);
    const draftBeforeBrowse = useComposerDraftStore.getState().draftsByThreadId[threadId]!;
    store.setPromptHistorySavedDraft(
      threadId,
      captureComposerPromptHistorySavedDraft({
        threadId,
        draft: draftBeforeBrowse,
        prompt: draftBeforeBrowse.prompt,
      }),
    );

    const persistedState = persistComposerDraftState();
    const persistedSnapshot = persistedState.draftsByThreadId?.[threadId]
      ?.promptHistorySavedDraft as Record<string, unknown> | undefined;
    expect(persistedSnapshot?.attachments).toEqual([persistedAttachment]);
    const persistedTerminalContexts = persistedSnapshot?.terminalContexts as
      | Array<Record<string, unknown>>
      | undefined;
    expect(persistedTerminalContexts?.[0]).toMatchObject({
      id: "ctx-persist-history",
    });
    expect(persistedTerminalContexts?.[0]).not.toHaveProperty("text");
    expect(persistedSnapshot?.pastedTexts).toEqual([
      {
        id: "paste-persist-history",
        createdAt: "2026-03-13T12:00:00.000Z",
        text: "persisted paste",
      },
    ]);
    expect(persistedSnapshot?.skills).toEqual([selectedSkill]);

    const mergedState = mergePersistedComposerDraftState(persistedState);
    const restoredSnapshot = mergedState.draftsByThreadId[threadId]?.promptHistorySavedDraft;

    expect(restoredSnapshot?.images.map((entry) => entry.id)).toEqual(["img-persist-history"]);
    expect(restoredSnapshot?.files).toEqual([]);
    expect(restoredSnapshot?.terminalContexts).toEqual([
      expect.objectContaining({
        id: "ctx-persist-history",
        text: "",
      }),
    ]);
    expect(restoredSnapshot?.pastedTexts.map((entry) => entry.id)).toEqual([
      "paste-persist-history",
    ]);
    expect(restoredSnapshot?.skills).toEqual([selectedSkill]);
  });

  it("syncs persisted images into an existing prompt-history snapshot", async () => {
    const store = useComposerDraftStore.getState();
    const image = makeImage({ id: "img-sync-history", previewUrl: "blob:sync-history" });
    const persistedAttachment = persistedAttachmentFor(image);

    store.setPrompt(threadId, "draft before async image persistence");
    store.addImage(threadId, image);
    const draftBeforeBrowse = useComposerDraftStore.getState().draftsByThreadId[threadId]!;
    store.setPromptHistorySavedDraft(
      threadId,
      captureComposerPromptHistorySavedDraft({
        threadId,
        draft: draftBeforeBrowse,
        prompt: draftBeforeBrowse.prompt,
      }),
    );

    setLocalStorageItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      {
        version: COMPOSER_DRAFT_STORAGE_VERSION,
        state: {
          draftsByThreadId: {
            [threadId]: {
              prompt: "recalled history prompt",
              promptHistorySavedDraft: {
                prompt: "draft before async image persistence",
                attachments: [persistedAttachment],
              },
              attachments: [],
            },
          },
          draftThreadsByThreadId: {},
          projectDraftThreadIdByProjectId: {},
        },
      },
      Schema.Unknown,
    );
    await store.syncPromptHistorySavedDraftPersistedAttachments(threadId, [persistedAttachment]);

    const savedDraft =
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.promptHistorySavedDraft;
    expect(savedDraft?.persistedAttachments.map((entry) => entry.id)).toEqual(["img-sync-history"]);
    expect(savedDraft?.nonPersistedImageIds).toEqual([]);
  });
});

describe("composerDraftStore pull request context cards", () => {
  const threadId = ThreadId.makeUnsafe("thread-pr-cards");
  const card = {
    id: "pr-card-1",
    createdAt: "2026-09-08T12:00:00.000Z",
    scope: "checks" as const,
    prNumber: 321,
    prUrl: "https://github.com/example/glade/pull/321",
    title: "1 failing check",
    subtitle: "Test",
    text: "Fix the failing CI checks on PR #321.",
  };

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("replaces a card for the same PR scope instead of stacking it", () => {
    const store = useComposerDraftStore.getState();
    expect(store.addPullRequestContext(threadId, card)).toBe(true);
    expect(
      store.addPullRequestContext(threadId, { ...card, id: "pr-card-2", subtitle: "Test, Lint" }),
    ).toBe(true);
    expect(
      store.addPullRequestContext(threadId, { ...card, id: "pr-card-3", scope: "comments" }),
    ).toBe(true);
    expect(store.addPullRequestContext(threadId, { ...card, id: "empty", text: " " })).toBe(false);

    const cards = useComposerDraftStore.getState().draftsByThreadId[threadId]?.pullRequestContexts;
    expect(cards?.map((entry) => [entry.id, entry.subtitle])).toEqual([
      ["pr-card-2", "Test, Lint"],
      ["pr-card-3", "Test"],
    ]);

    store.removePullRequestContext(threadId, "pr-card-2");
    store.removePullRequestContext(threadId, "pr-card-3");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("persists and hydrates cards", () => {
    useComposerDraftStore.getState().addPullRequestContext(threadId, card);
    const persistedState = persistComposerDraftState();
    expect(persistedState.draftsByThreadId?.[threadId]?.pullRequestContexts).toEqual([card]);

    expect(
      mergePersistedComposerDraftState(persistedState).draftsByThreadId[threadId]
        ?.pullRequestContexts,
    ).toEqual([card]);
  });
});

describe("composerDraftStore syncPersistedAttachments", () => {
  const threadId = ThreadId.makeUnsafe("thread-sync-persisted");

  beforeEach(() => {
    removeLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY);
    resetComposerDraftStore();
  });

  afterEach(() => {
    removeLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY);
  });

  it("stages overlapping attachment syncs immediately and serializes verification", async () => {
    const firstImage = makeImage({
      id: "sync-image-first",
      previewUrl: "blob:sync-image-first",
      name: "sync-image-first.png",
    });
    const secondImage = makeImage({
      id: "sync-image-second",
      previewUrl: "blob:sync-image-second",
      name: "sync-image-second.png",
    });
    const store = useComposerDraftStore.getState();
    store.addImages(threadId, [firstImage, secondImage]);

    const firstSync = store.syncPersistedAttachments(threadId, [
      persistedAttachmentFor(firstImage),
    ]);
    const secondSync = store.syncPersistedAttachments(threadId, [
      persistedAttachmentFor(firstImage),
      persistedAttachmentFor(secondImage),
    ]);

    expect(
      useComposerDraftStore
        .getState()
        .draftsByThreadId[threadId]?.persistedAttachments.map((attachment) => attachment.id),
    ).toEqual([firstImage.id, secondImage.id]);
    await expect(Promise.all([firstSync, secondSync])).resolves.toEqual(["persisted", "persisted"]);
    expect(
      useComposerDraftStore
        .getState()
        .draftsByThreadId[threadId]?.persistedAttachments.map((attachment) => attachment.id),
    ).toEqual([firstImage.id, secondImage.id]);
  });

  it("replaces malformed persisted draft storage with the current valid draft", async () => {
    const image = makeImage({
      id: "img-persisted",
      previewUrl: "blob:persisted",
    });
    useComposerDraftStore.getState().addImage(threadId, image);
    setLocalStorageItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      {
        version: 2,
        state: {
          draftsByThreadId: {
            [threadId]: {
              attachments: "not-an-array",
            },
          },
        },
      },
      Schema.Unknown,
    );

    const persisted = await useComposerDraftStore.getState().syncPersistedAttachments(threadId, [
      {
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: image.previewUrl,
      },
    ]);
    expect(persisted).toBe("persisted");

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.persistedAttachments,
    ).toHaveLength(1);
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.nonPersistedImageIds,
    ).toEqual([]);
  });
});
