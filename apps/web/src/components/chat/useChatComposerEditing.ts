import { useChatThreadContext } from "./ChatThreadContext";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import { formatComposerMentionToken } from "~/lib/composerMentions";
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  type ComposerTrigger,
} from "../../composer-logic";
import {
  composerFolderMention,
  replaceComposerPromptRange,
  replaceComposerTrigger,
} from "../../composerEditing.logic";
import { setPendingUserInputCustomAnswer } from "../../pendingUserInput";
import { useChatComposerDraft } from "./useChatComposerDraft";
import { useChatPendingInteractions } from "./useChatPendingInteractions";

interface ChatComposerEditingInput {
  threadId: ThreadId;
  promptRef: ReturnType<typeof useChatComposerDraft>["promptRef"];
  activePendingProgress: ReturnType<typeof useChatPendingInteractions>["activePendingProgress"];
  activePendingUserInputKey: ReturnType<
    typeof useChatPendingInteractions
  >["activePendingUserInputKey"];
  pendingUserInputAnswersByRequestIdRef: ReturnType<
    typeof useChatPendingInteractions
  >["pendingUserInputAnswersByRequestIdRef"];
  setPendingUserInputAnswersByRequestId: ReturnType<
    typeof useChatPendingInteractions
  >["setPendingUserInputAnswersByRequestId"];
  setPrompt: ReturnType<typeof useChatComposerDraft>["setPrompt"];
  setComposerCursor: ReturnType<typeof useChatComposerDraft>["setComposerCursor"];
  setComposerTrigger: ReturnType<typeof useChatComposerDraft>["setComposerTrigger"];
  composerEditorRef: ReturnType<typeof useChatComposerDraft>["composerEditorRef"];
  composerCursor: ReturnType<typeof useChatComposerDraft>["composerCursor"];
  composerTerminalContexts: ReturnType<typeof useChatComposerDraft>["composerTerminalContexts"];
  setComposerHighlightedItemId: Dispatch<SetStateAction<string | null>>;
  setRestoredQueuedSourceProposedPlan: ReturnType<
    typeof useChatComposerDraft
  >["setRestoredQueuedSourceProposedPlan"];
  clearComposerDraftContent: ReturnType<typeof useChatComposerDraft>["clearComposerDraftContent"];
  scheduleComposerFocus: () => void;
}

