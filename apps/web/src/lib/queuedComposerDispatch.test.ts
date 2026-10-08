import { MessageId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeQueuedTurn, resetComposerDraftStore } from "../composerDraftStoreTestFixtures";
import { useStore } from "../store";
import { initialState } from "../storeState";
import { makeState, makeThread } from "../storeTestFixtures";
import { dispatchQueuedComposerTurnHeadless } from "./queuedComposerDispatch";

const nativeApiMocks = vi.hoisted(() => ({
  dispatchCommand: vi.fn(async () => undefined),
}));

vi.mock("../nativeApi", () => ({
  readNativeApi: () => ({
    orchestration: {
      dispatchCommand: nativeApiMocks.dispatchCommand,
    },
  }),
}));

const THREAD_ID = ThreadId.makeUnsafe("thread-1");

describe("dispatchQueuedComposerTurnHeadless", () => {
  beforeEach(() => {
    resetComposerDraftStore();
    useStore.setState(initialState);
    nativeApiMocks.dispatchCommand.mockClear();
    useStore.setState(makeState(makeThread({ id: THREAD_ID })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetComposerDraftStore();
    useStore.setState(initialState);
  });

  it("dispatches a snapshotted chat turn with dispatchMode queue", async () => {
    const queuedTurn = makeQueuedTurn("queued-chat-1");
    const messageId = MessageId.makeUnsafe("queued-dispatch-message");
    const succeeded = await dispatchQueuedComposerTurnHeadless({
      threadId: THREAD_ID,
      queuedTurn,
      dispatchMode: "queue",
      assistantDeliveryMode: "streaming",
      messageId,
    });

    expect(succeeded).toBe(true);
    expect(nativeApiMocks.dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.turn.start",
        threadId: THREAD_ID,
        dispatchMode: "queue",
        runtimeMode: "full-access",
        assistantDeliveryMode: "streaming",
        message: expect.objectContaining({
          messageId,
          role: "user",
          text: "queued chat prompt",
        }),
      }),
    );
  });
});
