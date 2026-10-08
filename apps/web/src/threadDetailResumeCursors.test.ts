import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { afterEach, describe, expect, it } from "vitest";
import {
  advanceThreadDetailResumeCursor,
  buildThreadSubscribeInput,
  getThreadDetailResumeCursor,
  resetThreadDetailResumeCursors,
  setThreadDetailResumeCursor,
} from "./threadDetailResumeCursors";

function threadId(value: string): ThreadId {
  return ThreadId.makeUnsafe(value);
}

describe("threadDetailResumeCursors", () => {
  afterEach(() => {
    resetThreadDetailResumeCursors();
  });

  it("subscribes without a cursor until cached detail exists, then resumes from it", () => {
    const thread = threadId("thread-1");

    expect(buildThreadSubscribeInput(thread)).toEqual({ threadId: thread });

    setThreadDetailResumeCursor(thread, 12);
    expect(buildThreadSubscribeInput(thread)).toEqual({ threadId: thread, afterSequence: 12 });
  });

  it("advances monotonically for events but lets snapshots overwrite backwards", () => {
    const thread = threadId("thread-2");

    advanceThreadDetailResumeCursor(thread, 5);
    advanceThreadDetailResumeCursor(thread, 3);
    expect(getThreadDetailResumeCursor(thread)).toBe(5);

    // A fresh snapshot replaces cached detail wholesale, so a lower fence (server restored from backup)
    // must win over the stale live cursor.
    setThreadDetailResumeCursor(thread, 2);
    expect(getThreadDetailResumeCursor(thread)).toBe(2);
  });
});
