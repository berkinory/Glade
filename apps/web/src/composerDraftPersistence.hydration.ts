import { normalizePendingUserInputDrafts } from "./pendingUserInputRecovery";
import { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import { hydrateImagesFromPersisted } from "./composerDraftAttachments";
import {
  hydratePastedTextsFromPersisted,
  normalizeAssistantSelections,
  normalizeFileComments,
  normalizeTerminalContextsForThread,
  type ComposerPromptHistorySavedDraft,
  type ComposerThreadDraftState,
  type QueuedComposerTurn,
} from "./composerDraftDomain";
import { normalizeProviderKind } from "./composerDraftModels";
import { normalizeBrowserAnnotations } from "./lib/browserAnnotations";
import { normalizePullRequestContexts } from "./lib/pullRequestContext";
import type {
  PersistedComposerPromptHistorySavedDraft,
  PersistedComposerThreadDraftState,
  PersistedQueuedComposerTurn,
} from "./composerDraftPersistence.types";

function hydrateQueuedTurnsFromPersisted(
  threadId: ThreadId,
  queuedTurns: ReadonlyArray<PersistedQueuedComposerTurn> | undefined,
): QueuedComposerTurn[] {
  if (!queuedTurns || queuedTurns.length === 0) {
    return [];
  }
  return queuedTurns.map((queuedTurn) => {
    if (queuedTurn.kind === "chat") {
      return {
        ...queuedTurn,
        images: hydrateImagesFromPersisted(queuedTurn.images),
        files: [],
        assistantSelections: normalizeAssistantSelections(queuedTurn.assistantSelections ?? []),
        browserAnnotations: normalizeBrowserAnnotations(queuedTurn.browserAnnotations ?? []),
        terminalContexts: normalizeTerminalContextsForThread(threadId, queuedTurn.terminalContexts),
        fileComments: normalizeFileComments(queuedTurn.fileComments ?? []),
        pastedTexts: hydratePastedTextsFromPersisted(queuedTurn.pastedTexts),
        pullRequestContexts: normalizePullRequestContexts(queuedTurn.pullRequestContexts ?? []),
        skills: [...queuedTurn.skills],
        mentions: [...queuedTurn.mentions],
      };
    }
    return { ...queuedTurn };
  });
}

function hydratePromptHistorySavedDraft(
  savedDraft: PersistedComposerPromptHistorySavedDraft | undefined,
): ComposerPromptHistorySavedDraft | null {
  if (savedDraft === undefined) {
    return null;
  }
  if (typeof savedDraft === "string") {
    return {
      prompt: savedDraft,
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
    };
  }
  const attachments = savedDraft.attachments ?? [];
  return {
    prompt: savedDraft.prompt,
    images: hydrateImagesFromPersisted(attachments),
    files: [],
    nonPersistedImageIds: [],
    persistedAttachments: [...attachments],
    assistantSelections: normalizeAssistantSelections(savedDraft.assistantSelections ?? []),
    browserAnnotations: normalizeBrowserAnnotations(savedDraft.browserAnnotations ?? []),
    terminalContexts:
      savedDraft.terminalContexts?.map((context) => ({
        ...context,
        text: "",
      })) ?? [],
    fileComments: normalizeFileComments(savedDraft.fileComments ?? []),
    pastedTexts: hydratePastedTextsFromPersisted(savedDraft.pastedTexts),
    pullRequestContexts: normalizePullRequestContexts(savedDraft.pullRequestContexts ?? []),
    skills: [...(savedDraft.skills ?? [])],
    mentions: [...(savedDraft.mentions ?? [])],
  };
}

export function toHydratedThreadDraft(
  threadId: ThreadId,
  persistedDraft: PersistedComposerThreadDraftState,
): ComposerThreadDraftState {
  const modelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>> =
    persistedDraft.modelSelectionByProvider ?? {};
  const activeProvider = normalizeProviderKind(persistedDraft.activeProvider) ?? null;

  return {
    ...(persistedDraft.pendingUserInputDrafts
      ? {
          pendingUserInputDrafts: normalizePendingUserInputDrafts(
            persistedDraft.pendingUserInputDrafts,
          ),
        }
      : {}),
    prompt: persistedDraft.prompt,
    promptHistorySavedDraft: hydratePromptHistorySavedDraft(persistedDraft.promptHistorySavedDraft),
    images: hydrateImagesFromPersisted(persistedDraft.attachments),
    files: [],
    nonPersistedImageIds: [],
    persistedAttachments: [...persistedDraft.attachments],
    assistantSelections: normalizeAssistantSelections(persistedDraft.assistantSelections ?? []),
    browserAnnotations: normalizeBrowserAnnotations(persistedDraft.browserAnnotations ?? []),
    terminalContexts:
      persistedDraft.terminalContexts?.map((context) => ({
        ...context,
        text: "",
      })) ?? [],
    fileComments: normalizeFileComments(persistedDraft.fileComments ?? []),
    pastedTexts: hydratePastedTextsFromPersisted(persistedDraft.pastedTexts),
    pullRequestContexts: normalizePullRequestContexts(persistedDraft.pullRequestContexts ?? []),
    skills: [...(persistedDraft.skills ?? [])],
    mentions: [...(persistedDraft.mentions ?? [])],
    queuedTurns: hydrateQueuedTurnsFromPersisted(threadId, persistedDraft.queuedTurns),
    restoredSourceProposedPlan: persistedDraft.restoredSourceProposedPlan ?? null,
    modelSelectionByProvider,
    activeProvider,
    runtimeMode: persistedDraft.runtimeMode ?? null,
    interactionMode: persistedDraft.interactionMode ?? null,
    computerControlMode: persistedDraft.computerControlMode,
    computerControlGeneration: persistedDraft.computerControlGeneration,
    enableComputerControl:
      typeof persistedDraft.enableComputerControl === "boolean"
        ? persistedDraft.enableComputerControl
        : undefined,
  };
}
