import { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  COMPUTER_WS_METHODS,
  type ComputerDriverStatus,
  type ComputerGrantTarget,
  type ComputerState,
  type ComputerThreadState,
} from "@glade/contracts/transport/ws/computerRpc";
import { WsRpcError } from "@glade/contracts/transport/ws/rpcErrors";
import { Effect, Option, Queue, Stream } from "effect";

import type { ThreadComputerUseShape } from "../orchestration/Services/ThreadComputerUse.ts";
import type { ComputerAccessShape } from "./Services/ComputerAccess.ts";
import type { ComputerHostShape, ComputerStatus } from "./Services/ComputerHost.ts";

interface StreamAdmission {
  readonly guard: <A, E, R>(
    clientId: number,
    subscription: { readonly key: string },
    stream: Stream.Stream<A, E, R>,
  ) => Stream.Stream<A, E | WsRpcError, R>;
}

interface ComputerServices {
  readonly host: ComputerHostShape;
  readonly access: ComputerAccessShape;
  readonly computerUse: ThreadComputerUseShape;
}

const unavailable = () =>
  new WsRpcError({
    message: "Computer Use is only available in the Glade desktop app.",
    code: "unavailable",
  });

const statusView = (status: ComputerStatus): ComputerDriverStatus =>
  status.state === "ready"
    ? {
        state: "ready",
        driverVersion: status.driverVersion,
        permissions: status.permissions,
        healthProblems: status.healthProblems,
      }
    : status;

const threadsView = (services: ComputerServices): ReadonlyArray<ComputerThreadState> => {
  const byThread = new Map<string, ComputerThreadState>();
  for (const { threadId, mode } of services.computerUse.enabled()) {
    byThread.set(threadId, { threadId, mode, grants: [] });
  }
  for (const { threadId, grants } of services.access.grants.list()) {
    const id = ThreadId.makeUnsafe(threadId);
    byThread.set(threadId, {
      threadId: id,
      mode: services.computerUse.mode(id),
      grants: grants.map(({ app, windowId, windowTitle, scope, grantedAt }) => ({
        app,
        windowId,
        windowTitle,
        scope,
        grantedAt,
      })),
    });
  }
  return [...byThread.values()];
};

// Mode and grant changes are synchronous in their owners; the stream recomputes the whole (small)
// state on each change or driver status update.
const stateStream = (services: ComputerServices): Stream.Stream<ComputerState> => {
  const changes = Stream.callback<void>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const notify = () => Queue.offerUnsafe(queue, undefined);
          return [services.access.grants.onChange(notify), services.computerUse.onChange(notify)];
        }),
        (unsubscribes) => Effect.sync(() => unsubscribes.forEach((unsubscribe) => unsubscribe())),
      ),
    { bufferSize: 1, strategy: "sliding" },
  );
  return Stream.merge(services.host.status.pipe(Stream.map(() => undefined)), changes).pipe(
    Stream.mapEffect(() =>
      services.host.currentStatus.pipe(
        Effect.map((status) => ({ status: statusView(status), threads: threadsView(services) })),
      ),
    ),
    Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
  );
};

// Computer Use state for the web: driver status, each thread's mode and grants, and revoking a
// grant from Settings. The mode itself is set with the thread.computer-use.set command.
export function makeComputerWsHandlers(input: {
  readonly host: Option.Option<ComputerHostShape>;
  readonly access: Option.Option<ComputerAccessShape>;
  readonly computerUse: Option.Option<ThreadComputerUseShape>;
  readonly streamAdmission: StreamAdmission;
}) {
  const services = Option.all({
    host: input.host,
    access: input.access,
    computerUse: input.computerUse,
  }).pipe(Option.filter((value) => value.host.configured));

  return {
    [COMPUTER_WS_METHODS.subscribe]: (
      _payload: unknown,
      options: { readonly clientId: number },
    ): Stream.Stream<ComputerState, WsRpcError> =>
      Option.isNone(services)
        ? Stream.fail(unavailable())
        : input.streamAdmission.guard(
            options.clientId,
            { key: "computer.state" },
            stateStream(services.value),
          ),
    [COMPUTER_WS_METHODS.revokeGrant]: (
      target: ComputerGrantTarget,
    ): Effect.Effect<void, WsRpcError> =>
      Option.isNone(services)
        ? Effect.fail(unavailable())
        : Effect.sync(() => {
            services.value.access.grants.revoke(target.threadId, {
              app: target.app,
              windowId: target.windowId,
            });
          }),
  };
}
