import type { ThreadId } from "@glade/contracts";
import { useEffect } from "react";

import { ensureNativeApi } from "~/nativeApi";
import { addWsTransportStateListener } from "~/wsTransportEvents";
import { useComputerStateStore } from "../computerStateStore";

// Push events never carry a full snapshot, so every surface that renders computer availability (the
// ambient preview and the composer's computer-control toggle) seeds the store with one
// getThreadState on mount and re-seeds on transport reopen.
export function useThreadComputerStateSeed(threadId: ThreadId): void {
  const upsertThreadState = useComputerStateStore((store) => store.upsertThreadState);

  useEffect(() => {
    if (!ensureNativeApi().computer) {
      return;
    }
    let cancelled = false;
    const seed = () => {
      void ensureNativeApi()
        .computer.getThreadState({ threadId })
        .then((state) => {
          if (!cancelled) upsertThreadState(state);
        })
        .catch(() => {});
    };
    seed();
    const unsubscribe = addWsTransportStateListener((state) => {
      if (state === "open") seed();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [threadId, upsertThreadState]);
}
