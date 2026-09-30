import { decodeSubagentReceiverThreadIds } from "@glade/shared/threads/subagents";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function codexMessageRoute(line: string): {
  responseId?: string | number;
  request: boolean;
  threadId?: string;
  parentThreadId?: string;
  childThreadIds: readonly string[];
  threadStarted: boolean;
} {
  const message = record(JSON.parse(line));
  const params = record(message?.params);
  const thread = record(params?.thread);
  const source = record(thread?.source);
  const spawn = record(record(source?.subAgent)?.thread_spawn);
  const threadId = params?.threadId ?? thread?.id ?? params?.conversationId;
  const parentThreadId = thread?.parentThreadId ?? spawn?.parent_thread_id;
  const id = message?.id;
  const response = message?.method === undefined;
  return {
    ...(response && (typeof id === "string" || typeof id === "number") ? { responseId: id } : {}),
    request: !response && id !== undefined,
    ...(typeof threadId === "string" ? { threadId } : {}),
    ...(typeof parentThreadId === "string" ? { parentThreadId } : {}),
    childThreadIds: decodeSubagentReceiverThreadIds(record(params?.item)),
    threadStarted: message?.method === "thread/started",
  };
}
