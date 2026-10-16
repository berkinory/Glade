import type { AuthSessionId } from "@glade/contracts/core/baseSchemas";
import {
  REMOTE_ACCESS_WS_METHODS,
  type RemoteAccessDevices,
  type RemoteAccessStatus,
  type RemoteAccessUpdateInput,
} from "@glade/contracts/transport/ws/remoteAccessRpc";
import { WsRpcError } from "@glade/contracts/transport/ws/rpcErrors";
import { Effect, Stream } from "effect";

import type { RemoteAccessError, RemoteAccessShape } from "./Services/RemoteAccess";

interface StreamAdmission {
  readonly guard: <A, E, R>(
    clientId: number,
    subscription: { readonly key: string },
    stream: Stream.Stream<A, E, R>,
  ) => Stream.Stream<A, E | WsRpcError, R>;
}

const toWsError = (error: RemoteAccessError) => new WsRpcError({ message: error.message });

export function makeRemoteAccessWsHandlers(input: {
  readonly remoteAccess: RemoteAccessShape;
  readonly streamAdmission: StreamAdmission;
}) {
  const { remoteAccess, streamAdmission } = input;
  return {
    [REMOTE_ACCESS_WS_METHODS.subscribe]: (
      _payload: unknown,
      options: { readonly clientId: number },
    ): Stream.Stream<RemoteAccessStatus, WsRpcError> =>
      streamAdmission.guard(
        options.clientId,
        { key: "remoteAccess.status" },
        remoteAccess.streamStatus,
      ),
    [REMOTE_ACCESS_WS_METHODS.update]: (
      update: RemoteAccessUpdateInput,
    ): Effect.Effect<RemoteAccessStatus, WsRpcError> =>
      remoteAccess.update(update).pipe(Effect.mapError(toWsError)),
    [REMOTE_ACCESS_WS_METHODS.createPairing]: () =>
      remoteAccess.createPairing.pipe(Effect.mapError(toWsError)),
    [REMOTE_ACCESS_WS_METHODS.subscribeDevices]: (
      _payload: unknown,
      options: { readonly clientId: number },
    ): Stream.Stream<RemoteAccessDevices, WsRpcError> =>
      streamAdmission.guard(
        options.clientId,
        { key: "remoteAccess.devices" },
        remoteAccess.streamDevices.pipe(Stream.mapError(toWsError)),
      ),
    [REMOTE_ACCESS_WS_METHODS.revokeDevice]: (input: {
      readonly sessionId: AuthSessionId;
    }): Effect.Effect<void, WsRpcError> =>
      remoteAccess.revokeDevice(input.sessionId).pipe(Effect.mapError(toWsError)),
    [REMOTE_ACCESS_WS_METHODS.revokePairing]: (input: {
      readonly id: string;
    }): Effect.Effect<void, WsRpcError> =>
      remoteAccess.revokePairing(input.id).pipe(Effect.mapError(toWsError)),
  };
}
