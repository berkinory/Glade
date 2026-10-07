import type { ComputerUseMode } from "@glade/contracts/computer/computerUse";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ComputerGrantView, ComputerState } from "@glade/contracts/transport/ws/computerRpc";
import { useSyncExternalStore } from "react";
import { isElectron } from "~/env";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { toastManager } from "../ui/toast";

// The server's Computer Use state as the latest value of one shared WS subscription. It is kept
// here, not copied into a store, so the thread menu can read it synchronously while any chat is open.
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

const NO_GRANTS: ReadonlyArray<ComputerGrantView> = [];

function threadState(state: ComputerState | null, threadId: ThreadId) {
  const thread = state?.threads.find((entry) => entry.threadId === threadId);
  return { mode: thread?.mode ?? ("off" as const), grants: thread?.grants ?? NO_GRANTS };
}

export function useThreadComputerUse(threadId: ThreadId) {
  return threadState(useComputerState(), threadId);
}

export function readComputerUseMode(threadId: ThreadId): ComputerUseMode {
  return threadState(latest, threadId).mode;
}

export async function setComputerUseMode(threadId: ThreadId, mode: ComputerUseMode) {
  const api = readNativeApi();
  if (!api) return;
  try {
    await api.orchestration.dispatchCommand({
      type: "thread.computer-use.set",
      commandId: newCommandId(),
      threadId,
      computerUse: mode,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Could not change Computer Use",
      description: error instanceof Error ? error.message : "An unexpected error occurred.",
    });
  }
}
