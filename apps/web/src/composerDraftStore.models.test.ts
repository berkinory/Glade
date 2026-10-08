import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { beforeEach, describe, expect, it } from "vitest";
import { resolvePreferredComposerModelSelection } from "./composerDraftModels";
import { useComposerDraftStore } from "./composerDraftStore";
import { normalizeModelSelection } from "./composerDraftModels";
import {
  mergePersistedComposerDraftState,
  modelSelection,
  providerModelOptions,
  resetComposerDraftStore,
} from "./composerDraftStoreTestFixtures";

describe("resolvePreferredComposerModelSelection", () => {
  it("preserves the exact Claude model id during normalization", () => {
    expect(
      normalizeModelSelection({ provider: "claudeAgent", model: "claude-fable-5-1[1M]" }),
    ).toEqual(modelSelection("claudeAgent", "claude-fable-5-1[1M]"));
  });

  it("prefers the active draft provider selection over thread and project defaults", () => {
    expect(
      resolvePreferredComposerModelSelection({
        draft: {
          modelSelectionByProvider: {
            claudeAgent: modelSelection("claudeAgent", "claude-opus-4-6", {
              effort: "max",
            }),
          },
          activeProvider: "claudeAgent",
        },
        threadModelSelection: modelSelection("codex", "gpt-5"),
        projectModelSelection: modelSelection("codex", "gpt-5.4"),
      }),
    ).toEqual(
      modelSelection("claudeAgent", "claude-opus-4-6", {
        effort: "max",
      }),
    );
  });

  it("uses only the active provider selection for draft promotion", () => {
    const claudeSelection = modelSelection("claudeAgent", "claude-sonnet-5", {
      effort: "high",
    });
    expect(
      resolvePreferredComposerModelSelection({
        draft: {
          modelSelectionByProvider: {
            codex: modelSelection("codex", "gpt-5.6-sol", { reasoningEffort: "ultra" }),
            claudeAgent: claudeSelection,
          },
          activeProvider: "claudeAgent",
        },
        threadModelSelection: null,
        projectModelSelection: null,
      }),
    ).toEqual(claudeSelection);
  });
});

