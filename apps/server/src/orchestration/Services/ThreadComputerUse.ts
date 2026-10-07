import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ComputerUseMode } from "@glade/contracts/computer/computerUse";
import { ServiceMap } from "effect";

// Per-thread Computer Use, held in memory for the server's lifetime (a restart turns it off).
// Kept beside ThreadSessionSettings rather than in it because that service is private to the
// provider command reactor, while the agent gateway must read this one.
export interface ThreadComputerUseShape {
  readonly mode: (threadId: ThreadId) => ComputerUseMode;
  readonly set: (threadId: ThreadId, mode: ComputerUseMode) => void;
  // "once" covers the next turn: a turn start binds it, that turn's end turns it off.
  readonly turnStarted: (threadId: ThreadId) => void;
  readonly turnEnded: (threadId: ThreadId) => void;
  // Whether the provider session running now was started with the computer tools listed. A
  // mismatch with `mode` makes the next session check restart it.
  readonly provisioned: (threadId: ThreadId) => boolean;
  readonly markProvisioned: (threadId: ThreadId, listed: boolean) => void;
  readonly clear: (threadId: ThreadId) => void;
  // Threads whose mode is not off, for Settings and the composer.
  readonly enabled: () => ReadonlyArray<{
    readonly threadId: ThreadId;
    readonly mode: ComputerUseMode;
  }>;
  // Called after any thread's mode changes, including "once" ending with its turn.
  readonly onChange: (listener: () => void) => () => void;
}

export class ThreadComputerUse extends ServiceMap.Service<
  ThreadComputerUse,
  ThreadComputerUseShape
>()("glade/orchestration/Services/ThreadComputerUse") {}
