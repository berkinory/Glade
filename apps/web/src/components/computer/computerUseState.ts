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
// Drafts not yet on the server that asked for Computer Use on their first message. The mode is sent
// once the send creates the thread (applyDraftComputerUse); it is not persisted with the draft.
let draftsWithComputerUse: ReadonlySet<ThreadId> = new Set();
let stopSubscription: (() => void) | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!stopSubscription && isElectron) {
    stopSubscription =
      readNativeApi()?.computer.onState((state) => {
        latest = state;
        notify();
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
const getDraftSnapshot = () => draftsWithComputerUse;

// Null until the first state arrives, and always outside the desktop app.
export function useComputerState(): ComputerState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const NO_GRANTS: ReadonlyArray<ComputerGrantView> = [];

function threadState(
  state: ComputerState | null,
  drafts: ReadonlySet<ThreadId>,
  threadId: ThreadId,
) {
  const thread = state?.threads.find((entry) => entry.threadId === threadId);
  const mode: ComputerUseMode = drafts.has(threadId) ? "once" : (thread?.mode ?? "off");
  return { mode, grants: thread?.grants ?? NO_GRANTS };
}

export function useThreadComputerUse(threadId: ThreadId) {
  const drafts = useSyncExternalStore(subscribe, getDraftSnapshot, getDraftSnapshot);
  return threadState(useComputerState(), drafts, threadId);
}

export function readComputerUseMode(threadId: ThreadId): ComputerUseMode {
  return threadState(latest, draftsWithComputerUse, threadId).mode;
}

function setDraftComputerUse(threadId: ThreadId, on: boolean) {
  if (draftsWithComputerUse.has(threadId) === on) return;
  const next = new Set(draftsWithComputerUse);
  if (on) next.add(threadId);
  else next.delete(threadId);
  draftsWithComputerUse = next;
  notify();
}

// A draft thread does not exist on the server yet, so its "once" waits for the first send.
export function markDraftComputerUse(threadId: ThreadId) {
  setDraftComputerUse(threadId, true);
}

const dispatchMode = (threadId: ThreadId, mode: ComputerUseMode) =>
  readNativeApi()?.orchestration.dispatchCommand({
    type: "thread.computer-use.set",
    commandId: newCommandId(),
    threadId,
    computerUse: mode,
    createdAt: new Date().toISOString(),
  });

// Called by the first send of a draft after thread.create and before thread.turn.start. The server
// handles both commands' events in order, so the provider session starts with the tools listed.
// Throws so a failure stops the send instead of running the turn without Computer Use.
export async function applyDraftComputerUse(threadId: ThreadId) {
  if (!draftsWithComputerUse.has(threadId)) return;
  await dispatchMode(threadId, "once");
  setDraftComputerUse(threadId, false);
}

export async function setComputerUseMode(threadId: ThreadId, mode: ComputerUseMode) {
  if (draftsWithComputerUse.has(threadId) && mode === "off") {
    setDraftComputerUse(threadId, false);
    return;
  }
  try {
    await dispatchMode(threadId, mode);
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Could not change Computer Use",
      description: error instanceof Error ? error.message : "An unexpected error occurred.",
    });
  }
}
