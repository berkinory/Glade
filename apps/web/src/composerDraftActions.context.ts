import type { StateCreator } from "zustand";
import type { ComposerDraftStoreState } from "./composerDraftDomain";
import { normalizePullRequestContext, pullRequestContextDedupKey } from "./lib/pullRequestContext";
import {
  DRAFT_ATTACHMENT_SLOT,
  deletePersistedComposerImageBlobs,
  syncPersistedAttachmentsForSlot,
} from "./composerDraftAttachments";
import {
  type ComposerThreadDraftState,
  createEmptyThreadDraft,
  fileCommentDedupKey,
  normalizeFileComment,
  normalizePastedTexts,
  normalizeTerminalContextForThread,
  normalizeTerminalContextsForThread,
  putComposerDraft,
  terminalContextDedupKey,
} from "./composerDraftDomain";
import {
  BROWSER_ANNOTATION_MAX_COUNT,
  nextBrowserAnnotationOrdinal,
  normalizeBrowserAnnotation,
} from "./lib/browserAnnotations";
import { ensureInlineTerminalContextPlaceholders } from "./lib/terminalContext";

type DraftSet = Parameters<StateCreator<ComposerDraftStoreState>>[0];
type DraftGet = Parameters<StateCreator<ComposerDraftStoreState>>[1];

export function createContextActions(
  set: DraftSet,
  get: DraftGet,
  flushPersistStorage: () => void,
): Pick<
  ComposerDraftStoreState,
  | "addBrowserAnnotation"
  | "addBrowserAnnotations"
  | "removeBrowserAnnotation"
  | "clearBrowserAnnotations"
  | "addFileComment"
  | "removeFileComment"
  | "clearFileComments"
  | "addPastedTexts"
  | "removePastedText"
  | "clearPastedTexts"
  | "addPullRequestContext"
  | "removePullRequestContext"
  | "clearPullRequestContexts"
  | "insertTerminalContext"
  | "addTerminalContext"
  | "addTerminalContexts"
  | "removeTerminalContext"
  | "clearTerminalContexts"
  | "clearPersistedAttachments"
  | "syncPersistedAttachments"