describe("composerDraftStore modelSelection", () => {
  const threadId = ThreadId.makeUnsafe("thread-model-options");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it.each(["max", "ultra"])(
    "retains runtime-discovered Codex %s effort in thread and sticky selections",
    (reasoningEffort) => {
      const store = useComposerDraftStore.getState();
      const selection = modelSelection("codex", "gpt-5.6-sol", { reasoningEffort });

      store.setModelSelection(threadId, selection);
      store.setStickyModelSelection(selection);

      const state = useComposerDraftStore.getState();
      expect(state.draftsByThreadId[threadId]?.modelSelectionByProvider.codex).toEqual(selection);
      expect(state.stickyModelSelectionByProvider.codex).toEqual(selection);
    },
  );

  it("drops malformed Codex reasoning efforts while preserving other options", () => {
    const store = useComposerDraftStore.getState();

    store.setProviderModelOptions(
      threadId,
      "codex",
      { reasoningEffort: "   ", fastMode: true },
      { model: "gpt-5.6-sol" },
    );

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex,
    ).toEqual(modelSelection("codex", "gpt-5.6-sol", { fastMode: true }));
  });

  it.each<{
    name: string;
    initial: ModelSelection;
    stickyInitial: ModelSelection | null;
    options: Record<string, unknown>;
    persistSticky: boolean | undefined;
    expectedDraft: ModelSelection;
    expectedSticky: ModelSelection | undefined;
  }>([
    {
      name: "replaces only the targeted options and persists sticky when asked",
      initial: modelSelection("claudeAgent", "claude-opus-4-6", { effort: "max", fastMode: true }),
      stickyInitial: modelSelection("claudeAgent", "claude-opus-4-6", {
        effort: "max",
        fastMode: true,
      }),
      options: { thinking: false },
      persistSticky: true,
      expectedDraft: modelSelection("claudeAgent", "claude-opus-4-6", { thinking: false }),
      expectedSticky: modelSelection("claudeAgent", "claude-opus-4-6", { thinking: false }),
    },
    {
      name: "updates only the draft when sticky persistence is omitted",
      initial: modelSelection("claudeAgent", "claude-opus-4-6", { effort: "max" }),
      stickyInitial: modelSelection("claudeAgent", "claude-opus-4-6", { effort: "max" }),
      options: { thinking: false },
      persistSticky: undefined,
      expectedDraft: modelSelection("claudeAgent", "claude-opus-4-6", { thinking: false }),
      expectedSticky: modelSelection("claudeAgent", "claude-opus-4-6", { effort: "max" }),
    },
    {
      name: "keeps explicit default-state Claude overrides without creating sticky state",
      initial: modelSelection("claudeAgent", "claude-opus-4-6", { effort: "max" }),
      stickyInitial: null,
      options: { thinking: true },
      persistSticky: undefined,
      expectedDraft: modelSelection("claudeAgent", "claude-opus-4-6", { thinking: true }),
      expectedSticky: undefined,
    },
    {
      name: "keeps explicit off/default Codex overrides",
      initial: modelSelection("codex", "gpt-5.4", { fastMode: true }),
      stickyInitial: null,
      options: { reasoningEffort: "high", fastMode: false },
      persistSticky: undefined,
      expectedDraft: modelSelection("codex", "gpt-5.4", {
        reasoningEffort: "high",
        fastMode: false,
      }),
      expectedSticky: undefined,
    },
    {
      name: "creates the first sticky snapshot from provider option changes",
      initial: modelSelection("codex", "gpt-5.4"),
      stickyInitial: null,
      options: { fastMode: true },
      persistSticky: true,
      expectedDraft: modelSelection("codex", "gpt-5.4", { fastMode: true }),
      expectedSticky: modelSelection("codex", "gpt-5.4", { fastMode: true }),
    },
  ])(
    "setProviderModelOptions $name",
    ({ initial, stickyInitial, options, persistSticky, expectedDraft, expectedSticky }) => {
      const store = useComposerDraftStore.getState();
      if (stickyInitial) store.setStickyModelSelection(stickyInitial);
      store.setModelSelection(threadId, initial);

      store.setProviderModelOptions(
        threadId,
        initial.provider,
        options as never,
        persistSticky === undefined ? undefined : { persistSticky },
      );

      const state = useComposerDraftStore.getState();
      expect(state.draftsByThreadId[threadId]?.modelSelectionByProvider[initial.provider]).toEqual(
        expectedDraft,
      );
      expect(state.stickyModelSelectionByProvider[initial.provider]).toEqual(expectedSticky);
    },
  );

  it("does not clear other provider options when setting options for a single provider", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(threadId, modelSelection("codex", "gpt-6.1-sol"));
    store.setModelSelection(threadId, modelSelection("claudeAgent", "claude-opus-5-5"));
    store.setModelOptions(
      threadId,
      providerModelOptions({
        codex: { fastMode: true },
        claudeAgent: { effort: "max" },
      }),
    );

    store.setModelOptions(threadId, providerModelOptions({ codex: { reasoningEffort: "xhigh" } }));

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.modelSelectionByProvider.codex?.options).toEqual({ reasoningEffort: "xhigh" });
    expect(draft?.modelSelectionByProvider.claudeAgent?.options).toEqual({ effort: "max" });
  });

  it("preserves other provider options when switching the active model selection", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(threadId, modelSelection("codex", "gpt-6.1-sol"));
    store.setModelSelection(threadId, modelSelection("claudeAgent", "claude-opus-5-5"));
    store.setModelOptions(
      threadId,
      providerModelOptions({
        codex: { fastMode: true },
        claudeAgent: { effort: "max" },
      }),
    );

    store.setModelSelection(threadId, modelSelection("claudeAgent", "claude-opus-4-6"));

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.modelSelectionByProvider.claudeAgent).toEqual(
      modelSelection("claudeAgent", "claude-opus-4-6", { effort: "max" }),
    );
    expect(draft?.modelSelectionByProvider.codex?.options).toEqual({ fastMode: true });
    expect(draft?.activeProvider).toBe("claudeAgent");
  });
});

