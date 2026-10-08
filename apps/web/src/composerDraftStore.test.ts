import { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { beforeEach, describe, expect, it } from "vitest";
import { selectComposerThreadDraft } from "./composerDraftDomain";
import { markPromotedDraftThreads, useComposerDraftStore } from "./composerDraftStore";
import {
  makeImage,
  makeQueuedChatTurn,
  resetComposerDraftStore,
  stubRevokeObjectUrl,
} from "./composerDraftStoreTestFixtures";

describe("composerDraftStore draft identity", () => {
  it("keeps missing and untouched drafts referentially stable across unrelated updates", () => {
    resetComposerDraftStore();
    const missingThreadId = ThreadId.makeUnsafe("thread-missing");
    const untouchedThreadId = ThreadId.makeUnsafe("thread-untouched");
    const otherThreadId = ThreadId.makeUnsafe("thread-other");
    useComposerDraftStore.getState().setPrompt(untouchedThreadId, "untouched");
    const missing = selectComposerThreadDraft(useComposerDraftStore.getState(), missingThreadId);
    const untouched = useComposerDraftStore.getState().draftsByThreadId[untouchedThreadId];

    useComposerDraftStore.getState().setPrompt(otherThreadId, "unrelated");

    const state = useComposerDraftStore.getState();
    expect(selectComposerThreadDraft(state, missingThreadId)).toBe(missing);
    expect(state.draftsByThreadId[untouchedThreadId]).toBe(untouched);
  });
});

describe("composerDraftStore clearComposerContent", () => {
  const threadId = ThreadId.makeUnsafe("thread-clear");
  const revokeSpy = stubRevokeObjectUrl();

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it.each([
    { name: "revokes blob preview URLs", preservePreviewUrls: false },
    {
      name: "preserves blob preview URLs for optimistic message handoff",
      preservePreviewUrls: true,
    },
  ])("$name when clearing composer content", ({ preservePreviewUrls }) => {
    useComposerDraftStore
      .getState()
      .addImage(threadId, makeImage({ id: "img-clear", previewUrl: "blob:clear" }));

    useComposerDraftStore.getState().clearComposerContent(threadId, { preservePreviewUrls });

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
    expect(revokeSpy.mock.calls).toEqual(preservePreviewUrls ? [] : [["blob:clear"]]);
  });

  it("keeps newer edits and attachments when a captured send is consumed and promoted", () => {
    const store = useComposerDraftStore.getState();
    store.registerDraftThread(threadId, { projectId: ProjectId.makeUnsafe("project-send") });
    store.setPrompt(threadId, "sent text");
    store.addImage(threadId, makeImage({ id: "sent-image", previewUrl: "blob:sent" }));
    const consumedDraft = useComposerDraftStore.getState().draftsByThreadId[threadId]!;
    store.setPrompt(threadId, "new text during preparation");
    store.addImage(
      threadId,
      makeImage({ id: "new-image", previewUrl: "blob:new", name: "new.png" }),
    );
    store.clearComposerContent(threadId, { consumedDraft, preservePreviewUrls: true });
    store.markDraftThreadPromoting(threadId);
    store.finalizePromotedDraftThread(threadId);
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.prompt).toBe("new text during preparation");
    expect(draft?.images.map((image) => image.id)).toEqual(["new-image"]);
    expect(revokeSpy).not.toHaveBeenCalled();
  });
});

