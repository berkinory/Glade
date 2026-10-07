import type { ComputerUseMode } from "@glade/contracts/computer/computerUse";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Layer } from "effect";

import { ThreadComputerUse, type ThreadComputerUseShape } from "../Services/ThreadComputerUse.ts";

interface ThreadState {
  mode: ComputerUseMode;
  onceBound: boolean;
  provisioned: boolean;
}

export const ThreadComputerUseLive = Layer.sync(ThreadComputerUse, () => {
  const threads = new Map<ThreadId, ThreadState>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  const state = (threadId: ThreadId) => {
    let entry = threads.get(threadId);
    if (!entry) {
      entry = { mode: "off", onceBound: false, provisioned: false };
      threads.set(threadId, entry);
    }
    return entry;
  };
  return {
    mode: (threadId) => threads.get(threadId)?.mode ?? "off",
    set: (threadId, mode) => {
      const entry = state(threadId);
      const previous = entry.mode;
      entry.mode = mode;
      entry.onceBound = false;
      if (previous !== mode) changed();
    },
    turnStarted: (threadId) => {
      const entry = threads.get(threadId);
      if (entry?.mode === "once") entry.onceBound = true;
    },
    turnEnded: (threadId) => {
      const entry = threads.get(threadId);
      if (entry?.mode === "once" && entry.onceBound) {
        entry.mode = "off";
        entry.onceBound = false;
        changed();
      }
    },
    provisioned: (threadId) => threads.get(threadId)?.provisioned ?? false,
    markProvisioned: (threadId, listed) => {
      state(threadId).provisioned = listed;
    },
    clear: (threadId) => {
      const wasOn = (threads.get(threadId)?.mode ?? "off") !== "off";
      threads.delete(threadId);
      if (wasOn) changed();
    },
    enabled: () =>
      [...threads.entries()]
        .filter(([, entry]) => entry.mode !== "off")
        .map(([threadId, entry]) => ({ threadId, mode: entry.mode })),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies ThreadComputerUseShape;
});