describe("composerDraftStore setModelSelection", () => {
  const threadId = ThreadId.makeUnsafe("thread-model");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it.each([
    {
      name: "preserves an explicit Codex effort when discovery has not confirmed support",
      from: modelSelection("codex", "gpt-5.6-sol", { reasoningEffort: "ultra", fastMode: true }),
      to: modelSelection("codex", "gpt-5.4"),
      expected: modelSelection("codex", "gpt-5.4", { reasoningEffort: "ultra", fastMode: true }),
    },
    {
      name: "retains a runtime Codex effort when reselecting the same model",
      from: modelSelection("codex", "gpt-5.6-sol", { reasoningEffort: "max", fastMode: true }),
      to: modelSelection("codex", "gpt-5.6-sol"),
      expected: modelSelection("codex", "gpt-5.6-sol", { reasoningEffort: "max", fastMode: true }),
    },
    {
      name: "uses destination defaults when switching providers without saved state",
      from: modelSelection("codex", "gpt-5.6-sol", { reasoningEffort: "ultra" }),
      to: modelSelection("claudeAgent", "claude-opus-4-6"),
      expected: modelSelection("claudeAgent", "claude-opus-4-6"),
    },
  ])("$name", ({ from, to, expected }) => {
    const store = useComposerDraftStore.getState();
    store.setModelSelectionAndSticky(threadId, from);

    store.setModelSelectionAndSticky(threadId, to);

    const state = useComposerDraftStore.getState();
    const draft = state.draftsByThreadId[threadId];
    expect(draft?.modelSelectionByProvider[expected.provider]).toEqual(expected);
    expect(state.stickyModelSelectionByProvider[expected.provider]).toEqual(expected);
    expect(
      resolvePreferredComposerModelSelection({
        draft,
        threadModelSelection: null,
        projectModelSelection: null,
      }),
    ).toEqual(expected);
  });
});

