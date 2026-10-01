import type { NativeApi } from "@glade/contracts/ipc/ipc";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  collectErrorMessages,
  THREAD_NOT_ARCHIVED_INVARIANT_MARKER,
} from "@glade/shared/text/errorMessages";

import { newCommandId } from "./utils";

type ThreadCommandDispatcher = Pick<NativeApi["orchestration"], "dispatchCommand">;

export async function archiveThreadFromClient(
  api: ThreadCommandDispatcher,
  threadId: ThreadId,
): Promise<number> {
  const receipt = await api.dispatchCommand({
    type: "thread.archive",
    commandId: newCommandId(),
    threadId,
  });
  return receipt.sequence;
}

// Detects the server invariant returned when an Undo races another restore (the thread is already
// unarchived). Matches the marker the server embeds in the invariant message — a single shared
// source of truth so the two sides cannot drift — and scopes it to the unarchive command and this
// thread so unrelated invariants (e.g. "thread not found") never read as "already restored".
export function isThreadAlreadyUnarchivedError(error: unknown, threadId: ThreadId): boolean {
  const errorText = collectErrorMessages(error).join("\n");
  return (
    errorText.includes("thread.unarchive") &&
    errorText.includes(THREAD_NOT_ARCHIVED_INVARIANT_MARKER) &&
    errorText.includes(String(threadId))
  );
}

export async function unarchiveThreadFromClient(
  api: ThreadCommandDispatcher,
  threadId: ThreadId,
): Promise<void> {
  await api.dispatchCommand({
    type: "thread.unarchive",
    commandId: newCommandId(),
    threadId,
  });
}
