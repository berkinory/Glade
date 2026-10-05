import { nonEmptyTrimmed } from "@glade/shared/text/text";

export function normalizeCodexSubagentActivity(
  item: Record<string, unknown>,
): Record<string, unknown> {
  if (item.type !== "subAgentActivity") return item;
  const threadId = nonEmptyTrimmed(item.agentThreadId);
  if (!threadId) return item;
  const status =
    item.kind === "completed"
      ? "completed"
      : item.kind === "interrupted"
        ? "interrupted"
        : "running";
  return {
    ...item,
    type: "collabAgentToolCall",
    tool: "agentActivity",
    status: "completed",
    receiverThreadIds: [threadId],
    receiverAgents: [{ threadId, agentId: nonEmptyTrimmed(item.agentPath) }],
    agentsStates: item.kind === "interacted" ? {} : { [threadId]: { status } },
  };
}
