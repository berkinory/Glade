import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";

type ContentDelta = Extract<ProviderRuntimeEvent, { readonly type: "content.delta" }>;

// Keeps a coalesced journal row and its live frame small; the batch window bounds latency.
const MAX_COALESCED_ASSISTANT_TEXT_CHARS = 8_192;

const isAssistantTextDelta = (event: ProviderRuntimeEvent): event is ContentDelta =>
  event.type === "content.delta" && event.payload.streamKind === "assistant_text";

// Everything except the event's own identity, time and text must match, so new event fields take
// part in the comparison without being listed here.
function deltaStreamIdentity(event: ContentDelta): string {
  const { eventId: _eventId, createdAt: _createdAt, payload, ...stream } = event;
  const { delta: _delta, ...payloadIdentity } = payload;
  return JSON.stringify([stream, payloadIdentity]);
}

/**
 * Returns the batched assistant text delta that `next` continues, extended by its text, or
 * undefined when `next` must stay a separate event. A delta continues an earlier one only when no
 * other event of the same thread lies between them, so each thread keeps its exact event order.
 * Ingestion names the message after the item or turn, so a delta without either is never merged.
 */
export function coalesceAssistantTextDelta(
  batch: ReadonlyArray<ProviderRuntimeEvent>,
  next: ProviderRuntimeEvent,
): { readonly index: number; readonly merged: ProviderRuntimeEvent } | undefined {
  if (!isAssistantTextDelta(next) || (next.itemId ?? next.turnId) === undefined) return undefined;
  for (let index = batch.length - 1; index >= 0; index -= 1) {
    const candidate = batch[index]!;
    if (candidate.threadId !== next.threadId) continue;
    if (
      !isAssistantTextDelta(candidate) ||
      candidate.payload.delta.length + next.payload.delta.length >
        MAX_COALESCED_ASSISTANT_TEXT_CHARS ||
      deltaStreamIdentity(candidate) !== deltaStreamIdentity(next)
    ) {
      return undefined;
    }
    return {
      index,
      merged: {
        ...candidate,
        payload: { ...candidate.payload, delta: candidate.payload.delta + next.payload.delta },
      },
    };
  }
  return undefined;
}
