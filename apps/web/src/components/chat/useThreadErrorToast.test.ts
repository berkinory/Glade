import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { describe, expect, it } from "vitest";

import { buildThreadErrorToastOptions } from "./useThreadErrorToast";

describe("thread error toast", () => {
  it("keeps a rejected rollback trace copyable while showing a short title", () => {
    const error =
      "Thread is blocked by an earlier provider failure: Provider adapter request failed (codex) for thread/rollback: Invalid request: unknown variant `thread/rollback`, expected one of many methods";
    const options = buildThreadErrorToastOptions({
      error,
      threadId: ThreadId.makeUnsafe("thread-1"),
      onClose: () => undefined,
    });

    expect(options.title).toBe("This chat is blocked by an earlier provider error.");
    expect(options.data?.copyText).toBe(error);
  });
});
