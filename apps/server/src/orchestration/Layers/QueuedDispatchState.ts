import { Effect, Layer } from "effect";
import type { TurnId } from "@glade/contracts/core/baseSchemas";
import { QueuedDispatchState } from "../Services/QueuedDispatchState.ts";

interface Reservation {
  readonly id: number;
  readonly queuedThreadId: string;
  readonly messageId: string;
  releaseOnTurnId?: TurnId;
  pendingTerminalTurnIds?: Set<TurnId>;
}

export const QueuedDispatchStateLive = Layer.effect(
  QueuedDispatchState,
  Effect.acquireRelease(
    Effect.sync(() => {
      const drainingThreads = new Set<string>();
      const reservations = new Map<string, Reservation>();
      let nextReservationId = 0;
      const state = {
        beginDrain: (threadId: string, sessionThreadId: string) => {
          if (drainingThreads.has(threadId) || reservations.has(sessionThreadId)) return false;
          drainingThreads.add(threadId);
          return true;
        },
        endDrain: (threadId: string) => {
          drainingThreads.delete(threadId);
        },
        hasReservation: (sessionThreadId: string) => reservations.has(sessionThreadId),
        reserve: (
          sessionThreadId: string,
          input: { queuedThreadId: string; messageId: string },
        ) => {
          reservations.set(sessionThreadId, { id: ++nextReservationId, ...input });
        },
        getReservation: (sessionThreadId: string) => {
          const reservation = reservations.get(sessionThreadId);
          if (!reservation) return undefined;
          const { id, queuedThreadId, messageId, releaseOnTurnId } = reservation;
          return {
            id,
            queuedThreadId,
            messageId,
            ...(releaseOnTurnId === undefined ? {} : { releaseOnTurnId }),
          };
        },
        clearReservation: (sessionThreadId: string) => {
          reservations.delete(sessionThreadId);
        },
        clearIfOwned: (sessionThreadId: string, reservationId: number) => {
          if (reservations.get(sessionThreadId)?.id === reservationId) {
            reservations.delete(sessionThreadId);
          }
        },
        bindToTurn: (sessionThreadId: string, reservationId: number, turnId: TurnId) => {
          const reservation = reservations.get(sessionThreadId);
          if (reservation?.id !== reservationId) return false;
          reservation.releaseOnTurnId = turnId;
          const completedBeforeBinding = reservation.pendingTerminalTurnIds?.has(turnId) ?? false;
          delete reservation.pendingTerminalTurnIds;
          if (completedBeforeBinding) reservations.delete(sessionThreadId);
          return completedBeforeBinding;
        },
        recordTerminalTurn: (sessionThreadId: string, turnId: TurnId) => {
          const reservation = reservations.get(sessionThreadId);
          if (!reservation) return false;
          if (reservation.releaseOnTurnId === undefined) {
            (reservation.pendingTerminalTurnIds ??= new Set()).add(turnId);
            return true;
          }
          if (reservation.releaseOnTurnId !== turnId) return true;
          reservations.delete(sessionThreadId);
          return false;
        },
        clearStopped: (
          stoppedSessionThreadId: string,
          stopsProviderSession: boolean,
          clearedQueuedThreadIds: ReadonlyArray<string>,
        ) => {
          const cleared = new Set(clearedQueuedThreadIds);
          for (const [sessionThreadId, reservation] of reservations) {
            if (
              (stopsProviderSession && sessionThreadId === stoppedSessionThreadId) ||
              cleared.has(reservation.queuedThreadId)
            ) {
              reservations.delete(sessionThreadId);
            }
          }
        },
      };
      return {
        state,
        dispose: () => {
          drainingThreads.clear();
          reservations.clear();
        },
      };
    }),
    (owner) => Effect.sync(owner.dispose),
  ).pipe(Effect.map((owner) => owner.state)),
);
