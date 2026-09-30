import { PROVIDER_DEFAULT_MODEL } from "@glade/contracts/provider/model";
import type { StateCreator } from "zustand";
import type { ComposerDraftStoreState } from "./composerDraftDomain";
import {
  type ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
} from "@glade/contracts/provider/sessionPolicy";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { normalizeModelSlug } from "@glade/shared/provider/model";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { normalizePullRequestContexts } from "./lib/pullRequestContext";
import {
  PROMPT_HISTORY_ATTACHMENT_SLOT,
  deletePersistedComposerImageBlobs,
  mergeComposerImages,
  revokeObjectPreviewUrl,
  revokePromptHistorySavedDraftPreviewUrls,
  syncPersistedAttachmentsForSlot,
} from "./composerDraftAttachments";
import {
  type ComposerThreadDraftState,
  createEmptyThreadDraft,
  normalizeAssistantSelections,
  normalizeFileComments,
  normalizePastedTexts,
  normalizeTerminalContextsForThread,
  shouldRemoveDraft,
  putComposerDraft,
} from "./composerDraftDomain";
import {
  COMPOSER_PROVIDER_KINDS,
  makeModelSelection,
  normalizeModelSelection,
  normalizeProviderKind,
  normalizeProviderModelOptions,
  reconcileProviderScopedModelSelection,
  stripNonStickyModelOptions,
} from "./composerDraftModels";
import { normalizeBrowserAnnotations } from "./lib/browserAnnotations";
import { ensureInlineTerminalContextPlaceholders } from "./lib/terminalContext";
import {
  availableComposerAttachmentSlots,
  composerImageConsumesAttachmentSlot,
} from "./lib/composerAttachmentCapacity";
import { buildModelSelection } from "./providerModelOptions";

type DraftSet = Parameters<StateCreator<ComposerDraftStoreState>>[0];
type DraftGet = Parameters<StateCreator<ComposerDraftStoreState>>[1];

export function createPromptAndModelsActions(
  set: DraftSet,
  get: DraftGet,
  flushPersistStorage: () => void,
): Pick<
  ComposerDraftStoreState,
  | "setStickyModelSelection"
  | "applyStickyState"
  | "setPendingUserInputDrafts"
  | "setPrompt"
  | "setPromptHistorySavedDraft"
  | "restorePromptHistorySavedDraft"
  | "addPromptHistorySavedDraftImage"
  | "syncPromptHistorySavedDraftPersistedAttachments"
  | "setTerminalContexts"
  | "setSkills"
  | "setMentions"
  | "setModelSelection"
  | "setModelSelectionAndSticky"
  | "setModelOptions"
  | "setProviderModelOptions"
  | "setRuntimeMode"
  | "setInteractionMode"
  | "setComputerControlMode"
  | "setEnableComputerControl"
