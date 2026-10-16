type TurnMessageLike<TTurnId extends string = string> = {
  readonly id: string;
  readonly role?: string | undefined;
  readonly turnId?: TTurnId | null | undefined;
};

type EditableMessageLike = TurnMessageLike & {
  readonly role: string;
  readonly source?: string | undefined;
  readonly asyncUserInput?:
    | { readonly response?: { readonly messageId: string } | undefined }
    | undefined;
};

export type UserMessageEditTarget =
  | {
      readonly editable: true;
      readonly messageId: string;
      readonly messageIndex: number;
      readonly mode: "rollback" | "active-tail";
      readonly rollbackTurnCount: number;
      readonly removedTurnIds: ReadonlyArray<string>;
    }
  | {
      readonly editable: false;
      readonly reason:
        | "missing-message"
        | "not-user-message"
        | "non-native-message"
        | "structured-answer"
        | "earlier-message-while-running"
        | "missing-turn-metadata";
    };

type EditRejectionReason = Extract<UserMessageEditTarget, { editable: false }>["reason"];

function isNativeEditableSource(source: string | undefined): boolean {
  return source === undefined || source === "native";
}

function collectUniqueTurnIds<TTurnId extends string>(
  messages: ReadonlyArray<Omit<TurnMessageLike<TTurnId>, "id">>,
): TTurnId[] {
  return [
    ...new Set(
      messages.flatMap((message) =>
        message.role !== "system" && message.turnId ? [message.turnId] : [],
      ),
    ),
  ];
}

export function collectTailTurnIds<TTurnId extends string>(input: {
  readonly messages: ReadonlyArray<TurnMessageLike<TTurnId>>;
  readonly messageId: string;
}): TTurnId[] {
  const messageIndex = input.messages.findIndex((message) => message.id === input.messageId);
  if (messageIndex < 0) {
    return [];
  }
  return collectUniqueTurnIds(input.messages.slice(messageIndex));
}

// A plain rollback cancels no pending sends, so a user message after the target that has not started
// a turn was sent while the rollback ran and its turn start is still waiting for it. Edit replays
// cancel those sends themselves and drop the whole tail.
export function splitConversationRollbackTail<TMessage extends Omit<TurnMessageLike, "id">>(
  messages: ReadonlyArray<TMessage>,
  targetIndex: number,
  keepUnstartedSends: boolean,
): { readonly keptMessages: TMessage[]; readonly removedTurnIds: ReadonlySet<string> } {
  const tail = messages.slice(targetIndex);
  const unstartedSends = keepUnstartedSends
    ? tail.slice(1).filter((message) => message.role === "user" && !message.turnId)
    : [];
  return {
    keptMessages: [...messages.slice(0, targetIndex), ...unstartedSends],
    removedTurnIds: new Set(collectUniqueTurnIds(tail)),
  };
}

function findLatestConversationUserMessageIndex(
  messages: ReadonlyArray<EditableMessageLike>,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      message?.role === "user" &&
      (isNativeEditableSource(message.source) || message.source === "async-user-input")
    ) {
      return index;
    }
  }
  return -1;
}

function collectAnsweredMessageIds(messages: ReadonlyArray<EditableMessageLike>): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    const answerId = message.asyncUserInput?.response?.messageId;
    if (answerId) ids.add(answerId);
  }
  return ids;
}

// An earlier message rolls back every later turn, which needs the provider idle. Only the latest
// message can replace a running turn or a prompt whose turn has not produced output yet.
function classifyUserMessageEdit(input: {
  readonly message: EditableMessageLike;
  readonly isLatest: boolean;
  readonly isAnswer: boolean;
  readonly tailTurnCount: number;
  readonly onlySystemAfter: boolean;
  readonly activeTurnId: string | null | undefined;
}): EditRejectionReason | "rollback" | "active-tail" {
  if (input.message.role !== "user") return "not-user-message";
  if (!isNativeEditableSource(input.message.source)) return "non-native-message";
  if (input.isAnswer) return "structured-answer";
  if (!input.isLatest && input.activeTurnId) return "earlier-message-while-running";
  if (input.tailTurnCount > 0) return "rollback";
  if (input.isLatest && (input.activeTurnId || input.onlySystemAfter)) return "active-tail";
  return "missing-turn-metadata";
}

export function resolveUserMessageEditTarget(input: {
  readonly messages: ReadonlyArray<EditableMessageLike>;
  readonly messageId: string;
  readonly activeTurnId?: string | null | undefined;
}): UserMessageEditTarget {
  const messageIndex = input.messages.findIndex((message) => message.id === input.messageId);
  const message = input.messages[messageIndex];
  if (!message) {
    return { editable: false, reason: "missing-message" };
  }
  const removedTurnIds = collectTailTurnIds({
    messages: input.messages,
    messageId: input.messageId,
  });
  const classification = classifyUserMessageEdit({
    message,
    isLatest: messageIndex === findLatestConversationUserMessageIndex(input.messages),
    isAnswer: collectAnsweredMessageIds(input.messages).has(message.id),
    tailTurnCount: removedTurnIds.length,
    onlySystemAfter: input.messages
      .slice(messageIndex + 1)
      .every((entry) => entry.role === "system"),
    activeTurnId: input.activeTurnId,
  });
  if (classification !== "rollback" && classification !== "active-tail") {
    return { editable: false, reason: classification };
  }
  return {
    editable: true,
    messageId: message.id,
    messageIndex,
    mode: classification,
    rollbackTurnCount: removedTurnIds.length,
    removedTurnIds,
  };
}

// Same rules as resolveUserMessageEditTarget, in one pass over the transcript.
export function collectEditableUserMessageIds<TId extends string>(input: {
  readonly messages: ReadonlyArray<EditableMessageLike & { readonly id: TId }>;
  readonly activeTurnId?: string | null | undefined;
}): Set<TId> {
  const editable = new Set<TId>();
  const latestIndex = findLatestConversationUserMessageIndex(input.messages);
  const answeredIds = collectAnsweredMessageIds(input.messages);
  const tailTurnIds = new Set<string>();
  let onlySystemAfter = true;
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index]!;
    if (message.role !== "system" && message.turnId) tailTurnIds.add(message.turnId);
    const classification = classifyUserMessageEdit({
      message,
      isLatest: index === latestIndex,
      isAnswer: answeredIds.has(message.id),
      tailTurnCount: tailTurnIds.size,
      onlySystemAfter,
      activeTurnId: input.activeTurnId,
    });
    if (classification === "rollback" || classification === "active-tail") {
      editable.add(message.id);
    }
    if (message.role !== "system") onlySystemAfter = false;
  }
  return editable;
}
