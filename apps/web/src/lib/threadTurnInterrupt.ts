import type { ThreadId } from "@glade/contracts/core/baseSchemas";

import { ensureNativeApi } from "~/nativeApi";
import { newCommandId } from "./utils";

export async function interruptThreadTurn(threadId: ThreadId): Promise<void> {
  const api = ensureNativeApi();
  await api.orchestration.dispatchCommand({
    type: "thread.turn.interrupt",
    commandId: newCommandId(),
    threadId,
    createdAt: new Date().toISOString(),
  });
}
