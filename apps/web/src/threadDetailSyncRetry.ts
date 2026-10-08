import type { ThreadId } from "@glade/contracts/core/baseSchemas";

import { readNativeApi } from "./nativeApi";
import { useStore } from "./store";
import { buildThreadSubscribeInput } from "./threadDetailResumeCursors";

// Manual recovery for a thread whose stream gave up: resubscribe from its applied cursor, or a
// fresh snapshot when it has none. A renewed failure marks the thread failed again.
export function retryThreadDetailSync(threadId: ThreadId): void {
  useStore.getState().clearThreadDetailSyncFailure(threadId);
  void readNativeApi()
    ?.orchestration.subscribeThread(buildThreadSubscribeInput(threadId))
    .catch(() => undefined);
}