> {
  return {
    setStickyModelSelection: (modelSelection) => {
      const rawNormalized = normalizeModelSelection(modelSelection);
      const normalized = rawNormalized ? stripNonStickyModelOptions(rawNormalized) : null;
      set((state) => {
        if (!normalized) {
          return state;
        }
        const nextMap: Partial<Record<ProviderKind, ModelSelection>> = {
          ...state.stickyModelSelectionByProvider,
          [normalized.provider]: normalized,
        };
        if (Equal.equals(state.stickyModelSelectionByProvider, nextMap)) {
          return state.stickyActiveProvider === normalized.provider
            ? state
            : { stickyActiveProvider: normalized.provider };
        }
        return {
          stickyModelSelectionByProvider: nextMap,
          stickyActiveProvider: normalized.provider,
        };
      });
    },
    applyStickyState: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const stickyMap = state.stickyModelSelectionByProvider;
        const stickyActiveProvider = state.stickyActiveProvider;
        if (Object.keys(stickyMap).length === 0 && stickyActiveProvider === null) {
          return state;
        }
        const existing = state.draftsByThreadId[threadId];
        const base = existing ?? createEmptyThreadDraft();
        const nextMap = { ...base.modelSelectionByProvider };
        for (const [provider, selection] of Object.entries(stickyMap)) {
          if (selection) {
            const current = nextMap[provider as ProviderKind];
            nextMap[provider as ProviderKind] =
              current && current.model !== selection.model ? current : selection;
          }
        }
        if (
          Equal.equals(base.modelSelectionByProvider, nextMap) &&
          base.activeProvider === stickyActiveProvider
        ) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...base,
          modelSelectionByProvider: nextMap,
          activeProvider: stickyActiveProvider,
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    setPendingUserInputDrafts: (threadId, drafts) => {
      set((state) => {
        const nextDraft = {
          ...(state.draftsByThreadId[threadId] ?? createEmptyThreadDraft()),
          pendingUserInputDrafts: drafts,
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    setPrompt: (threadId, prompt) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const nextDraft: ComposerThreadDraftState = {
          ...existing,
          prompt,
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    setPromptHistorySavedDraft: (threadId, savedDraft) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftsByThreadId[threadId];
        if ((existing?.promptHistorySavedDraft ?? null) === savedDraft) {
          return state;
        }
        if (existing?.promptHistorySavedDraft) {
          revokePromptHistorySavedDraftPreviewUrls(existing?.promptHistorySavedDraft);
          if (savedDraft === null) {
            deletePersistedComposerImageBlobs(
              existing.promptHistorySavedDraft.persistedAttachments,
              () => get().draftsByThreadId,
            );
          }
        }
        const nextDraft: ComposerThreadDraftState = {
          ...(existing ?? createEmptyThreadDraft()),
          promptHistorySavedDraft: savedDraft,
          ...(savedDraft !== null
            ? {
                images: [],
                files: [],
                nonPersistedImageIds: [],
                persistedAttachments: [],
                assistantSelections: [],
                browserAnnotations: [],
                terminalContexts: [],
                fileComments: [],
                pastedTexts: [],
                pullRequestContexts: [],
                skills: [],
                mentions: [],
              }
            : {}),
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    restorePromptHistorySavedDraft: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        const savedDraft = current?.promptHistorySavedDraft ?? null;
        if (!current || !savedDraft) {
          return state;
        }
        const restoredImageIds = new Set(savedDraft.images.map((image) => image.id));
        for (const image of current.images) {
          if (!restoredImageIds.has(image.id)) {
            revokeObjectPreviewUrl(image.previewUrl);
          }
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          prompt: savedDraft.prompt,
          promptHistorySavedDraft: null,
          images: savedDraft.images,
          files: [...savedDraft.files],
          nonPersistedImageIds: [...savedDraft.nonPersistedImageIds],
          persistedAttachments: [...savedDraft.persistedAttachments],
          assistantSelections: normalizeAssistantSelections(savedDraft.assistantSelections),
          browserAnnotations: normalizeBrowserAnnotations(savedDraft.browserAnnotations),
          terminalContexts: normalizeTerminalContextsForThread(
            threadId,
            savedDraft.terminalContexts,
          ),
          fileComments: normalizeFileComments(savedDraft.fileComments),
          pastedTexts: normalizePastedTexts(savedDraft.pastedTexts),
          pullRequestContexts: normalizePullRequestContexts(savedDraft.pullRequestContexts),
          skills: [...savedDraft.skills],
          mentions: [...savedDraft.mentions],
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    addPromptHistorySavedDraftImage: (threadId, image) => {
      if (threadId.length === 0) {
        revokeObjectPreviewUrl(image.previewUrl);
        return false;
      }
      let inserted = false;
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        const savedDraft = current?.promptHistorySavedDraft ?? null;
        if (!current || !savedDraft) {
          revokeObjectPreviewUrl(image.previewUrl);
          return state;
        }
        const consumesSlot = composerImageConsumesAttachmentSlot(savedDraft, image.id);
        if (consumesSlot && availableComposerAttachmentSlots(savedDraft) === 0) {
          revokeObjectPreviewUrl(image.previewUrl);
          return state;
        }
        const images = mergeComposerImages(savedDraft.images, [image]);
        if (!images) return state;
        inserted = true;
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...current,
              promptHistorySavedDraft: {
                ...savedDraft,
                images,
              },
            },
          },
        };
      });
      return inserted;
    },
    syncPromptHistorySavedDraftPersistedAttachments: (threadId, attachments) =>
      syncPersistedAttachmentsForSlot(
        threadId,
        attachments,
        get,
        set,
        PROMPT_HISTORY_ATTACHMENT_SLOT,
        flushPersistStorage,
      ),
    setTerminalContexts: (threadId, contexts) => {
      if (threadId.length === 0) {
        return;
      }
      const normalizedContexts = normalizeTerminalContextsForThread(threadId, contexts);
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const nextDraft: ComposerThreadDraftState = {
          ...existing,
          prompt: ensureInlineTerminalContextPlaceholders(
            existing.prompt,
            normalizedContexts.length,
          ),
          terminalContexts: normalizedContexts,
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    setSkills: (threadId, skills) => {
      if (threadId.length === 0) {
        return;
      }
      const nextSkills = [...skills];
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        if (Equal.equals(existing.skills, nextSkills)) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...existing,
          skills: nextSkills,
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    setMentions: (threadId, mentions) => {
      if (threadId.length === 0) {
        return;
      }
      const nextMentions = [...mentions];
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        if (Equal.equals(existing.mentions, nextMentions)) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...existing,
          mentions: nextMentions,
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    setModelSelection: (threadId, modelSelection) => {
      if (threadId.length === 0) {
        return;
      }
      const normalized = normalizeModelSelection(modelSelection);
      set((state) => {
        const existing = state.draftsByThreadId[threadId];
        if (!existing && normalized === null) {
          return state;
        }
        const base = existing ?? createEmptyThreadDraft();
        const nextMap = { ...base.modelSelectionByProvider };
        if (normalized) {
          const current = nextMap[normalized.provider];
          nextMap[normalized.provider] = reconcileProviderScopedModelSelection(normalized, current);
        }
        const nextActiveProvider = normalized?.provider ?? base.activeProvider;
        if (
          Equal.equals(base.modelSelectionByProvider, nextMap) &&
          base.activeProvider === nextActiveProvider
        ) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...base,
          modelSelectionByProvider: nextMap,
          activeProvider: nextActiveProvider,
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    setModelSelectionAndSticky: (threadId, modelSelection) => {
      get().setModelSelection(threadId, modelSelection);
      const correctedSelection =
        get().draftsByThreadId[threadId]?.modelSelectionByProvider[modelSelection.provider];
      get().setStickyModelSelection(correctedSelection ?? modelSelection);
    },
    setModelOptions: (threadId, modelOptions) => {
      if (threadId.length === 0) {
        return;
      }
      const normalizedOpts = normalizeProviderModelOptions(modelOptions);
      set((state) => {
        const existing = state.draftsByThreadId[threadId];
        if (!existing && normalizedOpts === null) {
          return state;
        }
        const base = existing ?? createEmptyThreadDraft();
        const nextMap = { ...base.modelSelectionByProvider };
        for (const provider of COMPOSER_PROVIDER_KINDS) {
          if (!normalizedOpts || !(provider in normalizedOpts)) continue;
          const opts = normalizedOpts[provider];
          const current = nextMap[provider];
          if (opts) {
            const model = current?.model ?? PROVIDER_DEFAULT_MODEL;
            if (!model) continue;
            nextMap[provider] = makeModelSelection(
              provider,
              model,
              opts,
              current?.provider === "claudeAgent" ? current.supportsAutoMode : undefined,
            );
          } else if (current?.options) {
            nextMap[provider] = buildModelSelection(
              provider,
              current.model,
              undefined,
              current.provider === "claudeAgent" ? current.supportsAutoMode : undefined,
            );
          }
        }
        if (Equal.equals(base.modelSelectionByProvider, nextMap)) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...base,
          modelSelectionByProvider: nextMap,
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    setProviderModelOptions: (threadId, provider, nextProviderOptions, options) => {
      if (threadId.length === 0) {
        return;
      }
      const normalizedProvider = normalizeProviderKind(provider);
      if (normalizedProvider === null) {
        return;
      }

      const normalizedOpts = normalizeProviderModelOptions(
        { [normalizedProvider]: nextProviderOptions },
        normalizedProvider,
      );
      const providerOpts = normalizedOpts?.[normalizedProvider];
      const fallbackModel =
        normalizeModelSlug(options?.model, normalizedProvider) ?? PROVIDER_DEFAULT_MODEL;

      set((state) => {
        const existing = state.draftsByThreadId[threadId];
        const base = existing ?? createEmptyThreadDraft();

        const nextMap = { ...base.modelSelectionByProvider };
        const currentForProvider = nextMap[normalizedProvider];
        if (providerOpts) {
          const nextModel = currentForProvider?.model ?? fallbackModel;
          if (!nextModel) {
            return state;
          }
          nextMap[normalizedProvider] = makeModelSelection(
            normalizedProvider,
            nextModel,
            providerOpts,
            currentForProvider?.provider === "claudeAgent"
              ? currentForProvider.supportsAutoMode
              : undefined,
          );
        } else if (currentForProvider?.options) {
          nextMap[normalizedProvider] = buildModelSelection(
            normalizedProvider,
            currentForProvider.model,
            undefined,
            currentForProvider.provider === "claudeAgent"
              ? currentForProvider.supportsAutoMode
              : undefined,
          );
        }

        let nextStickyMap = state.stickyModelSelectionByProvider;
        let nextStickyActiveProvider = state.stickyActiveProvider;
        if (options?.persistSticky === true) {
          nextStickyMap = { ...state.stickyModelSelectionByProvider };
          const stickyBase =
            nextStickyMap[normalizedProvider] ??
            base.modelSelectionByProvider[normalizedProvider] ??
            (fallbackModel ? makeModelSelection(normalizedProvider, fallbackModel) : null);
          if (!stickyBase) {
            return state;
          }
          if (providerOpts) {
            nextStickyMap[normalizedProvider] = stripNonStickyModelOptions(
              makeModelSelection(
                normalizedProvider,
                stickyBase.model,
                providerOpts,
                stickyBase.provider === "claudeAgent" ? stickyBase.supportsAutoMode : undefined,
              ),
            );
          } else if (stickyBase.options) {
            nextStickyMap[normalizedProvider] = buildModelSelection(
              normalizedProvider,
              stickyBase.model,
              undefined,
              stickyBase.provider === "claudeAgent" ? stickyBase.supportsAutoMode : undefined,
            );
          }
          nextStickyActiveProvider = base.activeProvider ?? normalizedProvider;
        }

        if (
          Equal.equals(base.modelSelectionByProvider, nextMap) &&
          Equal.equals(state.stickyModelSelectionByProvider, nextStickyMap) &&
          state.stickyActiveProvider === nextStickyActiveProvider
        ) {
          return state;
        }

        const nextDraft: ComposerThreadDraftState = {
          ...base,
          modelSelectionByProvider: nextMap,
        };
        const nextDraftsByThreadId = { ...state.draftsByThreadId };
        if (shouldRemoveDraft(nextDraft)) {
          delete nextDraftsByThreadId[threadId];
        } else {
          nextDraftsByThreadId[threadId] = nextDraft;
        }

        return {
          draftsByThreadId: nextDraftsByThreadId,
          ...(options?.persistSticky === true
            ? {
                stickyModelSelectionByProvider: nextStickyMap,
                stickyActiveProvider: nextStickyActiveProvider,
              }
            : {}),
        };
      });
    },
    setRuntimeMode: (threadId, runtimeMode) => {
      if (threadId.length === 0) {
        return;
      }
      const nextRuntimeMode = Schema.is(RuntimeMode)(runtimeMode) ? runtimeMode : null;
      set((state) => {
        const existing = state.draftsByThreadId[threadId];
        if (!existing && nextRuntimeMode === null) {
          return state;
        }
        const base = existing ?? createEmptyThreadDraft();
        if (base.runtimeMode === nextRuntimeMode) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...base,
          runtimeMode: nextRuntimeMode,
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    setInteractionMode: (threadId, interactionMode) => {
      if (threadId.length === 0) {
        return;
      }
      const nextInteractionMode =
        interactionMode !== null &&
        interactionMode !== undefined &&
        Schema.is(ProviderInteractionMode)(interactionMode)
          ? interactionMode
          : null;
      set((state) => {
        const existing = state.draftsByThreadId[threadId];
        if (!existing && nextInteractionMode === null) {
          return state;
        }
        const base = existing ?? createEmptyThreadDraft();
        if (base.interactionMode === nextInteractionMode) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...base,
          interactionMode: nextInteractionMode,
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    setComputerControlMode: (threadId, mode, options) => {
      if (threadId.length === 0) return;

      set((state) => ({
        draftsByThreadId: {
          ...state.draftsByThreadId,
          [threadId]: {
            ...(state.draftsByThreadId[threadId] ?? createEmptyThreadDraft()),
            computerControlMode: mode,
            ...(options?.generation !== undefined
              ? { computerControlGeneration: options.generation }
              : {}),
            enableComputerControl: mode !== "off",
            ...(mode === "off" && options?.revokeQueued
              ? {
                  queuedTurns: (state.draftsByThreadId[threadId]?.queuedTurns ?? []).map(
                    (turn) => ({
                      ...turn,
                      computerControlMode: "off" as const,
                      enableComputerControl: false,
                    }),
                  ),
                }
              : {}),
          },
        },
      }));
    },
    setEnableComputerControl: (threadId, enabled) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const base = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        if (
          base.enableComputerControl === enabled &&
          base.computerControlMode === (enabled ? "chat" : "off")
        ) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...base,
          enableComputerControl: enabled,
          computerControlMode: enabled ? "chat" : "off",
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
  };
}
