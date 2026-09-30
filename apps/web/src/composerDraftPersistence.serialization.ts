import { resolveComputerControlMode } from "./computerControlMode";
import { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { DeepMutable } from "effect/Types";
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
  cloneBrowserAnnotation,
  normalizePersistedModelSelectionMap,
} from "./composerDraftPersistence.types";
import type {
  LegacyPersistedComposerDraftStoreState,
  PersistedComposerDraftStoreState,
  PersistedComposerThreadDraftState,
} from "./composerDraftPersistence.types";
import { toPersistedPullRequestContext } from "./composerDraftPersistence.values";
import {
  normalizePersistedDraftThreads,
  normalizePersistedDraftsByThreadId,
} from "./composerDraftPersistence.legacy";

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
          assistantSelections: queuedTurn.assistantSelections.map((selection) => ({
            id: selection.id,
            assistantMessageId: selection.assistantMessageId,
            text: selection.text,
          })),
          ...(queuedTurn.browserAnnotations.length > 0
            ? {
                browserAnnotations: queuedTurn.browserAnnotations.map(cloneBrowserAnnotation),
              }
            : {}),
          terminalContexts: queuedTurn.terminalContexts.map((context) => ({
            id: context.id,
            threadId: context.threadId,
            createdAt: context.createdAt,
            terminalId: context.terminalId,
            terminalLabel: context.terminalLabel,
            lineStart: context.lineStart,
            lineEnd: context.lineEnd,
            text: context.text,
          })),
          ...(queuedTurn.fileComments.length > 0
            ? {
                fileComments: queuedTurn.fileComments.map((comment) => ({
                  id: comment.id,
                  path: comment.path,
                  startLine: comment.startLine,
                  endLine: comment.endLine,
                  text: comment.text,
                })),
              }
            : {}),
          ...(queuedTurn.pastedTexts.length > 0
            ? {
                pastedTexts: queuedTurn.pastedTexts.map((pasted) => ({
                  id: pasted.id,
                  createdAt: pasted.createdAt,
                  text: pasted.text,
                })),
              }
            : {}),
          ...(queuedTurn.pullRequestContexts.length > 0
            ? {
                pullRequestContexts: queuedTurn.pullRequestContexts.map(
                  toPersistedPullRequestContext,
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
          enableComputerControl:
            resolveComputerControlMode(
              queuedTurn.computerControlMode,
              queuedTurn.enableComputerControl,
            ) !== "off",
          ...(queuedTurn.computerControlGeneration !== undefined
            ? { computerControlGeneration: queuedTurn.computerControlGeneration }
            : {}),
          computerControlMode: resolveComputerControlMode(
            queuedTurn.computerControlMode,
            queuedTurn.enableComputerControl,
          ),
          ...(queuedTurn.sourceProposedPlan
            ? { sourceProposedPlan: queuedTurn.sourceProposedPlan }
            : {}),
          runtimeMode: queuedTurn.runtimeMode,
          interactionMode: queuedTurn.interactionMode,
          envMode: queuedTurn.envMode,
        });
        continue;
      }
      persistedQueuedTurns.push({
        id: queuedTurn.id,
        kind: "plan-follow-up",
        createdAt: queuedTurn.createdAt,
        previewText: queuedTurn.previewText,
        text: queuedTurn.text,
        interactionMode: queuedTurn.interactionMode,
        selectedProvider: queuedTurn.selectedProvider,
        selectedModel: queuedTurn.selectedModel,
        selectedPromptEffort: queuedTurn.selectedPromptEffort,
        modelSelection: queuedTurn.modelSelection,
        ...(queuedTurn.providerOptionsForDispatch
          ? { providerOptionsForDispatch: queuedTurn.providerOptionsForDispatch }
          : {}),
        enableComputerControl:
          resolveComputerControlMode(
            queuedTurn.computerControlMode,
            queuedTurn.enableComputerControl,
          ) !== "off",
        ...(queuedTurn.computerControlGeneration !== undefined
          ? { computerControlGeneration: queuedTurn.computerControlGeneration }
          : {}),
        computerControlMode: resolveComputerControlMode(
          queuedTurn.computerControlMode,
          queuedTurn.enableComputerControl,
        ),
        runtimeMode: queuedTurn.runtimeMode,
      });
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
      draft.browserAnnotations.length === 0 &&
      draft.terminalContexts.length === 0 &&
      draft.fileComments.length === 0 &&
      draft.pastedTexts.length === 0 &&
      draft.pullRequestContexts.length === 0 &&
      !hasReferenceData &&
      !hasQueuedTurns &&
      draft.restoredSourceProposedPlan == null &&
      !hasModelData &&
      draft.runtimeMode === null &&
      draft.interactionMode === null &&
      draft.enableComputerControl === undefined &&
      draft.computerControlMode === undefined
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
                      (selection) => ({
                        id: selection.id,
                        assistantMessageId: selection.assistantMessageId,
                        text: selection.text,
                      }),
                    ),
                  }
                : {}),
              ...(draft.promptHistorySavedDraft.browserAnnotations.length > 0
                ? {
                    browserAnnotations:
                      draft.promptHistorySavedDraft.browserAnnotations.map(cloneBrowserAnnotation),
                  }
                : {}),
              ...(draft.promptHistorySavedDraft.terminalContexts.length > 0
                ? {
                    terminalContexts: draft.promptHistorySavedDraft.terminalContexts.map(
                      (context) => ({
                        id: context.id,
                        threadId: context.threadId,
                        createdAt: context.createdAt,
                        terminalId: context.terminalId,
                        terminalLabel: context.terminalLabel,
                        lineStart: context.lineStart,
                        lineEnd: context.lineEnd,
                      }),
                    ),
                  }
                : {}),
              ...(draft.promptHistorySavedDraft.fileComments.length > 0
                ? {
                    fileComments: draft.promptHistorySavedDraft.fileComments.map((comment) => ({
                      id: comment.id,
                      path: comment.path,
                      startLine: comment.startLine,
                      endLine: comment.endLine,
                      text: comment.text,
                    })),
                  }
                : {}),
              ...(draft.promptHistorySavedDraft.pastedTexts.length > 0
                ? {
                    pastedTexts: draft.promptHistorySavedDraft.pastedTexts.map((pasted) => ({
                      id: pasted.id,
                      createdAt: pasted.createdAt,
                      text: pasted.text,
                    })),
                  }
                : {}),
              ...(draft.promptHistorySavedDraft.pullRequestContexts.length > 0
                ? {
                    pullRequestContexts: draft.promptHistorySavedDraft.pullRequestContexts.map(
                      toPersistedPullRequestContext,
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
            assistantSelections: draft.assistantSelections.map((selection) => ({
              id: selection.id,
              assistantMessageId: selection.assistantMessageId,
              text: selection.text,
            })),
          }
        : {}),
      ...(draft.browserAnnotations.length > 0
        ? {
            browserAnnotations: draft.browserAnnotations.map(cloneBrowserAnnotation),
          }
        : {}),
      ...(draft.terminalContexts.length > 0
        ? {
            terminalContexts: draft.terminalContexts.map((context) => ({
              id: context.id,
              threadId: context.threadId,
              createdAt: context.createdAt,
              terminalId: context.terminalId,
              terminalLabel: context.terminalLabel,
              lineStart: context.lineStart,
              lineEnd: context.lineEnd,
            })),
          }
        : {}),
      ...(draft.fileComments.length > 0
        ? {
            fileComments: draft.fileComments.map((comment) => ({
              id: comment.id,
              path: comment.path,
              startLine: comment.startLine,
              endLine: comment.endLine,
              text: comment.text,
            })),
          }
        : {}),
      ...(draft.pastedTexts.length > 0
        ? {
            pastedTexts: draft.pastedTexts.map((pasted) => ({
              id: pasted.id,
              createdAt: pasted.createdAt,
              text: pasted.text,
            })),
          }
        : {}),
      ...(draft.pullRequestContexts.length > 0
        ? {
            pullRequestContexts: draft.pullRequestContexts.map(toPersistedPullRequestContext),
          }
        : {}),
      ...(draft.skills.length > 0 ? { skills: [...draft.skills] } : {}),
      ...(draft.mentions.length > 0 ? { mentions: [...draft.mentions] } : {}),
      ...(hasQueuedTurns ? { queuedTurns: persistedQueuedTurns } : {}),
      ...(draft.restoredSourceProposedPlan
        ? { restoredSourceProposedPlan: draft.restoredSourceProposedPlan }
        : {}),
      ...(hasModelData
        ? {
            modelSelectionByProvider: draft.modelSelectionByProvider,
            activeProvider: draft.activeProvider,
          }
        : {}),
      ...(draft.runtimeMode ? { runtimeMode: draft.runtimeMode } : {}),
      ...(draft.interactionMode ? { interactionMode: draft.interactionMode } : {}),
      ...(draft.computerControlGeneration !== undefined
        ? { computerControlGeneration: draft.computerControlGeneration }
        : {}),
      ...(draft.computerControlMode !== undefined
        ? { computerControlMode: draft.computerControlMode }
        : {}),
      ...(draft.enableComputerControl !== undefined
        ? { enableComputerControl: draft.enableComputerControl }
        : {}),
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