> {
  return {
    addBrowserAnnotation: (threadId, annotation) => {
      if (threadId.length === 0) {
        return false;
      }
      let inserted = false;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        if (
          existing.browserAnnotations.length >= BROWSER_ANNOTATION_MAX_COUNT ||
          existing.browserAnnotations.some((entry) => entry.id === annotation.id)
        ) {
          return state;
        }
        const normalized = normalizeBrowserAnnotation({
          ...annotation,
          ordinal: nextBrowserAnnotationOrdinal(existing.browserAnnotations),
        });
        if (!normalized) {
          return state;
        }
        inserted = true;
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              browserAnnotations: [...existing.browserAnnotations, normalized],
            },
          },
        };
      });
      return inserted;
    },
    addBrowserAnnotations: (threadId, annotations) => {
      if (threadId.length === 0 || annotations.length === 0) {
        return 0;
      }
      let insertedCount = 0;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const nextAnnotations = [...existing.browserAnnotations];
        const ids = new Set(nextAnnotations.map((annotation) => annotation.id));
        const preserveBatchOrdinals = existing.browserAnnotations.length === 0;
        const ordinals = new Set(nextAnnotations.map((annotation) => annotation.ordinal));
        for (const annotation of annotations) {
          if (nextAnnotations.length >= BROWSER_ANNOTATION_MAX_COUNT) {
            break;
          }
          if (ids.has(annotation.id)) {
            continue;
          }
          const requestedOrdinal =
            preserveBatchOrdinals &&
            typeof annotation.ordinal === "number" &&
            Number.isFinite(annotation.ordinal) &&
            annotation.ordinal >= 1 &&
            !ordinals.has(Math.floor(annotation.ordinal))
              ? Math.floor(annotation.ordinal)
              : nextBrowserAnnotationOrdinal(nextAnnotations);
          const normalized = normalizeBrowserAnnotation({
            ...annotation,
            ordinal: requestedOrdinal,
          });
          if (!normalized) {
            continue;
          }
          nextAnnotations.push(normalized);
          ids.add(normalized.id);
          ordinals.add(normalized.ordinal);
          insertedCount += 1;
        }
        if (insertedCount === 0) {
          return state;
        }
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              browserAnnotations: nextAnnotations,
            },
          },
        };
      });
      return insertedCount;
    },
    removeBrowserAnnotation: (threadId, annotationId) => {
      if (threadId.length === 0 || annotationId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.browserAnnotations.every((entry) => entry.id !== annotationId)) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          browserAnnotations: current.browserAnnotations.filter(
            (annotation) => annotation.id !== annotationId,
          ),
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    clearBrowserAnnotations: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.browserAnnotations.length === 0) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          browserAnnotations: [],
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    addFileComment: (threadId, comment) => {
      if (threadId.length === 0) {
        return false;
      }
      let inserted = false;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const normalizedComment = normalizeFileComment(comment);
        if (!normalizedComment) {
          return state;
        }
        const dedupKey = fileCommentDedupKey(normalizedComment);
        if (
          existing.fileComments.some((entry) => entry.id === normalizedComment.id) ||
          existing.fileComments.some((entry) => fileCommentDedupKey(entry) === dedupKey)
        ) {
          return state;
        }
        inserted = true;
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              fileComments: [...existing.fileComments, normalizedComment],
            },
          },
        };
      });
      return inserted;
    },
    removeFileComment: (threadId, commentId) => {
      if (threadId.length === 0 || commentId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          fileComments: current.fileComments.filter((comment) => comment.id !== commentId),
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    clearFileComments: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.fileComments.length === 0) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          fileComments: [],
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    addPastedTexts: (threadId, pastedTexts) => {
      if (threadId.length === 0 || pastedTexts.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const acceptedPastedTexts = normalizePastedTexts([
          ...existing.pastedTexts,
          ...pastedTexts,
        ]).slice(existing.pastedTexts.length);
        if (acceptedPastedTexts.length === 0) {
          return state;
        }
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              pastedTexts: [...existing.pastedTexts, ...acceptedPastedTexts],
            },
          },
        };
      });
    },
    removePastedText: (threadId, pastedTextId) => {
      if (threadId.length === 0 || pastedTextId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          pastedTexts: current.pastedTexts.filter((pasted) => pasted.id !== pastedTextId),
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    clearPastedTexts: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.pastedTexts.length === 0) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          pastedTexts: [],
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    addPullRequestContext: (threadId, context) => {
      if (threadId.length === 0) {
        return false;
      }
      const normalized = normalizePullRequestContext(context);
      if (!normalized) {
        return false;
      }
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();

        const dedupKey = pullRequestContextDedupKey(normalized);
        const kept = existing.pullRequestContexts.filter(
          (entry) => pullRequestContextDedupKey(entry) !== dedupKey && entry.id !== normalized.id,
        );
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              pullRequestContexts: [...kept, normalized],
            },
          },
        };
      });
      return true;
    },
    removePullRequestContext: (threadId, contextId) => {
      if (threadId.length === 0 || contextId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          pullRequestContexts: current.pullRequestContexts.filter(
            (entry) => entry.id !== contextId,
          ),
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    clearPullRequestContexts: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.pullRequestContexts.length === 0) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          pullRequestContexts: [],
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    insertTerminalContext: (threadId, prompt, context, index) => {
      if (threadId.length === 0) {
        return false;
      }
      let inserted = false;
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const normalizedContext = normalizeTerminalContextForThread(threadId, context);
        if (!normalizedContext) {
          return state;
        }
        const dedupKey = terminalContextDedupKey(normalizedContext);
        if (
          existing.terminalContexts.some((entry) => entry.id === normalizedContext.id) ||
          existing.terminalContexts.some((entry) => terminalContextDedupKey(entry) === dedupKey)
        ) {
          return state;
        }
        inserted = true;
        const boundedIndex = Math.max(0, Math.min(existing.terminalContexts.length, index));
        const nextDraft: ComposerThreadDraftState = {
          ...existing,
          prompt,
          terminalContexts: [
            ...existing.terminalContexts.slice(0, boundedIndex),
            normalizedContext,
            ...existing.terminalContexts.slice(boundedIndex),
          ],
        };
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: nextDraft,
          },
        };
      });
      return inserted;
    },
    addTerminalContext: (threadId, context) => {
      if (threadId.length === 0) {
        return;
      }
      get().addTerminalContexts(threadId, [context]);
    },
    addTerminalContexts: (threadId, contexts) => {
      if (threadId.length === 0 || contexts.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
        const acceptedContexts = normalizeTerminalContextsForThread(threadId, [
          ...existing.terminalContexts,
          ...contexts,
        ]).slice(existing.terminalContexts.length);
        if (acceptedContexts.length === 0) {
          return state;
        }
        return {
          draftsByThreadId: {
            ...state.draftsByThreadId,
            [threadId]: {
              ...existing,
              prompt: ensureInlineTerminalContextPlaceholders(
                existing.prompt,
                existing.terminalContexts.length + acceptedContexts.length,
              ),
              terminalContexts: [...existing.terminalContexts, ...acceptedContexts],
            },
          },
        };
      });
    },
    removeTerminalContext: (threadId, contextId) => {
      if (threadId.length === 0 || contextId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          terminalContexts: current.terminalContexts.filter((context) => context.id !== contextId),
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    clearTerminalContexts: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current || current.terminalContexts.length === 0) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          terminalContexts: [],
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    clearPersistedAttachments: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      const existing = get().draftsByThreadId[threadId];
      if (existing) {
        deletePersistedComposerImageBlobs(
          existing.persistedAttachments,
          () => get().draftsByThreadId,
        );
      }
      set((state) => {
        const current = state.draftsByThreadId[threadId];
        if (!current) {
          return state;
        }
        const nextDraft: ComposerThreadDraftState = {
          ...current,
          persistedAttachments: [],
          nonPersistedImageIds: [],
        };
        return putComposerDraft(state, threadId, nextDraft);
      });
    },
    syncPersistedAttachments: (threadId, attachments) =>
      syncPersistedAttachmentsForSlot(
        threadId,
        attachments,
        get,
        set,
        DRAFT_ATTACHMENT_SLOT,
        flushPersistStorage,
      ),
  };
}
