import type { OrchestrationMessageSource } from "@glade/contracts/orchestration/threadEntities";

interface HistoryMessage {
  readonly source?: OrchestrationMessageSource | undefined;
  readonly turnId?: string | null | undefined;
}

// Imported messages come from another conversation and predate every turn of the thread holding
// them, so reverting that thread's own turns must keep them and anything scoped to their turns.
export function isImportedHistoryMessage(message: HistoryMessage): boolean {
  return message.source === "fork-import" || message.source === "handoff-import";
}

export function importedHistoryTurnIds(messages: ReadonlyArray<HistoryMessage>): Set<string> {
  return new Set(
    messages.flatMap((message) =>
      isImportedHistoryMessage(message) && message.turnId ? [message.turnId] : [],
    ),
  );
}
