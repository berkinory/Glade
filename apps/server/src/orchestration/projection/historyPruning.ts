import { type ProjectionTurn } from "../../persistence/Services/ProjectionTurns.ts";
import { type ProjectionThreadMessage } from "../../persistence/Services/ProjectionThreadMessages.ts";

export function retainProjectionTurnsAfterRevert(
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionTurn> {
  return turns.filter(
    (turn) =>
      turn.turnId !== null &&
      turn.checkpointTurnCount !== null &&
      turn.checkpointTurnCount <= turnCount,
  );
}

export function retainProjectionMessagesAfterRevert(
  messages: ReadonlyArray<ProjectionThreadMessage>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadMessage> {
  const retainedMessageIds = new Set<string>();
  const retainedTurnIds = new Set<string>();
  const keptTurns = retainProjectionTurnsAfterRevert(turns, turnCount);
  for (const turn of keptTurns) {
    if (turn.turnId !== null) {
      retainedTurnIds.add(turn.turnId);
    }
    if (turn.pendingMessageId !== null) {
      retainedMessageIds.add(turn.pendingMessageId);
    }
    if (turn.assistantMessageId !== null) {
      retainedMessageIds.add(turn.assistantMessageId);
    }
  }

  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.messageId);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.messageId);
    }
  }

  for (const role of ["user", "assistant"] as const) {
    const retainedCount = messages.filter(
      (message) => message.role === role && retainedMessageIds.has(message.messageId),
    ).length;
    const missingCount = Math.max(0, turnCount - retainedCount);
    if (missingCount > 0) {
      for (const message of messages
        .filter(
          (message) =>
            message.role === role &&
            !retainedMessageIds.has(message.messageId) &&
            (message.turnId === null || retainedTurnIds.has(message.turnId)),
        )
        .slice(0, missingCount)) {
        retainedMessageIds.add(message.messageId);
      }
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.messageId));
}

export function retainTurnScopedProjectionRowsAfterRevert<
  Row extends { readonly turnId: ProjectionTurn["turnId"] },
>(
  rows: ReadonlyArray<Row>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<Row> {
  const retainedTurnIds = new Set(
    retainProjectionTurnsAfterRevert(turns, turnCount).flatMap((turn) =>
      turn.turnId === null ? [] : [turn.turnId],
    ),
  );
  return rows.filter((row) => row.turnId === null || retainedTurnIds.has(row.turnId));
}

export function rollbackProjectionMessagesFromMessage(
  messages: ReadonlyArray<ProjectionThreadMessage>,
  messageId: string,
): {
  readonly keptRows: ReadonlyArray<ProjectionThreadMessage>;
  readonly removedTurnIds: ReadonlySet<string>;
  readonly changed: boolean;
} {
  const targetIndex = messages.findIndex((message) => message.messageId === messageId);
  if (targetIndex < 0) {
    return { keptRows: messages, removedTurnIds: new Set(), changed: false };
  }
  const removedRows = messages.slice(targetIndex);
  return {
    keptRows: messages.slice(0, targetIndex),
    removedTurnIds: new Set(
      removedRows.flatMap((message) =>
        message.role === "system" || message.turnId === null ? [] : [message.turnId],
      ),
    ),
    changed: true,
  };
}

export function retainTurnScopedProjectionRowsAfterConversationRollback<
  Row extends { readonly turnId: string | null },
>(rows: ReadonlyArray<Row>, removedTurnIds: ReadonlySet<string>): ReadonlyArray<Row> {
  if (removedTurnIds.size === 0) return rows;
  return rows.filter((row) => row.turnId === null || !removedTurnIds.has(row.turnId));
}
