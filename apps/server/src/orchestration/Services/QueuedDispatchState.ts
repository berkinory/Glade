import { ServiceMap } from "effect";
import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";

export interface QueuedDispatchReservation {
  readonly id: number;
  readonly queuedThreadId: string;
  readonly messageId: string;
  readonly releaseOnTurnId?: TurnId;
}

export interface QueuedDispatchStateShape {
  readonly beginDrain: (threadId: ThreadId, sessionThreadId: ThreadId) => boolean;
  readonly endDrain: (threadId: ThreadId) => void;
  readonly hasReservation: (sessionThreadId: ThreadId) => boolean;
  readonly reserve: (
    sessionThreadId: ThreadId,
    input: Pick<QueuedDispatchReservation, "queuedThreadId" | "messageId">,
  ) => void;
  readonly getReservation: (sessionThreadId: ThreadId) => QueuedDispatchReservation | undefined;
  readonly clearReservation: (sessionThreadId: ThreadId) => void;
  readonly clearIfOwned: (sessionThreadId: ThreadId, reservationId: number) => void;
  readonly bindToTurn: (
    sessionThreadId: ThreadId,
    reservationId: number,
    turnId: TurnId,
  ) => boolean;
  readonly recordTerminalTurn: (sessionThreadId: ThreadId, turnId: TurnId) => boolean;
  readonly clearStopped: (
    stoppedSessionThreadId: ThreadId,
    stopsProviderSession: boolean,
    clearedQueuedThreadIds: ReadonlyArray<ThreadId>,
  ) => void;
}

export class QueuedDispatchState extends ServiceMap.Service<
  QueuedDispatchState,
  QueuedDispatchStateShape
>()("glade/orchestration/Services/QueuedDispatchState") {}
