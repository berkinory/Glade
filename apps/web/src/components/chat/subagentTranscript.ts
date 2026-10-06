import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { MessageId } from "@glade/contracts/core/baseSchemas";
import type { ChatMessage, Thread } from "~/types";
import { extractCollabSubagents } from "~/workLog.extraction";

export function subagentInitialPrompt(
  child: Thread | undefined,
  parent: Thread | undefined,
): ChatMessage | undefined {
  if (
    child?.creationSource !== "provider_native" ||
    !child.parentThreadId ||
    child.messages.some((message) => message.role === "user")
  ) {
    return undefined;
  }
  const nativePrompt = child.activities.find(
    (activity) =>
      activity.kind === "subagent.prompt" &&
      typeof asObjectRecord(activity.payload)?.text === "string",
  );
  if (nativePrompt) {
    const text = asObjectRecord(nativePrompt.payload)?.text;
    if (typeof text === "string" && text.trim()) {
      return {
        id: MessageId.makeUnsafe(`subagent-prompt:${child.id}`),
        role: "user",
        text,
        streaming: false,
        createdAt: child.createdAt,
        turnId: nativePrompt.turnId,
      };
    }
  }
  if (parent?.id !== child.parentThreadId) return undefined;
  const prefix = `subagent:${parent.id}:`;
  const nativeId = child.id.startsWith(prefix) ? child.id.slice(prefix.length) : child.id;
  for (const activity of parent.activities) {
    const agent = extractCollabSubagents(asObjectRecord(activity.payload) ?? null).find(
      (candidate) =>
        candidate.threadId === nativeId ||
        candidate.threadId === child.id ||
        candidate.providerThreadId === nativeId,
    );
    if (!agent?.prompt?.trim()) continue;
    // The launch prompt already belongs to durable parent activity. Derive its display here;
    // never dispatch a user turn or copy it into another store to populate a read-only child.
    return {
      id: MessageId.makeUnsafe(`subagent-prompt:${child.id}`),
      role: "user",
      text: agent.prompt,
      streaming: false,
      createdAt: child.createdAt,
      turnId: child.messages.find((message) => message.turnId)?.turnId ?? null,
    };
  }
  return undefined;
}
