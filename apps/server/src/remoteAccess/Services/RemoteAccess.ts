import type http from "node:http";

import type {
  RemoteAccessDevices,
  RemoteAccessPairing,
  RemoteAccessStatus,
  RemoteAccessUpdateInput,
} from "@glade/contracts/transport/ws/remoteAccessRpc";
import type { AuthSessionId } from "@glade/contracts/core/baseSchemas";
import { Data, ServiceMap } from "effect";
import type { Effect, Scope, Stream } from "effect";

export class RemoteAccessError extends Data.TaggedError("RemoteAccessError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface RemoteAccessShape {
  // Hands the server's HTTP server to remote access, which then follows the saved settings for the
  // lifetime of the scope.
  readonly attach: (server: http.Server) => Effect.Effect<void, never, Scope.Scope>;
  readonly streamStatus: Stream.Stream<RemoteAccessStatus>;
  readonly update: (
    input: RemoteAccessUpdateInput,
  ) => Effect.Effect<RemoteAccessStatus, RemoteAccessError>;
  readonly createPairing: Effect.Effect<RemoteAccessPairing, RemoteAccessError>;
  readonly streamDevices: Stream.Stream<RemoteAccessDevices, RemoteAccessError>;
  readonly revokeDevice: (sessionId: AuthSessionId) => Effect.Effect<void, RemoteAccessError>;
  readonly revokePairing: (id: string) => Effect.Effect<void, RemoteAccessError>;
}

export class RemoteAccess extends ServiceMap.Service<RemoteAccess, RemoteAccessShape>()(
  "glade/remoteAccess/Services/RemoteAccess",
) {}