describe("composerDraftStore sticky composer settings", () => {
  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("preserves Claude Auto support through sticky updates, options, and hydration", () => {
    const store = useComposerDraftStore.getState();
    const threadId = ThreadId.makeUnsafe("thread-claude-auto-capability");
    const selection: ModelSelection = {
      provider: "claudeAgent",
      model: "claude-haiku-4-5",
      supportsAutoMode: false,
    };

    store.setModelSelectionAndSticky(threadId, selection);
    store.setProviderModelOptions(
      threadId,
      "claudeAgent",
      { effort: "high" },
      { persistSticky: true },
    );

    const state = useComposerDraftStore.getState();
    expect(state.draftsByThreadId[threadId]?.modelSelectionByProvider.claudeAgent).toEqual({
      ...selection,
      options: { effort: "high" },
    });
    expect(state.stickyModelSelectionByProvider.claudeAgent).toEqual({
      ...selection,
      options: { effort: "high" },
    });

    const merged = mergePersistedComposerDraftState({
      draftsByThreadId: { [threadId]: state.draftsByThreadId[threadId] },
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {
        claudeAgent: state.stickyModelSelectionByProvider.claudeAgent,
      },
      stickyActiveProvider: "claudeAgent",
    });

    const hydratedClaudeSelection =
      merged.draftsByThreadId[threadId]?.modelSelectionByProvider.claudeAgent;
    expect(
      hydratedClaudeSelection?.provider === "claudeAgent"
        ? hydratedClaudeSelection.supportsAutoMode
        : undefined,
    ).toBe(false);
    expect(merged.stickyModelSelectionByProvider.claudeAgent).toMatchObject({
      supportsAutoMode: false,
    });
  });

  it("does not copy Claude Auto support metadata to a different model", () => {
    const store = useComposerDraftStore.getState();
    const threadId = ThreadId.makeUnsafe("thread-claude-auto-model-switch");
    store.setModelSelection(threadId, {
      provider: "claudeAgent",
      model: "claude-haiku-4-5",
      supportsAutoMode: false,
    });

    store.setModelSelection(threadId, {
      provider: "claudeAgent",
      model: "claude-sonnet-5",
    });

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider
        .claudeAgent,
    ).toEqual({
      provider: "claudeAgent",
      model: "claude-sonnet-5",
    });
  });

  it("preserves current sticky model fields during storage-version migration", () => {
    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        migrate: (persistedState: unknown, version: number) => unknown;
      };
    };
    const migratedState = persistApi.getOptions().migrate(
      {
        draftsByThreadId: {},
        draftThreadsByThreadId: {},
        projectDraftThreadIdByProjectId: {},
        stickyModelSelectionByProvider: {
          claudeAgent: modelSelection("claudeAgent", "claude-opus-4-6", {
            effort: "max",
          }),
        },
        stickyActiveProvider: "claudeAgent",
        stickyProvider: "codex",
        stickyModel: "gpt-5",
      },
      4,
    ) as {
      stickyModelSelectionByProvider: Partial<Record<ModelSelection["provider"], ModelSelection>>;
      stickyActiveProvider: ModelSelection["provider"] | null;
    };

    expect(migratedState.stickyModelSelectionByProvider.claudeAgent).toEqual(
      modelSelection("claudeAgent", "claude-opus-4-6", {
        effort: "max",
      }),
    );
    expect(migratedState.stickyActiveProvider).toBe("claudeAgent");
  });

  it("applies sticky activeProvider to new drafts", () => {
    const store = useComposerDraftStore.getState();
    const threadId = ThreadId.makeUnsafe("thread-sticky-active-provider");

    store.setStickyModelSelection(modelSelection("claudeAgent", "claude-opus-4-6"));
    store.applyStickyState(threadId);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
      modelSelectionByProvider: {
        claudeAgent: modelSelection("claudeAgent", "claude-opus-4-6"),
      },
      activeProvider: "claudeAgent",
    });
  });
  it("does not overwrite existing model-scoped options with another sticky model", () => {
    const store = useComposerDraftStore.getState();
    const threadId = ThreadId.makeUnsafe("thread-sticky-model-scope");
    const currentSelection = modelSelection("codex", "gpt-5.4", {
      reasoningEffort: "xhigh",
    });
    store.setStickyModelSelection(
      modelSelection("codex", "gpt-5.6-sol", { reasoningEffort: "ultra" }),
    );
    store.setModelSelection(threadId, currentSelection);

    store.applyStickyState(threadId);

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex,
    ).toEqual(currentSelection);
  });

  it("restores sticky options for the same provider and model", () => {
    const store = useComposerDraftStore.getState();
    const threadId = ThreadId.makeUnsafe("thread-sticky-same-model");
    const stickySelection = modelSelection("codex", "gpt-5.4", {
      reasoningEffort: "xhigh",
    });
    store.setStickyModelSelection(stickySelection);
    store.setModelSelection(threadId, modelSelection("codex", "gpt-5.4"));

    store.applyStickyState(threadId);

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex,
    ).toEqual(stickySelection);
  });
});

describe("composerDraftStore provider-scoped option updates", () => {
  const threadId = ThreadId.makeUnsafe("thread-provider");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("retains off-provider option memory without changing the active selection", () => {
    const store = useComposerDraftStore.getState();
    store.setModelSelection(
      threadId,
      modelSelection("codex", "gpt-5.3-codex", {
        reasoningEffort: "medium",
      }),
    );
    store.setProviderModelOptions(
      threadId,
      "claudeAgent",
      { effort: "max" },
      { model: "claude-opus-5-5" },
    );
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.modelSelectionByProvider.codex).toEqual(
      modelSelection("codex", "gpt-5.3-codex", { reasoningEffort: "medium" }),
    );
    expect(draft?.modelSelectionByProvider.claudeAgent?.options).toEqual({ effort: "max" });
    expect(draft?.activeProvider).toBe("codex");
  });
});