describe("composerDraftStore project draft thread mapping", () => {
  const projectId = ProjectId.makeUnsafe("project-a");
  const otherProjectId = ProjectId.makeUnsafe("project-b");
  const threadId = ThreadId.makeUnsafe("thread-a");
  const otherThreadId = ThreadId.makeUnsafe("thread-b");
  const revokeSpy = stubRevokeObjectUrl();

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("stores and reads project draft thread ids via actions", () => {
    const store = useComposerDraftStore.getState();
    expect(store.getDraftThreadByProjectId(projectId)).toBeNull();
    expect(store.getDraftThread(threadId)).toBeNull();

    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toEqual({
      threadId,
      projectId,
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      workingDirectory: null,
      envMode: "worktree",
      runtimeMode: "full-access",

      createdAt: "2026-01-01T00:00:00.000Z",
      lastKnownPr: null,
    });
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toEqual({
      projectId,
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      workingDirectory: null,
      envMode: "worktree",
      runtimeMode: "full-access",

      createdAt: "2026-01-01T00:00:00.000Z",
      lastKnownPr: null,
    });
  });

  it("registers a standalone draft for staged navigation", () => {
    const store = useComposerDraftStore.getState();

    store.registerDraftThread(threadId, {
      projectId,
      envMode: "local",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toMatchObject({
      projectId,
      envMode: "local",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
  });

  it.each([
    {
      name: "a matching project and thread id",
      clear: () => {
        useComposerDraftStore.getState().clearProjectDraftThreadById(projectId, otherThreadId);
        expect(
          useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)?.threadId,
        ).toBe(threadId);
        useComposerDraftStore.getState().clearProjectDraftThreadById(projectId, threadId);
      },
    },
    {
      name: "project id",
      clear: () => useComposerDraftStore.getState().clearProjectDraftThreadId(projectId),
    },
    {
      name: "draft thread id",
      clear: () => useComposerDraftStore.getState().clearDraftThread(threadId),
    },
  ])("clears the mapping, registration and composer draft by $name", ({ clear }) => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "remove me");

    clear();

    const state = useComposerDraftStore.getState();
    expect(state.getDraftThreadByProjectId(projectId)).toBeNull();
    expect(state.getDraftThread(threadId)).toBeNull();
    expect(state.draftsByThreadId[threadId]).toBeUndefined();
  });

  it("clears orphaned composer drafts when remapping a project to a new draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "orphan me");

    store.setProjectDraftThreadId(projectId, otherThreadId);

    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)?.threadId).toBe(
      otherThreadId,
    );
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("keeps composer drafts when the thread is still mapped by another project", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setProjectDraftThreadId(otherProjectId, threadId);
    store.setPrompt(threadId, "keep me");
    store.enqueueQueuedTurn(
      threadId,
      makeQueuedChatTurn(
        "queued-kept-thread",
        makeImage({ id: "queued-image-kept", previewUrl: "blob:queued-kept-thread" }),
      ),
    );

    store.clearProjectDraftThreadId(projectId);

    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(
      useComposerDraftStore.getState().getDraftThreadByProjectId(otherProjectId)?.threadId,
    ).toBe(threadId);
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.prompt).toBe("keep me");
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.queuedTurns).toHaveLength(
      1,
    );
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:queued-kept-thread");
  });

  it("preserves composer state after promotion finalizes", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "keep me while server thread hydrates");

    markPromotedDraftThreads(new Set([threadId]));

    expect(useComposerDraftStore.getState().getDraftThread(threadId)?.promotedTo).toBe(threadId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.prompt).toBe(
      "keep me while server thread hydrates",
    );

    useComposerDraftStore.getState().finalizePromotedDraftThread(threadId);

    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.prompt).toBe(
      "keep me while server thread hydrates",
    );
  });

  it("updates branch context on an existing draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "main",
      worktreePath: null,
    });
    store.setDraftThreadContext(threadId, {
      branch: "feature/next",
      worktreePath: "/tmp/feature-next",
    });
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)?.threadId).toBe(
      threadId,
    );
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toMatchObject({
      projectId,
      branch: "feature/next",
      worktreePath: "/tmp/feature-next",
      envMode: "worktree",
    });
  });

  it("moves an empty draft to another project while preserving composer content", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "feature/old",
      worktreePath: "/tmp/old-worktree",
      envMode: "worktree",
    });
    store.setPrompt(threadId, "keep this draft");

    store.moveDraftThreadToProject(threadId, otherProjectId, {
      branch: null,
      worktreePath: null,
      envMode: "local",
      lastKnownPr: null,
    });

    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(
      useComposerDraftStore.getState().getDraftThreadByProjectId(otherProjectId),
    ).toMatchObject({
      threadId,
      projectId: otherProjectId,
      branch: null,
      worktreePath: null,
      envMode: "local",
    });
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.prompt).toBe(
      "keep this draft",
    );
  });

  it("clears the replaced target draft when moving a draft to another project", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "feature/old",
      worktreePath: "/tmp/old-worktree",
      envMode: "worktree",
    });
    store.setPrompt(threadId, "move this draft");
    store.setProjectDraftThreadId(otherProjectId, otherThreadId);
    store.setPrompt(otherThreadId, "replace this draft");
    store.enqueueQueuedTurn(
      otherThreadId,
      makeQueuedChatTurn(
        "queued-target-replaced",
        makeImage({ id: "queued-target-replaced", previewUrl: "blob:queued-target-replaced" }),
      ),
    );

    store.moveDraftThreadToProject(threadId, otherProjectId, {
      branch: null,
      worktreePath: null,
      envMode: "local",
      lastKnownPr: null,
    });

    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(
      useComposerDraftStore.getState().getDraftThreadByProjectId(otherProjectId),
    ).toMatchObject({
      threadId,
      projectId: otherProjectId,
      branch: null,
      worktreePath: null,
      envMode: "local",
    });
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.prompt).toBe(
      "move this draft",
    );
    expect(useComposerDraftStore.getState().getDraftThread(otherThreadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[otherThreadId]).toBeUndefined();
    expect(revokeSpy).toHaveBeenCalledWith("blob:queued-target-replaced");
  });

  it.each([
    {
      name: "branch and worktree",
      initial: { branch: "main", worktreePath: "/tmp/main-worktree" },
      expected: { branch: "main", worktreePath: "/tmp/main-worktree", envMode: "worktree" },
    },
    {
      name: "worktree env mode without a worktree path",
      initial: { branch: "feature/base", worktreePath: null, envMode: "worktree" as const },
      expected: { branch: "feature/base", worktreePath: null, envMode: "worktree" },
    },
  ])("preserves existing $name when remapping with undefined options", ({ initial, expected }) => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, initial);
    // Callers can pass explicit undefined at runtime even though the type omits it.
    const runtimeUndefinedOptions = {
      branch: undefined,
      worktreePath: undefined,
      envMode: undefined,
    } as unknown as { branch?: string | null };
    store.setProjectDraftThreadId(projectId, threadId, runtimeUndefinedOptions);

    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toMatchObject({
      projectId,
      ...expected,
    });
  });
});

describe("composerDraftStore runtime and interaction settings", () => {
  const threadId = ThreadId.makeUnsafe("thread-settings");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("removes empty settings-only drafts when overrides are cleared", () => {
    const store = useComposerDraftStore.getState();

    store.setRuntimeMode(threadId, "approval-required");

    store.setRuntimeMode(threadId, null);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });
});
