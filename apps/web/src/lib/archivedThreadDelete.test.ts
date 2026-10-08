import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { describe, expect, it, vi } from "vitest";

import { deleteArchivedThreadsFromClient } from "./archivedThreadDelete";

describe("deleteArchivedThreadsFromClient", () => {
  it("deletes multiple archived threads and removes each locally once", async () => {
    const threadA = ThreadId.makeUnsafe("thread-archived-a");
    const threadB = ThreadId.makeUnsafe("thread-archived-b");
    const dispatchCommand = vi.fn().mockResolvedValue({ sequence: 11 });
    const removeDeletedThreadFromClientState = vi.fn();

    await deleteArchivedThreadsFromClient({
      api: { dispatchCommand },
      threadIds: [threadA, threadA, threadB],
      removeDeletedThreadFromClientState,
    });

    expect(dispatchCommand).toHaveBeenCalledTimes(2);
    expect(dispatchCommand).toHaveBeenNthCalledWith(1, {
      type: "thread.delete",
      commandId: expect.any(String),
      threadId: threadA,
    });
    expect(dispatchCommand).toHaveBeenNthCalledWith(2, {
      type: "thread.delete",
      commandId: expect.any(String),
      threadId: threadB,
    });
    expect(removeDeletedThreadFromClientState.mock.calls).toEqual([[threadA], [threadB]]);
  });

  it("reconciles successful archived deletes when a later bulk delete fails", async () => {
    const threadA = ThreadId.makeUnsafe("thread-archived-a");
    const threadB = ThreadId.makeUnsafe("thread-archived-b");
    const dispatchError = new Error("delete failed");
    const dispatchCommand = vi
      .fn()
      .mockResolvedValueOnce({ sequence: 11 })
      .mockRejectedValueOnce(dispatchError);
    const removeDeletedThreadFromClientState = vi.fn();

    await expect(
      deleteArchivedThreadsFromClient({
        api: { dispatchCommand },
        threadIds: [threadA, threadB],
        removeDeletedThreadFromClientState,
      }),
    ).rejects.toThrow(dispatchError);

    expect(dispatchCommand).toHaveBeenCalledTimes(2);
    expect(removeDeletedThreadFromClientState.mock.calls).toEqual([[threadA]]);
  });
});
