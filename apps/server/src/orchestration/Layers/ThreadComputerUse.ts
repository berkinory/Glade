import type { ComputerUseMode } from "@glade/contracts/computer/computerUse";
import { Layer } from "effect";

import { ThreadComputerUse, type ThreadComputerUseShape } from "../Services/ThreadComputerUse.ts";

interface ThreadState {
  mode: ComputerUseMode;
  onceBound: boolean;
  provisioned: boolean;
}

export const ThreadComputerUseLive = Layer.sync(ThreadComputerUse, () => {
  const threads = new Map<string, ThreadState>();
  const state = (threadId: string) => {
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
      entry.mode = mode;
      entry.onceBound = false;
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
      }
    },
    provisioned: (threadId) => threads.get(threadId)?.provisioned ?? false,
    markProvisioned: (threadId, listed) => {
      state(threadId).provisioned = listed;
    },
    clear: (threadId) => {
      threads.delete(threadId);
    },
  } satisfies ThreadComputerUseShape;
});
