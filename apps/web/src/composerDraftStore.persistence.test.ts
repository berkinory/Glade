import { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { beforeEach, describe, expect, it } from "vitest";
import { useComposerDraftStore } from "./composerDraftStore";
import { normalizeCurrentPersistedComposerDraftStoreState } from "./composerDraftPersistence.serialization";
import {
  makeImage,
  makeQueuedChatTurn,
  makeQueuedTurn,
  makeTerminalContext,
  mergePersistedComposerDraftState,
  modelSelection,
  persistComposerDraftState,
  resetComposerDraftStore,
  stubRevokeObjectUrl,
} from "./composerDraftStoreTestFixtures";
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  insertInlineTerminalContextPlaceholder,
} from "./lib/terminalContext";

describe("composerDraftStore persisted-state hydration", () => {
  it("normalizes null and empty persisted states", () => {
    const emptyState = {
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    };

    expect(normalizeCurrentPersistedComposerDraftStoreState(null)).toEqual(emptyState);
    expect(normalizeCurrentPersistedComposerDraftStoreState({})).toEqual(emptyState);
  });

  it("hydrates project mappings, defaults, and persisted selections", () => {
    const projectId = ProjectId.makeUnsafe("project-hydration");
    const threadId = ThreadId.makeUnsafe("thread-hydration");
    const mappingKey = `${projectId}::terminal`;

    const hydrated = normalizeCurrentPersistedComposerDraftStoreState({
      draftsByThreadId: {
        [threadId]: {
          prompt: "Review these selections",
          attachments: [],
          assistantSelections: [
            {
              id: "assistant-selection-1",
              assistantMessageId: " assistant-message-1 ",
              text: " selected assistant text ",
            },
          ],
          fileComments: [
            {
              id: "file-comment-1",
              path: " src/example.ts ",
              startLine: 8,
              endLine: 4,
              text: " selected file text ",
            },
          ],
        },
      },
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: { [mappingKey]: threadId },
    });

    expect(hydrated.projectDraftThreadIdByProjectId).toEqual({ [projectId]: threadId });
    expect(hydrated.draftThreadsByThreadId[threadId]).toMatchObject({
      projectId,
      runtimeMode: "full-access",
    });
    expect(hydrated.draftsByThreadId[threadId]?.assistantSelections).toEqual([
      {
        id: "assistant-selection-1",
        assistantMessageId: "assistant-message-1",
        text: "selected assistant text",
      },
    ]);
    expect(hydrated.draftsByThreadId[threadId]?.fileComments).toEqual([
      {
        id: "file-comment-1",
        path: "src/example.ts",
        startLine: 8,
        endLine: 8,
        text: "selected file text",
      },
    ]);
  });

  it("keeps both drafts when migrating a project with chat and terminal slots", () => {
    const projectId = ProjectId.makeUnsafe("project-two-legacy-slots");
    const chatThreadId = ThreadId.makeUnsafe("thread-chat-draft");
    const terminalThreadId = ThreadId.makeUnsafe("thread-terminal-draft");
    const hydrated = normalizeCurrentPersistedComposerDraftStoreState({
      draftsByThreadId: {
        [chatThreadId]: { prompt: "chat draft" },
        [terminalThreadId]: { prompt: "terminal draft" },
      },
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {
        [projectId]: chatThreadId,
        [`${projectId}::terminal`]: terminalThreadId,
      },
    });

    expect(hydrated.projectDraftThreadIdByProjectId).toEqual({ [projectId]: chatThreadId });
    expect(hydrated.draftThreadsByThreadId[terminalThreadId]?.projectId).toBe(projectId);
    expect(hydrated.draftsByThreadId[terminalThreadId]?.prompt).toBe("terminal draft");
  });

  it("preserves AI-reviewed auto mode during hydration", () => {
    const projectId = ProjectId.makeUnsafe("project-auto-mode");
    const threadId = ThreadId.makeUnsafe("thread-auto-mode");

    const hydrated = normalizeCurrentPersistedComposerDraftStoreState({
      draftsByThreadId: {
        [threadId]: {
          prompt: "",
          attachments: [],
          runtimeMode: "auto",
        },
      },
      draftThreadsByThreadId: {
        [threadId]: {
          projectId,
          createdAt: "2026-07-25T00:00:00.000Z",
          runtimeMode: "auto",

          branch: null,
          worktreePath: null,
          workingDirectory: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {},
    });

    expect(hydrated.draftsByThreadId[threadId]?.runtimeMode).toBe("auto");
    expect(hydrated.draftThreadsByThreadId[threadId]?.runtimeMode).toBe("auto");
  });

  it("keeps legacy temporary chat drafts as ordinary drafts", () => {
    const projectId = ProjectId.makeUnsafe("project-legacy-temporary");
    const threadId = ThreadId.makeUnsafe("thread-legacy-temporary");
    const hydrated = normalizeCurrentPersistedComposerDraftStoreState({
      draftsByThreadId: {
        [threadId]: { prompt: "Keep this unsent message" },
      },
      draftThreadsByThreadId: {
        [threadId]: {
          projectId,
          createdAt: "2026-08-13T00:00:00.000Z",
          runtimeMode: "full-access",

          branch: null,
          worktreePath: null,
          workingDirectory: null,
          envMode: "local",
          isTemporary: true,
        },
      },
      projectDraftThreadIdByProjectId: { [projectId]: threadId },
    });

    expect(hydrated.projectDraftThreadIdByProjectId[projectId]).toBe(threadId);
    expect(hydrated.draftThreadsByThreadId[threadId]?.projectId).toBe(projectId);
    expect(hydrated.draftsByThreadId[threadId]?.prompt).toBe("Keep this unsent message");
  });
});

describe("composerDraftStore provider references", () => {
  const threadId = ThreadId.makeUnsafe("thread-provider-refs");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("persists selected plugin mentions with regular composer drafts", () => {
    const selectedSkill = { name: "check-code", path: "/skills/check-code" };
    const selectedMention = { name: "linear", path: "plugin://linear" };
    const store = useComposerDraftStore.getState();

    store.setPrompt(threadId, "Use @linear with /check-code");
    store.setSkills(threadId, [selectedSkill]);
    store.setMentions(threadId, [selectedMention]);

    const persistedState = persistComposerDraftState();
    expect(persistedState.draftsByThreadId?.[threadId]?.skills).toEqual([selectedSkill]);
    expect(persistedState.draftsByThreadId?.[threadId]?.mentions).toEqual([selectedMention]);

    const mergedState = mergePersistedComposerDraftState(persistedState);
    expect(mergedState.draftsByThreadId[threadId]?.skills).toEqual([selectedSkill]);
    expect(mergedState.draftsByThreadId[threadId]?.mentions).toEqual([selectedMention]);
  });
});

describe("composerDraftStore terminal contexts", () => {
  const threadId = ThreadId.makeUnsafe("thread-dedupe");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("deduplicates identical terminal contexts by selection signature", () => {
    const first = makeTerminalContext({ id: "ctx-1" });
    const duplicate = makeTerminalContext({ id: "ctx-2" });

    useComposerDraftStore.getState().addTerminalContexts(threadId, [first, duplicate]);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.terminalContexts.map((context) => context.id)).toEqual(["ctx-1"]);
  });

  it("inserts terminal contexts at the requested inline prompt position", () => {
    const firstInsertion = insertInlineTerminalContextPlaceholder("alpha beta", 6);
    const secondInsertion = insertInlineTerminalContextPlaceholder(firstInsertion.prompt, 0);

    expect(
      useComposerDraftStore
        .getState()
        .insertTerminalContext(
          threadId,
          firstInsertion.prompt,
          makeTerminalContext({ id: "ctx-1" }),
          firstInsertion.contextIndex,
        ),
    ).toBe(true);
    expect(
      useComposerDraftStore.getState().insertTerminalContext(
        threadId,
        secondInsertion.prompt,
        makeTerminalContext({
          id: "ctx-2",
          terminalLabel: "Terminal 2",
          lineStart: 9,
          lineEnd: 10,
        }),
        secondInsertion.contextIndex,
      ),
    ).toBe(true);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.prompt).toBe(
      `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} alpha ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} beta`,
    );
    expect(draft?.terminalContexts.map((context) => context.id)).toEqual(["ctx-2", "ctx-1"]);
  });

  it("persists terminal context metadata without snapshot text and hydrates it empty", () => {
    useComposerDraftStore
      .getState()
      .addTerminalContext(threadId, makeTerminalContext({ id: "ctx-persist" }));
    const metadata = {
      id: "ctx-persist",
      terminalId: "default",
      terminalLabel: "Terminal 1",
      lineStart: 4,
      lineEnd: 5,
    };

    const persistedState = persistComposerDraftState();
    const persistedContext = (
      persistedState.draftsByThreadId?.[threadId]?.terminalContexts as
        | Array<Record<string, unknown>>
        | undefined
    )?.[0];
    expect(persistedContext).toMatchObject(metadata);
    expect(persistedContext).not.toHaveProperty("text");

    expect(
      mergePersistedComposerDraftState(persistedState).draftsByThreadId[threadId]?.terminalContexts,
    ).toMatchObject([{ ...metadata, text: "" }]);
  });

  it("sanitizes malformed persisted drafts during merge", () => {
    const mergedState = mergePersistedComposerDraftState({
      draftsByThreadId: {
        [threadId]: {
          prompt: "",
          attachments: "not-an-array",
          terminalContexts: "not-an-array",
          provider: "bogus-provider",
          modelOptions: "not-an-object",
        },
      },
      draftThreadsByThreadId: "not-an-object",
      projectDraftThreadIdByProjectId: "not-an-object",
    });

    expect(mergedState.draftsByThreadId[threadId]).toBeUndefined();
    expect(mergedState.draftThreadsByThreadId).toEqual({});
    expect(mergedState.projectDraftThreadIdByProjectId).toEqual({});
  });

  it("trims a runtime-discovered Codex effort from legacy draft storage", () => {
    const mergedState = mergePersistedComposerDraftState({
      draftsByThreadId: {
        [threadId]: {
          provider: "codex",
          model: "gpt-5.6-sol",
          effort: "  ultra  ",
        },
      },
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });

    expect(mergedState.draftsByThreadId[threadId]?.modelSelectionByProvider.codex).toEqual(
      modelSelection("codex", "gpt-5.6-sol", { reasoningEffort: "ultra" }),
    );
  });

  it("restores provider-scoped selections without leaking effort across providers", () => {
    const codexSelection = modelSelection("codex", "gpt-5.6-sol", {
      reasoningEffort: "ultra",
    });
    const claudeSelection = modelSelection("claudeAgent", "claude-sonnet-5", {
      effort: "high",
    });
    const mergedState = mergePersistedComposerDraftState({
      draftsByThreadId: {
        [threadId]: {
          modelSelectionByProvider: {
            codex: codexSelection,
            claudeAgent: claudeSelection,
          },
          activeProvider: "claudeAgent",
        },
      },
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });

    const draft = mergedState.draftsByThreadId[threadId];
    expect(draft?.modelSelectionByProvider.codex).toEqual(codexSelection);
    expect(draft?.modelSelectionByProvider.claudeAgent).toEqual(claudeSelection);
    expect(draft?.activeProvider).toBe("claudeAgent");
  });
});

