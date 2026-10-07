import { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { DeepMutable } from "effect/Types";
import * as Schema from "effect/Schema";
import {
  persistQueuedComposerImages,
  toStorageSafePersistedAttachment,
} from "./composerDraftAttachments";
import type { ComposerDraftStoreState } from "./composerDraftDomain";
import {
  legacyMergeModelSelectionIntoProviderModelOptions,
  legacySyncModelSelectionOptions,
  legacyToModelSelectionByProvider,
  normalizeModelSelection,
  normalizeProviderKind,
  normalizeProviderModelOptions,
  sanitizeStickyModelSelectionMap,
} from "./composerDraftModels";
import {
  EMPTY_PERSISTED_DRAFT_STORE_STATE,
  PersistedAssistantSelectionDraft,
  PersistedFileCommentDraft,
  PersistedPastedTextDraft,
  PersistedPullRequestContextDraft,
  PersistedQueuedTerminalContextDraft,
  PersistedTerminalContextDraft,
  normalizePersistedModelSelectionMap,
} from "./composerDraftPersistence.types";
import type {
  LegacyPersistedComposerDraftStoreState,
  PersistedComposerDraftStoreState,
  PersistedComposerThreadDraftState,
} from "./composerDraftPersistence.types";
import {
  normalizePersistedDraftThreads,
  normalizePersistedDraftsByThreadId,
} from "./composerDraftPersistence.legacy";

const encodeAssistantSelection = Schema.encodeSync(PersistedAssistantSelectionDraft);
const encodeFileComment = Schema.encodeSync(PersistedFileCommentDraft);
const encodePastedText = Schema.encodeSync(PersistedPastedTextDraft);
const encodePullRequestContext = Schema.encodeSync(PersistedPullRequestContextDraft);
const encodeTerminalContext = Schema.encodeSync(PersistedTerminalContextDraft);
const encodeQueuedTerminalContext = Schema.encodeSync(PersistedQueuedTerminalContextDraft);

export function migratePersistedComposerDraftStoreState(
  persistedState: unknown,
): PersistedComposerDraftStoreState {
  return normalizeCurrentPersistedComposerDraftStoreState(persistedState);
}

export function partializeComposerDraftStoreState(
  state: ComposerDraftStoreState,
): PersistedComposerDraftStoreState {
  const persistedDraftsByThreadId: DeepMutable<
    PersistedComposerDraftStoreState["draftsByThreadId"]
  > = {};
  for (const [threadId, draft] of Object.entries(state.draftsByThreadId)) {
    if (typeof threadId !== "string" || threadId.length === 0) {
      continue;
    }
    const persistedQueuedTurns: DeepMutable<
      NonNullable<PersistedComposerThreadDraftState["queuedTurns"]>
    > = [];
    for (const queuedTurn of draft.queuedTurns) {
      if (queuedTurn.kind === "chat") {
        if (queuedTurn.files.length > 0) {
          continue;
        }
        const images = persistQueuedComposerImages(queuedTurn.images);
        if (images.length !== queuedTurn.images.length) {
          continue;
        }
        persistedQueuedTurns.push({
          id: queuedTurn.id,
          kind: "chat",
          createdAt: queuedTurn.createdAt,
          previewText: queuedTurn.previewText,
          prompt: queuedTurn.prompt,
          images,
          assistantSelections: queuedTurn.assistantSelections.map((value) =>
            encodeAssistantSelection(value),
          ),
          terminalContexts: queuedTurn.terminalContexts.map((value) =>
            encodeQueuedTerminalContext(value),
          ),
          ...(queuedTurn.fileComments.length > 0
            ? {
                fileComments: queuedTurn.fileComments.map((value) => encodeFileComment(value)),
              }
            : {}),
          ...(queuedTurn.pastedTexts.length > 0
            ? {
                pastedTexts: queuedTurn.pastedTexts.map((value) => encodePastedText(value)),
              }
            : {}),
          ...(queuedTurn.pullRequestContexts.length > 0
            ? {
                pullRequestContexts: queuedTurn.pullRequestContexts.map((value) =>
                  encodePullRequestContext(value),
                ),
              }
            : {}),
          skills: [...queuedTurn.skills],
          mentions: [...queuedTurn.mentions],
          selectedProvider: queuedTurn.selectedProvider,
          selectedModel: queuedTurn.selectedModel,
          selectedPromptEffort: queuedTurn.selectedPromptEffort,
          modelSelection: queuedTurn.modelSelection,
          ...(queuedTurn.providerOptionsForDispatch
            ? { providerOptionsForDispatch: queuedTurn.providerOptionsForDispatch }
            : {}),

          runtimeMode: queuedTurn.runtimeMode,

          envMode: queuedTurn.envMode,
        });
        continue;
      }
    }
    const hasModelData =
      Object.keys(draft.modelSelectionByProvider).length > 0 || draft.activeProvider !== null;
    const hasQueuedTurns = persistedQueuedTurns.length > 0;
    const hasReferenceData = draft.skills.length > 0 || draft.mentions.length > 0;
    if (
      Object.keys(draft.pendingUserInputDrafts ?? {}).length === 0 &&
      draft.prompt.length === 0 &&
      draft.promptHistorySavedDraft === null &&
      draft.persistedAttachments.length === 0 &&
      draft.assistantSelections.length === 0 &&
      draft.terminalContexts.length === 0 &&
      draft.fileComments.length === 0 &&
      draft.pastedTexts.length === 0 &&
      draft.pullRequestContexts.length === 0 &&
      !hasReferenceData &&
      !hasQueuedTurns &&
      !hasModelData &&
      draft.runtimeMode === null
    ) {
      continue;
    }
    const persistedDraft: DeepMutable<PersistedComposerThreadDraftState> = {
      ...(Object.keys(draft.pendingUserInputDrafts ?? {}).length > 0
        ? { pendingUserInputDrafts: draft.pendingUserInputDrafts }
        : {}),
      prompt: draft.prompt,
      ...(draft.promptHistorySavedDraft !== null
        ? {
            promptHistorySavedDraft: {
              prompt: draft.promptHistorySavedDraft.prompt,
              attachments: draft.promptHistorySavedDraft.persistedAttachments.map(
                toStorageSafePersistedAttachment,
              ),
              ...(draft.promptHistorySavedDraft.assistantSelections.length > 0
                ? {
                    assistantSelections: draft.promptHistorySavedDraft.assistantSelections.map(
                      (value) => encodeAssistantSelection(value),
                    ),
                  }
                : {}),
              ...(draft.promptHistorySavedDraft.terminalContexts.length > 0
                ? {
                    terminalContexts: draft.promptHistorySavedDraft.terminalContexts.map((value) =>
                      encodeTerminalContext(value),
                    ),
                  }
                : {}),
              ...(draft.promptHistorySavedDraft.fileComments.length > 0
                ? {
                    fileComments: draft.promptHistorySavedDraft.fileComments.map((value) =>
                      encodeFileComment(value),
                    ),
                  }
                : {}),
              ...(draft.promptHistorySavedDraft.pastedTexts.length > 0
                ? {
                    pastedTexts: draft.promptHistorySavedDraft.pastedTexts.map((value) =>
                      encodePastedText(value),
                    ),
                  }
                : {}),
              ...(draft.promptHistorySavedDraft.pullRequestContexts.length > 0
                ? {
                    pullRequestContexts: draft.promptHistorySavedDraft.pullRequestContexts.map(
                      (value) => encodePullRequestContext(value),
                    ),
                  }
                : {}),
              ...(draft.promptHistorySavedDraft.skills.length > 0
                ? { skills: [...draft.promptHistorySavedDraft.skills] }
                : {}),
              ...(draft.promptHistorySavedDraft.mentions.length > 0
                ? { mentions: [...draft.promptHistorySavedDraft.mentions] }
                : {}),
            },
          }
        : {}),
      attachments: draft.persistedAttachments.map(toStorageSafePersistedAttachment),
      ...(draft.assistantSelections.length > 0
        ? {
            assistantSelections: draft.assistantSelections.map((value) =>
              encodeAssistantSelection(value),
            ),
          }
        : {}),
      ...(draft.terminalContexts.length > 0
        ? {
            terminalContexts: draft.terminalContexts.map((value) => encodeTerminalContext(value)),
          }
        : {}),
      ...(draft.fileComments.length > 0
        ? {
            fileComments: draft.fileComments.map((value) => encodeFileComment(value)),
          }
        : {}),
      ...(draft.pastedTexts.length > 0
        ? {
            pastedTexts: draft.pastedTexts.map((value) => encodePastedText(value)),
          }
        : {}),
      ...(draft.pullRequestContexts.length > 0
        ? {
            pullRequestContexts: draft.pullRequestContexts.map((value) =>
              encodePullRequestContext(value),
            ),
          }
        : {}),
      ...(draft.skills.length > 0 ? { skills: [...draft.skills] } : {}),
      ...(draft.mentions.length > 0 ? { mentions: [...draft.mentions] } : {}),
      ...(hasQueuedTurns ? { queuedTurns: persistedQueuedTurns } : {}),

      ...(hasModelData
        ? {
            modelSelectionByProvider: draft.modelSelectionByProvider,
            activeProvider: draft.activeProvider,
          }
        : {}),
      ...(draft.runtimeMode ? { runtimeMode: draft.runtimeMode } : {}),
    };
    persistedDraftsByThreadId[threadId as ThreadId] = persistedDraft;
  }
  return {
    draftsByThreadId: persistedDraftsByThreadId,
    draftThreadsByThreadId: state.draftThreadsByThreadId,
    projectDraftThreadIdByProjectId: state.projectDraftThreadIdByProjectId,
    stickyModelSelectionByProvider: state.stickyModelSelectionByProvider,
    stickyActiveProvider: state.stickyActiveProvider,
  };
}

export function normalizeCurrentPersistedComposerDraftStoreState(
  persistedState: unknown,
): PersistedComposerDraftStoreState {
  if (!persistedState || typeof persistedState !== "object") {
    return EMPTY_PERSISTED_DRAFT_STORE_STATE;
  }
  const normalizedPersistedState = persistedState as LegacyPersistedComposerDraftStoreState;
  const { draftThreadsByThreadId, projectDraftThreadIdByProjectId } =
    normalizePersistedDraftThreads(
      normalizedPersistedState.draftThreadsByThreadId,
      normalizedPersistedState.projectDraftThreadIdByProjectId,
    );

  let stickyModelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>> = {};
  let stickyActiveProvider: ProviderKind | null = null;
  if (
    normalizedPersistedState.stickyModelSelectionByProvider &&
    typeof normalizedPersistedState.stickyModelSelectionByProvider === "object"
  ) {
    stickyModelSelectionByProvider = normalizePersistedModelSelectionMap(
      normalizedPersistedState.stickyModelSelectionByProvider,
    );
    stickyActiveProvider = normalizeProviderKind(normalizedPersistedState.stickyActiveProvider);
  } else {
    const stickyModelOptions =
      normalizeProviderModelOptions(normalizedPersistedState.stickyModelOptions) ?? {};
    const normalizedStickyModelSelection = normalizeModelSelection(
      normalizedPersistedState.stickyModelSelection,
      {
        provider: normalizedPersistedState.stickyProvider ?? "codex",
        model: normalizedPersistedState.stickyModel,
        modelOptions: stickyModelOptions,
      },
    );
    const nextStickyModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
      normalizedStickyModelSelection,
      stickyModelOptions,
    );
    const stickyModelSelection = legacySyncModelSelectionOptions(
      normalizedStickyModelSelection,
      nextStickyModelOptions,
    );
    stickyModelSelectionByProvider = legacyToModelSelectionByProvider(
      stickyModelSelection,
      nextStickyModelOptions,
    );
    stickyActiveProvider = normalizeProviderKind(normalizedPersistedState.stickyProvider);
  }

  return {
    draftsByThreadId: normalizePersistedDraftsByThreadId(normalizedPersistedState.draftsByThreadId),
    draftThreadsByThreadId,
    projectDraftThreadIdByProjectId,
    stickyModelSelectionByProvider: sanitizeStickyModelSelectionMap(stickyModelSelectionByProvider),
    stickyActiveProvider,
  };
}
