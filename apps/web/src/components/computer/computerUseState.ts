import type { ComputerState } from "@glade/contracts/transport/ws/computerRpc";
import { useSyncExternalStore } from "react";
import { isElectron } from "~/env";
import { readNativeApi } from "~/nativeApi";

// The server's Computer Use state as the latest value of one shared WS subscription.
let latest: ComputerState | null = null;
let stopSubscription: (() => void) | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!stopSubscription && isElectron) {
    stopSubscription =
      readNativeApi()?.computer.onState((state) => {
        latest = state;
        for (const notify of listeners) notify();
      }) ?? null;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || !stopSubscription) return;
    stopSubscription();
    stopSubscription = null;
    latest = null;
  };
}

const getSnapshot = () => latest;

// Null until the first state arrives, and always outside the desktop app.
export function useComputerState(): ComputerState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
