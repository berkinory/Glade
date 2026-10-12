import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";

type ThreadMessageSentEvent = Extract<OrchestrationEvent, { type: "thread.message-sent" }>;

function mergeThreadMessageSentEvents(
  previous: ThreadMessageSentEvent,
  event: ThreadMessageSentEvent,
): ThreadMessageSentEvent {
  // A merged run keeps the segment boundary its first delta opened, including the event sequence that
  // names the segment when the payload does not.
  const { segmentStartedAt } = previous.payload;
  const segmentSequence =
    previous.payload.segmentSequence ??
    (segmentStartedAt !== undefined ? previous.sequence : undefined);
  return {
    ...event,
    payload: {
      ...event.payload,
      ...(segmentStartedAt !== undefined ? { segmentStartedAt } : {}),
      ...(segmentSequence !== undefined ? { segmentSequence } : {}),
      attachments: event.payload.attachments ?? previous.payload.attachments,
      skills: event.payload.skills ?? previous.payload.skills,
      mentions: event.payload.mentions ?? previous.payload.mentions,
      createdAt: previous.payload.createdAt,
      text: previous.payload.text + event.payload.text,
    },
  };
}

export function coalesceOrchestrationUiEvents(
  events: ReadonlyArray<OrchestrationEvent>,
): OrchestrationEvent[] {
  const coalesced: OrchestrationEvent[] = [];
  const lastSlotByThread = new Map<string, number>();
  for (const event of events) {
    if (!("threadId" in event.payload)) {
      lastSlotByThread.clear();
    } else {
      const threadId = event.payload.threadId;
      const slot = lastSlotByThread.get(threadId);
      const previous = slot === undefined ? undefined : coalesced[slot];
      if (
        event.type === "thread.message-sent" &&
        previous?.type === "thread.message-sent" &&
        previous.payload.messageId === event.payload.messageId &&
        previous.payload.turnId === event.payload.turnId &&
        previous.payload.role === event.payload.role &&
        previous.payload.streaming &&
        event.payload.streaming &&
        // A delta that opens a new text segment stays its own event, or its text would be filed under the
        // previous segment.
        event.payload.segmentStartedAt === undefined
      ) {
        coalesced[slot!] = mergeThreadMessageSentEvents(previous, event);
        continue;
      }
      lastSlotByThread.set(threadId, coalesced.length);
    }
    coalesced.push(event);
  }
  return coalesced;
}
