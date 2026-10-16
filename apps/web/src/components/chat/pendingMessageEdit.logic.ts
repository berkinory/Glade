import { collectTailTurnIds } from "@glade/shared/threads/conversationEdit";

import type { ChatMessage, PendingMessageEdit } from "../../types";
import type { WorkLogEntry } from "../../workLog.types";

// Shows an edit the server has accepted but not applied yet the way its rollback will leave the
// transcript. Once the server rewrites the message, its own state is shown again.
export function applyPendingMessageEdit(input: {
  readonly messages: ChatMessage[];
  readonly workEntries: WorkLogEntry[];
  readonly edit: PendingMessageEdit | null;
}): { messages: ChatMessage[]; workEntries: WorkLogEntry[] } {
  const { messages, workEntries, edit } = input;
  const targetIndex = edit ? messages.findIndex((message) => message.id === edit.messageId) : -1;
  const target = messages[targetIndex];
  if (!edit || !target || (target.updatedAt ?? null) !== edit.baseUpdatedAt) {
    return { messages, workEntries };
  }
  const removedTurnIds = new Set<string>(collectTailTurnIds({ messages, messageId: target.id }));
  return {
    messages: [
      ...messages.slice(0, targetIndex),
      { ...target, text: edit.text, turnId: null, streaming: false, startsNewTurn: true },
    ],
    workEntries:
      removedTurnIds.size === 0
        ? workEntries
        : workEntries.filter((entry) => !entry.turnId || !removedTurnIds.has(entry.turnId)),
  };
}
