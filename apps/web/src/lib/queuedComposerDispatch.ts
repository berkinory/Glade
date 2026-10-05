import { isTurnDispatchOutcomeUnknown } from "../wsTurnDispatch";
import type { AssistantDeliveryMode } from "@glade/contracts/provider/sessionPolicy";
import type { MessageId, ThreadId } from "@glade/contracts/core/baseSchemas";

import { persistModelSelectionBeforeRuntimeMode } from "../components/ChatView.logic.session";
import type { QueuedComposerTurn } from "../composerDraftDomain";
import { readNativeApi } from "../nativeApi";
import {
  clearPendingTurnDispatch,
  markPendingTurnDispatch,
  usePendingTurnDispatchStore,
} from "../pendingTurnDispatch";

import { useStore } from "../store";
import { getThreadFromState } from "../threadDerivation";
import { appendAssistantSelectionsToPrompt } from "./assistantSelections";
import { appendBrowserAnnotationsToPrompt } from "./browserAnnotations";
import {
  filterPromptProviderMentionReferences,
  filterPromptSkillReferences,
} from "./composerMentions";
import { appendPastedTextsToPrompt, filterPastedTextsWithText } from "./composerPastedText";
import { appendPullRequestContextsToPrompt } from "./pullRequestContext";
import { stageUploadComposerAttachments } from "./composerSend";
import { appendFileCommentsToPrompt } from "./fileComments";
import {
  appendTerminalContextsToPrompt,
  filterTerminalContextsWithText,
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
} from "./terminalContext";
import { newCommandId, newMessageId } from "./utils";

export async function dispatchQueuedComposerTurnHeadless(input: {
  threadId: ThreadId;
  queuedTurn: QueuedComposerTurn;
  dispatchMode: "queue" | "steer";
  assistantDeliveryMode: AssistantDeliveryMode;
  messageId?: MessageId;
}): Promise<boolean> {
  const api = readNativeApi();
  if (!api) {
    return false;
  }

  const thread = getThreadFromState(useStore.getState(), input.threadId);
  if (!thread) {
    return false;
  }

  const createdAt = new Date().toISOString();
  const messageId = input.messageId ?? newMessageId();
  const queuedTurn = input.queuedTurn;

  const sendableTerminalContexts = filterTerminalContextsWithText(queuedTurn.terminalContexts);
  const sendablePastedTexts = filterPastedTextsWithText(queuedTurn.pastedTexts);
  const messageText = appendBrowserAnnotationsToPrompt(
    appendPullRequestContextsToPrompt(
      appendPastedTextsToPrompt(
        appendFileCommentsToPrompt(
          appendTerminalContextsToPrompt(
            appendAssistantSelectionsToPrompt(queuedTurn.prompt, queuedTurn.assistantSelections),
            sendableTerminalContexts,
          ),
          queuedTurn.fileComments,
        ),
        sendablePastedTexts,
      ),
      queuedTurn.pullRequestContexts,
    ),
    queuedTurn.browserAnnotations,
    messageId,
  );
  const outgoingTextSeed =
    messageText || (queuedTurn.images.length > 0 ? IMAGE_ONLY_BOOTSTRAP_PROMPT : "");
  if (!outgoingTextSeed.trim() && queuedTurn.images.length === 0) {
    return false;
  }
  const outgoingMessageText = outgoingTextSeed;
  const mentionedSkills = filterPromptSkillReferences(outgoingMessageText, queuedTurn.skills);
  const mentionedMentions = filterPromptProviderMentionReferences(
    outgoingMessageText,
    queuedTurn.mentions,
  );
  const pendingDispatch = usePendingTurnDispatchStore.getState();
  if (!pendingDispatch.beginSubmission(input.threadId)) return false;
  const turnAttachmentsPromise = stageUploadComposerAttachments({
    threadId: input.threadId,
    images: queuedTurn.images,
    files: queuedTurn.files,
    assistantSelections: queuedTurn.assistantSelections,
  });

  markPendingTurnDispatch(input.threadId);
  try {
    await persistQueuedTurnThreadSettings({
      api,
      thread,
      queuedTurn,
      createdAt,
    });
    const stagedTurnAttachments = await turnAttachmentsPromise;
    await stagedTurnAttachments.runWithDispatch((turnAttachments) =>
      api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: input.threadId,
        message: {
          messageId,
          role: "user",
          text: outgoingMessageText,
          attachments: turnAttachments,
          ...(mentionedSkills.length > 0 ? { skills: mentionedSkills } : {}),
          ...(mentionedMentions.length > 0 ? { mentions: mentionedMentions } : {}),
        },
        modelSelection: queuedTurn.modelSelection,
        ...(queuedTurn.providerOptionsForDispatch
          ? { providerOptions: queuedTurn.providerOptionsForDispatch }
          : {}),
        assistantDeliveryMode: input.assistantDeliveryMode,
        dispatchMode: input.dispatchMode,
        runtimeMode: queuedTurn.runtimeMode,

        createdAt,
      }),
    );
    return true;
  } catch (error) {
    if (isTurnDispatchOutcomeUnknown(error)) {
      useStore
        .getState()
        .setError(
          input.threadId,
          error instanceof Error ? error.message : "Queued message delivery is uncertain.",
        );
      return false;
    }
    await turnAttachmentsPromise.then(
      (staged) => staged.cleanup(),
      () => undefined,
    );
    clearPendingTurnDispatch(input.threadId);
    return false;
  } finally {
    pendingDispatch.endSubmission(input.threadId);
  }
}

async function persistQueuedTurnThreadSettings(input: {
  api: NonNullable<ReturnType<typeof readNativeApi>>;
  thread: NonNullable<ReturnType<typeof getThreadFromState>>;
  queuedTurn: QueuedComposerTurn;
  createdAt: string;
}): Promise<void> {
  await persistModelSelectionBeforeRuntimeMode({
    currentModelSelection: input.thread.modelSelection,
    nextModelSelection: input.queuedTurn.modelSelection,
    currentRuntimeMode: input.thread.runtimeMode,
    nextRuntimeMode: input.queuedTurn.runtimeMode,
    persistModelSelection: (modelSelection) =>
      input.api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: input.thread.id,
        modelSelection,
      }),
    persistRuntimeMode: (runtimeMode) =>
      input.api.orchestration.dispatchCommand({
        type: "thread.runtime-mode.set",
        commandId: newCommandId(),
        threadId: input.thread.id,
        runtimeMode,
        createdAt: input.createdAt,
      }),
  });
}