describe("composerDraftStore queued follow-ups", () => {
  const threadId = ThreadId.makeUnsafe("thread-queue");
  const queueProjectId = ProjectId.makeUnsafe("queue-project");
  const revokeSpy = stubRevokeObjectUrl();

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("keeps queued turns when the live composer draft is cleared", () => {
    const store = useComposerDraftStore.getState();

    store.setPrompt(threadId, "temporary prompt");
    store.setSkills(threadId, [{ name: "check-code", path: "/skills/check-code" }]);
    store.setMentions(threadId, [{ name: "linear", path: "plugin://linear" }]);
    store.enqueueQueuedTurn(threadId, makeQueuedTurn("queued-1"));
    store.clearComposerContent(threadId);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
      prompt: "",
      skills: [],
      mentions: [],
      queuedTurns: [makeQueuedTurn("queued-1")],
    });
  });

  it("drops the draft entry once the last queued turn is removed", () => {
    const store = useComposerDraftStore.getState();

    store.enqueueQueuedTurn(threadId, makeQueuedTurn("queued-1"));
    store.removeQueuedTurn(threadId, "queued-1");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("persists queued chat turns for refresh and restart rehydration", () => {
    const queuedImage = makeImage({
      id: "queued-image-persisted",
      previewUrl: "data:image/png;base64,AA==",
      name: "queued.png",
    });
    const store = useComposerDraftStore.getState();
    store.enqueueQueuedTurn(threadId, makeQueuedChatTurn("queued-chat-1", queuedImage));

    const persistedState = persistComposerDraftState();
    expect(persistedState.draftsByThreadId?.[threadId]?.queuedTurns).toHaveLength(1);

    const mergedState = mergePersistedComposerDraftState(persistedState);
    expect(mergedState.draftsByThreadId[threadId]?.queuedTurns).toMatchObject([
      {
        id: "queued-chat-1",
        kind: "chat",
        prompt: "queued chat prompt",
        images: [{ name: "queued.png" }],
        terminalContexts: [{ text: "git status\nOn branch main" }],
      },
    ]);
  });

  it.each([
    {
      name: "a queued turn is removed",
      release: () => useComposerDraftStore.getState().removeQueuedTurn(threadId, "queued-blob"),
    },
    {
      name: "a draft thread is cleared",
      release: () => useComposerDraftStore.getState().clearDraftThread(threadId),
    },
    {
      name: "a project draft is cleared by project and thread id",
      release: () =>
        useComposerDraftStore.getState().clearProjectDraftThreadById(queueProjectId, threadId),
    },
  ])("revokes queued chat image blob URLs when $name", ({ release }) => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(queueProjectId, threadId);
    store.enqueueQueuedTurn(
      threadId,
      makeQueuedChatTurn(
        "queued-blob",
        makeImage({ id: "queued-image-blob", previewUrl: "blob:queued-image-blob" }),
      ),
    );

    release();

    expect(revokeSpy).toHaveBeenCalledWith("blob:queued-image-blob");
  });
});
