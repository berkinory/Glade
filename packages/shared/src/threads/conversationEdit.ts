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

export type TailUserMessageEditTarget =
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
        | "not-latest-native-user-message"
        | "missing-turn-metadata"
        | "spans-multiple-turns";
    };

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

export function resolveTailUserMessageEditTarget(input: {
  readonly messages: ReadonlyArray<EditableMessageLike>;
  readonly messageId: string;
  readonly activeTurnId?: string | null | undefined;
}): TailUserMessageEditTarget {
  const messageIndex = input.messages.findIndex((message) => message.id === input.messageId);
  if (messageIndex < 0) {
    return { editable: false, reason: "missing-message" };
  }

  const message = input.messages[messageIndex];
  if (!message || message.role !== "user") {
    return { editable: false, reason: "not-user-message" };
  }
  if (!isNativeEditableSource(message.source)) {
    return { editable: false, reason: "non-native-message" };
  }
  if (input.messages.some((entry) => entry.asyncUserInput?.response?.messageId === message.id)) {
    return { editable: false, reason: "structured-answer" };
  }

  const latestNativeUserIndex = findLatestConversationUserMessageIndex(input.messages);
  if (messageIndex !== latestNativeUserIndex) {
    return { editable: false, reason: "not-latest-native-user-message" };
  }

  const removedTurnIds = collectTailTurnIds({
    messages: input.messages,
    messageId: input.messageId,
  });
  if (removedTurnIds.length > 1) {
    return { editable: false, reason: "spans-multiple-turns" };
  }

  if (removedTurnIds.length === 1) {
    return {
      editable: true,
      messageId: message.id,
      messageIndex,
      mode: "rollback",
      rollbackTurnCount: 1,
      removedTurnIds,
    };
  }

  if (
    input.activeTurnId ||
    input.messages.slice(messageIndex + 1).every((entry) => entry.role === "system")
  ) {
    return {
      editable: true,
      messageId: message.id,
      messageIndex,
      mode: "active-tail",
      rollbackTurnCount: 0,
      removedTurnIds: [],
    };
  }

  return { editable: false, reason: "missing-turn-metadata" };
}

export function resolveLatestTailUserMessageEditTarget(input: {
  readonly messages: ReadonlyArray<EditableMessageLike>;
  readonly activeTurnId?: string | null | undefined;
}): TailUserMessageEditTarget {
  const latestNativeUserIndex = findLatestConversationUserMessageIndex(input.messages);
  const latestNativeUserMessage = input.messages[latestNativeUserIndex];
  if (!latestNativeUserMessage) {
    return { editable: false, reason: "missing-message" };
  }
  return resolveTailUserMessageEditTarget({
    messages: input.messages,
    messageId: latestNativeUserMessage.id,
    activeTurnId: input.activeTurnId,
  });
}
