import { MessageId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { expect, it } from "vitest";
import { coalesceOrchestrationUiEvents } from "./orchestrationEventCoalescing";
import { applyOrchestrationEvents } from "./storeEventReducer.batch";
import { syncServerThreadDetailHotPath } from "./storeProjection.synchronization";
import { makeDomainEvent, makeReadModelThread, makeState, makeThread } from "./storeTestFixtures";
import { getThreadsFromState } from "./threadDerivation";

const threadId = ThreadId.makeUnsafe("thread-1");
const messageId = MessageId.makeUnsafe("message-1");
const turnId = TurnId.makeUnsafe("turn-1");
const at = "2026-02-27T00:00:00.000Z";
const segment = (sequence: number, text: string) => ({
  sequence,
  startedAt: at,
  endedAt: at,
  text,
});
const messageSent = (
  sequence: number,
  text: string,
  streaming: boolean,
  opensSegment = false,
  providerMessageId?: string,
) =>
  makeDomainEvent(
    "thread.message-sent",
    {
      threadId,
      messageId,
      role: "assistant",
      text,
      ...(opensSegment ? { segmentStartedAt: at, segmentSequence: sequence } : {}),
      ...(providerMessageId ? { providerMessageId } : {}),
      turnId,
      streaming,
      source: "native",
      createdAt: at,
      updatedAt: at,
    },
    { sequence },
  );

it("keeps a segmented reply's text segments in step with deltas after a mid-stream snapshot", () => {
  const snapshot = makeReadModelThread({
    messages: [
      {
        id: messageId,
        role: "assistant",
        text: "Hello world",
        textSegments: [segment(1, "Hello"), segment(2, " world")],
        turnId,
        streaming: true,
        source: "native",
        createdAt: at,
        updatedAt: at,
      },
    ],
  });
  let state = syncServerThreadDetailHotPath(makeState(makeThread()), snapshot, 2);
  state = applyOrchestrationEvents(
    state,
    coalesceOrchestrationUiEvents([
      messageSent(3, "!", true),
      messageSent(4, " Next", true, true),
      messageSent(5, " part", true),
    ]),
  );
  state = applyOrchestrationEvents(state, [messageSent(6, "Hello world! Next part", false)]);

  const message = getThreadsFromState(state)[0]!.messages[0]!;
  expect(message.text).toBe("Hello world! Next part");
  expect(message.textSegments?.map((entry) => entry.text)).toEqual([
    "Hello",
    " world!",
    " Next part",
  ]);
});

it("keeps the native message id a live reply's completion carries", () => {
  let state = applyOrchestrationEvents(makeState(makeThread()), [
    messageSent(1, "Hello", true),
    messageSent(2, " world", true),
  ]);
  state = applyOrchestrationEvents(state, [
    messageSent(3, "Hello world", false, false, "native-message-1"),
  ]);

  expect(getThreadsFromState(state)[0]!.messages[0]!.providerMessageId).toBe("native-message-1");
});