type ChatComposerEditingControllerInput = {
  session: Pick<
    ChatComposerEditingInput,
    | "promptRef"
    | "setPrompt"
    | "setComposerCursor"
    | "setComposerTrigger"
    | "composerEditorRef"
    | "composerCursor"
    | "composerTerminalContexts"
    | "setComposerHighlightedItemId"
    | "setRestoredQueuedSourceProposedPlan"
    | "clearComposerDraftContent"
  >;
  provider: Pick<
    ChatComposerEditingInput,
    | "activePendingProgress"
    | "activePendingUserInputKey"
    | "pendingUserInputAnswersByRequestIdRef"
    | "setPendingUserInputAnswersByRequestId"
  >;
  composer: Pick<ChatComposerEditingInput, "scheduleComposerFocus">;
};
export function useChatComposerEditing({
  session,
  provider,
  composer,
}: ChatComposerEditingControllerInput) {
  const { threadId } = useChatThreadContext();
  const {
    promptRef,
    setPrompt,
    setComposerCursor,
    setComposerTrigger,
    composerEditorRef,
    composerCursor,
    composerTerminalContexts,
    setComposerHighlightedItemId,
    setRestoredQueuedSourceProposedPlan,
    clearComposerDraftContent,
  } = session;
  const {
    activePendingProgress,
    activePendingUserInputKey,
    pendingUserInputAnswersByRequestIdRef,
    setPendingUserInputAnswersByRequestId,
  } = provider;
  const { scheduleComposerFocus } = composer;
  const applyPromptReplacement = useCallback(
    (
      rangeStart: number,
      rangeEnd: number,
      replacement: string,
      options?: { expectedText?: string; cursorOffset?: number },
    ): number | false => {
      const next = replaceComposerPromptRange(
        promptRef.current,
        rangeStart,
        rangeEnd,
        replacement,
        options,
      );
      if (next === false) return false;
      const nextCursor = next.cursor;
      promptRef.current = next.text;
      const activePendingQuestion = activePendingProgress?.activeQuestion;
      if (activePendingQuestion && activePendingUserInputKey) {
        const nextDraftAnswer = setPendingUserInputCustomAnswer(
          pendingUserInputAnswersByRequestIdRef.current[activePendingUserInputKey]?.[
            activePendingQuestion.id
          ],
          next.text,
        );
        const nextRequestAnswers = {
          ...pendingUserInputAnswersByRequestIdRef.current[activePendingUserInputKey],
          [activePendingQuestion.id]: nextDraftAnswer,
        };
        pendingUserInputAnswersByRequestIdRef.current = {
          ...pendingUserInputAnswersByRequestIdRef.current,
          [activePendingUserInputKey]: nextRequestAnswers,
        };
        setPendingUserInputAnswersByRequestId((existing) => ({
          ...existing,
          [activePendingUserInputKey]: nextRequestAnswers,
        }));
      } else {
        setPrompt(next.text);
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(next.trigger);
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCursor);
      });
      return nextCursor;
    },
    [
      promptRef,
      setComposerCursor,
      setComposerTrigger,
      composerEditorRef,
      activePendingProgress?.activeQuestion,
      activePendingUserInputKey,
      setPrompt,
      setPendingUserInputAnswersByRequestId,
      pendingUserInputAnswersByRequestIdRef,
    ],
  );

  const readComposerSnapshot = useCallback((): {
    value: string;
    cursor: number;
    expandedCursor: number;
    selectionCollapsed: boolean;
    terminalContextIds: string[];
  } => {
    const editorSnapshot = composerEditorRef.current?.readSnapshot();
    if (editorSnapshot) {
      return editorSnapshot;
    }
    return {
      value: promptRef.current,
      cursor: composerCursor,
      expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
      selectionCollapsed: true,
      terminalContextIds: composerTerminalContexts.map((context) => context.id),
    };
  }, [promptRef, composerEditorRef, composerCursor, composerTerminalContexts]);

  const resolveActiveComposerTrigger = useCallback((): {
    snapshot: {
      value: string;
      cursor: number;
      expandedCursor: number;
      selectionCollapsed: boolean;
    };
    trigger: ComposerTrigger | null;
  } => {
    const snapshot = readComposerSnapshot();
    return {
      snapshot,
      trigger: detectComposerTrigger(snapshot.value, snapshot.expandedCursor),
    };
  }, [readComposerSnapshot]);

  const applyComposerTriggerReplacement = useCallback(
    (params: {
      snapshot: { value: string };
      trigger: ComposerTrigger;
      base: string;
      cursorOffset?: number;
      onApplied?: () => void;
    }): number | false => {
      const { snapshot, trigger, base, cursorOffset, onApplied } = params;
      const applied = replaceComposerTrigger(
        snapshot,
        trigger,
        base,
        applyPromptReplacement,
        cursorOffset,
      );
      if (applied !== false) {
        onApplied?.();
        setComposerHighlightedItemId(null);
      }
      return applied;
    },
    [setComposerHighlightedItemId, applyPromptReplacement],
  );

  const handleSelectLocalDirectoryMention = useCallback(
    (absolutePath: string) => {
      const { snapshot, trigger } = resolveActiveComposerTrigger();
      if (!trigger) return;
      applyComposerTriggerReplacement({
        snapshot,
        trigger,
        base: `${formatComposerMentionToken(absolutePath)} `,
      });
    },
    [applyComposerTriggerReplacement, resolveActiveComposerTrigger],
  );

  const handleNavigateLocalFolder = useCallback(
    (absolutePath: string) => {
      const { snapshot, trigger } = resolveActiveComposerTrigger();
      if (!trigger) return;
      const base = composerFolderMention(absolutePath);
      applyComposerTriggerReplacement({ snapshot, trigger, base });
    },
    [applyComposerTriggerReplacement, resolveActiveComposerTrigger],
  );

  const setComposerPromptValue = useCallback(
    (nextPrompt: string) => {
      setRestoredQueuedSourceProposedPlan(threadId, null);
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      setComposerHighlightedItemId(null);
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCursor);
      });
    },
    [
      promptRef,
      setComposerCursor,
      setComposerTrigger,
      composerEditorRef,
      setComposerHighlightedItemId,
      setPrompt,
      setRestoredQueuedSourceProposedPlan,
      threadId,
    ],
  );

  const clearComposerSlashDraft = useCallback(() => {
    promptRef.current = "";
    setRestoredQueuedSourceProposedPlan(threadId, null);
    clearComposerDraftContent(threadId);
    setComposerHighlightedItemId(null);
    setComposerCursor(0);
    setComposerTrigger(null);
    scheduleComposerFocus();
  }, [
    promptRef,
    setComposerCursor,
    setComposerTrigger,
    setComposerHighlightedItemId,
    clearComposerDraftContent,
    scheduleComposerFocus,
    setRestoredQueuedSourceProposedPlan,
    threadId,
  ]);
  return {
    applyPromptReplacement,
    resolveActiveComposerTrigger,
    applyComposerTriggerReplacement,
    handleSelectLocalDirectoryMention,
    handleNavigateLocalFolder,
    setComposerPromptValue,
    clearComposerSlashDraft,
  };
}
