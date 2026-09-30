import type { ClientOrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type CompactionCommand = Extract<ClientOrchestrationCommand, { type: "thread.turn.start" }>;

export const useClaudeCompactionRequests = create<{
  requests: Partial<Record<ThreadId, CompactionCommand>>;
  remember: (command: CompactionCommand) => void;
  forget: (threadId: ThreadId, commandId: CommandId) => void;
}>()(
  persist(
    (set) => ({
      requests: {},
      remember: (command) =>
        set((state) => ({ requests: { ...state.requests, [command.threadId]: command } })),
      forget: (threadId, commandId) =>
        set((state) => {
          if (state.requests[threadId]?.commandId !== commandId) return state;
          const requests = { ...state.requests };
          delete requests[threadId];
          return { requests };
        }),
    }),
    {
      name: "glade:claude-compaction-requests",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ requests: state.requests }),
    },
  ),
);
